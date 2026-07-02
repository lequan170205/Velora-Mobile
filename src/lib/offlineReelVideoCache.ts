import AsyncStorage from '@react-native-async-storage/async-storage'

import type { Reel } from '../types/reel.types'

type LegacyFileInfo =
  | {
      exists: true
      isDirectory?: boolean
      size?: number
      uri?: string
    }
  | {
      exists: false
      isDirectory?: false
      size?: undefined
      uri?: string
    }

type LegacyFileSystemModule = {
  documentDirectory: string | null
  cacheDirectory: string | null
  makeDirectoryAsync: (uri: string, options?: { intermediates?: boolean }) => Promise<void>
  getInfoAsync: (uri: string) => Promise<LegacyFileInfo>
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>
  downloadAsync: (uri: string, fileUri: string) => Promise<{ uri: string; status: number }>
  readAsStringAsync: (uri: string) => Promise<string>
  writeAsStringAsync: (uri: string, contents: string) => Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const FileSystem = require('expo-file-system/legacy') as LegacyFileSystemModule

const OFFLINE_REEL_INDEX_KEY = '@velora/reels/offline-video-index/v1'
const OFFLINE_REEL_CACHE_DIR =
  (FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '') + 'velora-offline-reels/'

const MAX_OFFLINE_REELS = 24
const DOWNLOAD_CONCURRENCY = 4

export interface OfflineReelVideoRecord {
  reelId: string
  streamUrl: string
  localManifestUri: string
  localThumbnailUri?: string
  downloadedAt: number
  lastAccessedAt: number
  segmentCount: number
}

type DownloadableResource = {
  remoteUrl: string
  localUri: string
  localName: string
}

const activeDownloads = new Map<string, Promise<OfflineReelVideoRecord | null>>()

const sanitizePathPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_')

const ensureDirectory = async (uri: string) => {
  await FileSystem.makeDirectoryAsync(uri, { intermediates: true }).catch(() => undefined)
}

const fileExists = async (uri: string) => {
  const info = await FileSystem.getInfoAsync(uri).catch(() => null)
  return Boolean(info?.exists)
}

const readIndex = async (): Promise<OfflineReelVideoRecord[]> => {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_REEL_INDEX_KEY)

    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (item): item is OfflineReelVideoRecord =>
        typeof item?.reelId === 'string' &&
        typeof item?.streamUrl === 'string' &&
        typeof item?.localManifestUri === 'string' &&
        typeof item?.downloadedAt === 'number',
    )
  } catch {
    return []
  }
}

const writeIndex = async (records: OfflineReelVideoRecord[]) => {
  await AsyncStorage.setItem(OFFLINE_REEL_INDEX_KEY, JSON.stringify(records))
}

const removeOfflineReelDirectory = async (reelId: string) => {
  const reelDir = `${OFFLINE_REEL_CACHE_DIR}${sanitizePathPart(reelId)}/`
  await FileSystem.deleteAsync(reelDir, { idempotent: true }).catch(() => undefined)
}

const trimOfflineVideoCache = async (records: OfflineReelVideoRecord[]) => {
  const uniqueByReelId = new Map<string, OfflineReelVideoRecord>()

  for (const record of records) {
    const existing = uniqueByReelId.get(record.reelId)

    if (!existing || existing.downloadedAt < record.downloadedAt) {
      uniqueByReelId.set(record.reelId, record)
    }
  }

  const sortedRecords = [...uniqueByReelId.values()].sort(
    (a, b) => b.lastAccessedAt - a.lastAccessedAt,
  )

  const keptRecords = sortedRecords.slice(0, MAX_OFFLINE_REELS)
  const removedRecords = sortedRecords.slice(MAX_OFFLINE_REELS)

  await Promise.all(removedRecords.map((record) => removeOfflineReelDirectory(record.reelId)))
  await writeIndex(keptRecords)
}

const upsertIndexRecord = async (record: OfflineReelVideoRecord) => {
  const records = await readIndex()
  await trimOfflineVideoCache([record, ...records.filter((item) => item.reelId !== record.reelId)])
}

const toAbsoluteUrl = (baseUrl: string, value: string) => {
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return null
  }
}

const fetchPlaylistText = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
    },
  })

  if (!response.ok) {
    throw new Error(`Could not fetch playlist: ${response.status}`)
  }

  return response.text()
}

const parseLowestVariantPlaylistUrl = (masterUrl: string, masterPlaylistText: string) => {
  const lines = masterPlaylistText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const variants: { bandwidth: number; url: string }[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (!line.startsWith('#EXT-X-STREAM-INF')) {
      continue
    }

    const nextLine = lines[index + 1]

    if (!nextLine || nextLine.startsWith('#')) {
      continue
    }

    const variantUrl = toAbsoluteUrl(masterUrl, nextLine)

    if (!variantUrl) {
      continue
    }

    const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i)
    const bandwidth = bandwidthMatch ? Number(bandwidthMatch[1]) : Number.MAX_SAFE_INTEGER

    variants.push({
      bandwidth,
      url: variantUrl,
    })
  }

  if (variants.length === 0) {
    return masterUrl
  }

  variants.sort((a, b) => a.bandwidth - b.bandwidth)
  return variants[0].url
}

const getExtensionFromUrl = (url: string, fallback = '.ts') => {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/\.[a-zA-Z0-9]+$/)
    return match?.[0] ?? fallback
  } catch {
    return fallback
  }
}

const rewriteUriAttribute = (
  line: string,
  playlistUrl: string,
  reelDir: string,
  resources: DownloadableResource[],
  prefix: string,
) => {
  const match = line.match(/URI="([^"]+)"/)

  if (!match?.[1]) {
    return line
  }

  const remoteUrl = toAbsoluteUrl(playlistUrl, match[1])

  if (!remoteUrl) {
    return line
  }

  const localName = `${prefix}_${resources.length}${getExtensionFromUrl(remoteUrl, '.bin')}`
  const localUri = `${reelDir}${localName}`

  resources.push({
    remoteUrl,
    localUri,
    localName,
  })

  return line.replace(match[1], localName)
}

const rewriteMediaPlaylist = (
  playlistUrl: string,
  playlistText: string,
  reelDir: string,
): {
  rewrittenPlaylistText: string
  resources: DownloadableResource[]
} => {
  const resources: DownloadableResource[] = []
  let segmentIndex = 0

  const rewrittenLines = playlistText.split('\n').map((line) => {
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      return line
    }

    if (trimmedLine.startsWith('#EXT-X-MAP')) {
      return rewriteUriAttribute(line, playlistUrl, reelDir, resources, 'map')
    }

    if (trimmedLine.startsWith('#EXT-X-KEY')) {
      return rewriteUriAttribute(line, playlistUrl, reelDir, resources, 'key')
    }

    if (trimmedLine.startsWith('#')) {
      return line
    }

    const remoteUrl = toAbsoluteUrl(playlistUrl, trimmedLine)

    if (!remoteUrl) {
      return line
    }

    const extension = getExtensionFromUrl(remoteUrl, '.ts')
    const localName = `segment_${String(segmentIndex).padStart(4, '0')}${extension}`
    const localUri = `${reelDir}${localName}`

    segmentIndex += 1

    resources.push({
      remoteUrl,
      localUri,
      localName,
    })

    return localName
  })

  return {
    rewrittenPlaylistText: rewrittenLines.join('\n'),
    resources,
  }
}

const downloadResource = async (resource: DownloadableResource) => {
  if (await fileExists(resource.localUri)) {
    return
  }

  const result = await FileSystem.downloadAsync(resource.remoteUrl, resource.localUri)

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Could not download ${resource.remoteUrl}: ${result.status}`)
  }
}

const downloadWithConcurrency = async (resources: DownloadableResource[]) => {
  const executing = new Set<Promise<void>>()

  for (const resource of resources) {
    const promise = downloadResource(resource).finally(() => {
      executing.delete(promise)
    })

    executing.add(promise)

    if (executing.size >= DOWNLOAD_CONCURRENCY) {
      await Promise.race(executing)
    }
  }

  await Promise.all(executing)
}

const downloadThumbnail = async (thumbnailUrl: string | undefined, reelDir: string) => {
  if (!thumbnailUrl) {
    return undefined
  }

  const extension = getExtensionFromUrl(thumbnailUrl, '.jpg')
  const localThumbnailUri = `${reelDir}thumbnail${extension}`

  if (await fileExists(localThumbnailUri)) {
    return localThumbnailUri
  }

  const result = await FileSystem.downloadAsync(thumbnailUrl, localThumbnailUri)

  if (result.status < 200 || result.status >= 300) {
    return undefined
  }

  return localThumbnailUri
}

export const getCachedOfflineReelVideo = async (
  reelId: string,
): Promise<OfflineReelVideoRecord | null> => {
  const records = await readIndex()
  const record = records.find((item) => item.reelId === reelId)

  if (!record) {
    return null
  }

  if (!(await fileExists(record.localManifestUri))) {
    await removeOfflineReelDirectory(reelId)
    await writeIndex(records.filter((item) => item.reelId !== reelId))
    return null
  }

  const updatedRecord = {
    ...record,
    lastAccessedAt: Date.now(),
  }

  await writeIndex(records.map((item) => (item.reelId === reelId ? updatedRecord : item)))

  return updatedRecord
}

export const cacheOfflineReelVideo = async (
  reel: Pick<Reel, 'id' | 'streamUrl' | 'thumbnailUrl'>,
): Promise<OfflineReelVideoRecord | null> => {
  if (!reel.streamUrl) {
    return null
  }

  const existing = await getCachedOfflineReelVideo(reel.id)

  if (existing?.streamUrl === reel.streamUrl) {
    return existing
  }

  const activeDownload = activeDownloads.get(reel.id)

  if (activeDownload) {
    return activeDownload
  }

  const downloadPromise = (async () => {
    const reelDir = `${OFFLINE_REEL_CACHE_DIR}${sanitizePathPart(reel.id)}/`
    const tempDir = `${OFFLINE_REEL_CACHE_DIR}${sanitizePathPart(reel.id)}_tmp/`

    await ensureDirectory(OFFLINE_REEL_CACHE_DIR)
    await FileSystem.deleteAsync(tempDir, { idempotent: true }).catch(() => undefined)
    await ensureDirectory(tempDir)

    try {
      const masterPlaylistText = await fetchPlaylistText(reel.streamUrl)
      const mediaPlaylistUrl = parseLowestVariantPlaylistUrl(reel.streamUrl, masterPlaylistText)
      const mediaPlaylistText =
        mediaPlaylistUrl === reel.streamUrl
          ? masterPlaylistText
          : await fetchPlaylistText(mediaPlaylistUrl)

      const { rewrittenPlaylistText, resources } = rewriteMediaPlaylist(
        mediaPlaylistUrl,
        mediaPlaylistText,
        tempDir,
      )

      await downloadWithConcurrency(resources)

      const localManifestUri = `${tempDir}offline.m3u8`
      await FileSystem.writeAsStringAsync(localManifestUri, rewrittenPlaylistText)

      const localThumbnailUri = await downloadThumbnail(reel.thumbnailUrl, tempDir)

      await FileSystem.deleteAsync(reelDir, { idempotent: true }).catch(() => undefined)
      await ensureDirectory(OFFLINE_REEL_CACHE_DIR)

      /*
       * expo-file-system legacy has no cross-platform atomic move in this repo setup.
       * We use temp dir during download, then keep it by renaming logically through index.
       */
      const finalDir = tempDir
      const downloadedAt = Date.now()

      const record: OfflineReelVideoRecord = {
        reelId: reel.id,
        streamUrl: reel.streamUrl,
        localManifestUri: `${finalDir}offline.m3u8`,
        ...(localThumbnailUri ? { localThumbnailUri } : {}),
        downloadedAt,
        lastAccessedAt: downloadedAt,
        segmentCount: resources.length,
      }

      await upsertIndexRecord(record)

      return record
    } catch (error) {
      await FileSystem.deleteAsync(tempDir, { idempotent: true }).catch(() => undefined)
      throw error
    }
  })()
    .catch(() => null)
    .finally(() => {
      activeDownloads.delete(reel.id)
    })

  activeDownloads.set(reel.id, downloadPromise)

  return downloadPromise
}

export const prefetchOfflineReelVideos = async (
  reels: (Pick<Reel, 'id' | 'streamUrl' | 'thumbnailUrl'> | undefined | null)[],
) => {
  for (const reel of reels) {
    if (!reel?.id || !reel.streamUrl) {
      continue
    }

    await cacheOfflineReelVideo(reel).catch(() => null)
  }
}

export const clearOfflineReelVideos = async () => {
  await FileSystem.deleteAsync(OFFLINE_REEL_CACHE_DIR, { idempotent: true }).catch(() => undefined)
  await AsyncStorage.removeItem(OFFLINE_REEL_INDEX_KEY)
}
