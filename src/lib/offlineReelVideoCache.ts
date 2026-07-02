import {
  deleteReelVideoCacheRecords,
  findReelVideoCacheRecordByReelId,
  getAllReelVideoCacheRecords,
  upsertReelVideoCacheRecord,
} from '../database/reels/reelOfflineStore'

import type { ReelVideoCacheRecordModel } from '../database/models/ReelVideoCacheRecordModel'
import type { ReelVideoCacheRecordInput } from '../database/reels/reelOfflineStore'
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
  cacheDirectory: string | null
  makeDirectoryAsync: (uri: string, options?: { intermediates?: boolean }) => Promise<void>
  getInfoAsync: (uri: string) => Promise<LegacyFileInfo>
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>
  downloadAsync: (uri: string, fileUri: string) => Promise<{ uri: string; status: number }>
  writeAsStringAsync: (uri: string, contents: string) => Promise<void>
  moveAsync: (options: { from: string; to: string }) => Promise<void>
  readDirectoryAsync: (uri: string) => Promise<string[]>
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const FileSystem = require('expo-file-system/legacy') as LegacyFileSystemModule

export type TemporaryReelVideoCacheStatus =
  | 'NOT_CACHED'
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'CACHED'
  | 'FAILED'

export interface TemporaryReelVideoCacheRecord {
  reelId: string
  streamUrl: string
  localManifestUri: string
  localThumbnailUri?: string
  downloadedAt: number
  lastAccessedAt: number
  segmentCount: number
  sizeBytes: number
}

export interface TemporaryReelVideoCacheInput {
  id: string
  streamUrl: string
  thumbnailUrl?: string
}

interface DownloadableResource {
  remoteUrl: string
  localUri: string
  localName: string
}

interface DownloadJob {
  reel: TemporaryReelVideoCacheInput
  priority: number
  addedAt: number
  status: TemporaryReelVideoCacheStatus
  promise: Promise<TemporaryReelVideoCacheRecord | null>
  resolve: (record: TemporaryReelVideoCacheRecord | null) => void
}

const TEMP_REEL_VIDEO_CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}velora-temp-reel-video-cache/`

const MAX_TEMP_VIDEO_CACHE_BYTES = 500 * 1024 * 1024
const MAX_TEMP_VIDEO_CACHE_AGE_MS = 1000 * 60 * 60 * 24 * 7
const MAX_TEMP_VIDEO_CACHE_REELS = 40

const MAX_ACTIVE_REEL_DOWNLOADS = 1
const SEGMENT_DOWNLOAD_CONCURRENCY = 4

const downloadJobs = new Map<string, DownloadJob>()
const statusByReelId = new Map<string, TemporaryReelVideoCacheStatus>()
const listenersByReelId = new Map<string, Set<(status: TemporaryReelVideoCacheStatus) => void>>()

let activeDownloadCount = 0

const ensureCacheDirectoryAvailable = () => {
  if (!FileSystem.cacheDirectory) {
    throw new Error('FileSystem.cacheDirectory is not available')
  }
}

const sanitizePathPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_')

const getReelCacheDir = (reelId: string) =>
  `${TEMP_REEL_VIDEO_CACHE_DIR}${sanitizePathPart(reelId)}/`

const getReelTempCacheDir = (reelId: string) =>
  `${TEMP_REEL_VIDEO_CACHE_DIR}${sanitizePathPart(reelId)}_tmp_${Date.now()}/`

const ensureDirectory = async (uri: string) => {
  await FileSystem.makeDirectoryAsync(uri, { intermediates: true }).catch(() => undefined)
}

const getFileInfo = async (uri: string) => {
  try {
    return await FileSystem.getInfoAsync(uri)
  } catch {
    return null
  }
}

const fileExists = async (uri: string) => {
  const info = await getFileInfo(uri)
  return Boolean(info?.exists)
}

const getFileSize = async (uri: string) => {
  const info = await getFileInfo(uri)

  if (!info?.exists || typeof info.size !== 'number') {
    return 0
  }

  return info.size
}

const notifyCacheStatus = (reelId: string, status: TemporaryReelVideoCacheStatus) => {
  statusByReelId.set(reelId, status)

  const listeners = listenersByReelId.get(reelId)

  if (!listeners) {
    return
  }

  listeners.forEach((listener) => {
    listener(status)
  })
}

export const subscribeTemporaryReelVideoCacheStatus = (
  reelId: string,
  listener: (status: TemporaryReelVideoCacheStatus) => void,
) => {
  const listeners = listenersByReelId.get(reelId) ?? new Set()
  listeners.add(listener)
  listenersByReelId.set(reelId, listeners)

  listener(statusByReelId.get(reelId) ?? 'NOT_CACHED')

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0) {
      listenersByReelId.delete(reelId)
    }
  }
}

const toTemporaryReelVideoCacheRecord = (
  record:
    | ReelVideoCacheRecordModel
    | Pick<
        ReelVideoCacheRecordModel,
        | 'reelId'
        | 'streamUrl'
        | 'localManifestUri'
        | 'localThumbnailUri'
        | 'downloadedAt'
        | 'lastAccessedAt'
        | 'segmentCount'
        | 'sizeBytes'
      >,
): TemporaryReelVideoCacheRecord => ({
  reelId: record.reelId,
  streamUrl: record.streamUrl,
  localManifestUri: record.localManifestUri,
  ...(record.localThumbnailUri ? { localThumbnailUri: record.localThumbnailUri } : {}),
  downloadedAt: record.downloadedAt,
  lastAccessedAt: record.lastAccessedAt,
  segmentCount: record.segmentCount,
  sizeBytes: record.sizeBytes,
})

const toReelVideoCacheRecordInput = (
  record: TemporaryReelVideoCacheRecord,
): ReelVideoCacheRecordInput => ({
  reelId: record.reelId,
  streamUrl: record.streamUrl,
  localManifestUri: record.localManifestUri,
  localThumbnailUri: record.localThumbnailUri ?? null,
  downloadedAt: record.downloadedAt,
  lastAccessedAt: record.lastAccessedAt,
  segmentCount: record.segmentCount,
  sizeBytes: record.sizeBytes,
})

const removeReelCacheDirectory = async (reelId: string) => {
  await FileSystem.deleteAsync(getReelCacheDir(reelId), { idempotent: true }).catch(() => undefined)
}

const removeRecords = async (records: ReelVideoCacheRecordModel[]) => {
  if (records.length === 0) {
    return
  }

  await deleteReelVideoCacheRecords(records)
  await Promise.all(records.map((record) => removeReelCacheDirectory(record.reelId)))

  records.forEach((record) => {
    notifyCacheStatus(record.reelId, 'NOT_CACHED')
  })
}

const cleanupTempDirectories = async () => {
  try {
    await ensureDirectory(TEMP_REEL_VIDEO_CACHE_DIR)

    const names = await FileSystem.readDirectoryAsync(TEMP_REEL_VIDEO_CACHE_DIR)

    await Promise.all(
      names
        .filter((name) => name.includes('_tmp_'))
        .map((name) =>
          FileSystem.deleteAsync(`${TEMP_REEL_VIDEO_CACHE_DIR}${name}/`, {
            idempotent: true,
          }).catch(() => undefined),
        ),
    )
  } catch {
    // ignore cleanup failure
  }
}

const evictTemporaryReelVideoCache = async (
  records: ReelVideoCacheRecordModel[],
): Promise<ReelVideoCacheRecordModel[]> => {
  const now = Date.now()
  const uniqueByReelId = new Map<string, ReelVideoCacheRecordModel>()
  const recordsToDelete = new Map<string, ReelVideoCacheRecordModel>()

  for (const record of records) {
    if (now - record.lastAccessedAt > MAX_TEMP_VIDEO_CACHE_AGE_MS) {
      recordsToDelete.set(record.id, record)
      continue
    }

    const exists = await fileExists(record.localManifestUri)

    if (!exists) {
      recordsToDelete.set(record.id, record)
      continue
    }

    const existing = uniqueByReelId.get(record.reelId)

    if (!existing || existing.downloadedAt < record.downloadedAt) {
      if (existing) {
        recordsToDelete.set(existing.id, existing)
      }

      uniqueByReelId.set(record.reelId, record)
      continue
    }

    recordsToDelete.set(record.id, record)
  }

  const sortedRecords = [...uniqueByReelId.values()].sort(
    (a, b) => b.lastAccessedAt - a.lastAccessedAt,
  )

  let keptRecords = sortedRecords
  let totalBytes = keptRecords.reduce((sum, record) => sum + record.sizeBytes, 0)

  while (
    keptRecords.length > MAX_TEMP_VIDEO_CACHE_REELS ||
    totalBytes > MAX_TEMP_VIDEO_CACHE_BYTES
  ) {
    const recordToRemove = keptRecords[keptRecords.length - 1]

    if (!recordToRemove) {
      break
    }

    keptRecords = keptRecords.slice(0, -1)
    totalBytes -= recordToRemove.sizeBytes
    recordsToDelete.set(recordToRemove.id, recordToRemove)
  }

  if (recordsToDelete.size > 0) {
    await removeRecords([...recordsToDelete.values()])
  }

  return keptRecords
}

const upsertIndexRecord = async (record: TemporaryReelVideoCacheRecord) => {
  await upsertReelVideoCacheRecord(toReelVideoCacheRecordInput(record))
  await evictTemporaryReelVideoCache(await getAllReelVideoCacheRecords())
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
  cacheDir: string,
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
  const localUri = `${cacheDir}${localName}`

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
  cacheDir: string,
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
      return rewriteUriAttribute(line, playlistUrl, cacheDir, resources, 'map')
    }

    if (trimmedLine.startsWith('#EXT-X-KEY')) {
      return rewriteUriAttribute(line, playlistUrl, cacheDir, resources, 'key')
    }

    if (trimmedLine.startsWith('#')) {
      return line
    }

    const remoteUrl = toAbsoluteUrl(playlistUrl, trimmedLine)

    if (!remoteUrl) {
      return line
    }

    const localName = `segment_${String(segmentIndex).padStart(4, '0')}${getExtensionFromUrl(
      remoteUrl,
      '.ts',
    )}`
    const localUri = `${cacheDir}${localName}`

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
    return getFileSize(resource.localUri)
  }

  const result = await FileSystem.downloadAsync(resource.remoteUrl, resource.localUri)

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Could not download ${resource.remoteUrl}: ${result.status}`)
  }

  return getFileSize(resource.localUri)
}

const downloadWithConcurrency = async (resources: DownloadableResource[]) => {
  const executing = new Set<Promise<number>>()
  let totalBytes = 0

  for (const resource of resources) {
    const promise = downloadResource(resource).finally(() => {
      executing.delete(promise)
    })

    executing.add(promise)

    promise
      .then((sizeBytes) => {
        totalBytes += sizeBytes
      })
      .catch(() => undefined)

    if (executing.size >= SEGMENT_DOWNLOAD_CONCURRENCY) {
      await Promise.race(executing)
    }
  }

  const remainingSizes = await Promise.all(executing)
  totalBytes += remainingSizes.reduce((sum, size) => sum + size, 0)

  return totalBytes
}

const downloadThumbnail = async (thumbnailUrl: string | undefined, cacheDir: string) => {
  if (!thumbnailUrl) {
    return undefined
  }

  const localThumbnailUri = `${cacheDir}thumbnail${getExtensionFromUrl(thumbnailUrl, '.jpg')}`

  if (await fileExists(localThumbnailUri)) {
    return {
      localThumbnailUri,
      sizeBytes: await getFileSize(localThumbnailUri),
    }
  }

  const result = await FileSystem.downloadAsync(thumbnailUrl, localThumbnailUri)

  if (result.status < 200 || result.status >= 300) {
    return undefined
  }

  return {
    localThumbnailUri,
    sizeBytes: await getFileSize(localThumbnailUri),
  }
}

const downloadReelVideoNow = async (
  reel: TemporaryReelVideoCacheInput,
): Promise<TemporaryReelVideoCacheRecord> => {
  ensureCacheDirectoryAvailable()

  await ensureDirectory(TEMP_REEL_VIDEO_CACHE_DIR)
  await cleanupTempDirectories()

  const finalDir = getReelCacheDir(reel.id)
  const tempDir = getReelTempCacheDir(reel.id)

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

    const segmentBytes = await downloadWithConcurrency(resources)

    const localManifestUri = `${tempDir}offline.m3u8`
    await FileSystem.writeAsStringAsync(localManifestUri, rewrittenPlaylistText)

    const manifestBytes = await getFileSize(localManifestUri)
    const thumbnailResult = await downloadThumbnail(reel.thumbnailUrl, tempDir)

    await FileSystem.deleteAsync(finalDir, { idempotent: true }).catch(() => undefined)
    await FileSystem.moveAsync({ from: tempDir, to: finalDir })

    const downloadedAt = Date.now()
    const finalManifestUri = `${finalDir}offline.m3u8`
    const finalThumbnailUri = thumbnailResult?.localThumbnailUri
      ? `${finalDir}${thumbnailResult.localThumbnailUri.split('/').pop() ?? 'thumbnail.jpg'}`
      : undefined

    const record: TemporaryReelVideoCacheRecord = {
      reelId: reel.id,
      streamUrl: reel.streamUrl,
      localManifestUri: finalManifestUri,
      ...(finalThumbnailUri ? { localThumbnailUri: finalThumbnailUri } : {}),
      downloadedAt,
      lastAccessedAt: downloadedAt,
      segmentCount: resources.length,
      sizeBytes: segmentBytes + manifestBytes + (thumbnailResult?.sizeBytes ?? 0),
    }

    await upsertIndexRecord(record)
    notifyCacheStatus(reel.id, 'CACHED')

    return record
  } catch (error) {
    await FileSystem.deleteAsync(tempDir, { idempotent: true }).catch(() => undefined)
    notifyCacheStatus(reel.id, 'FAILED')
    throw error
  }
}

const pumpDownloadQueue = () => {
  if (activeDownloadCount >= MAX_ACTIVE_REEL_DOWNLOADS) {
    return
  }

  const nextJob = [...downloadJobs.values()]
    .filter((job) => job.status === 'QUEUED')
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }

      return a.addedAt - b.addedAt
    })[0]

  if (!nextJob) {
    return
  }

  void runDownloadJob(nextJob)
}

const runDownloadJob = async (job: DownloadJob) => {
  activeDownloadCount += 1
  job.status = 'DOWNLOADING'
  notifyCacheStatus(job.reel.id, 'DOWNLOADING')

  try {
    const record = await downloadReelVideoNow(job.reel)
    job.resolve(record)
  } catch {
    job.resolve(null)
  } finally {
    activeDownloadCount = Math.max(0, activeDownloadCount - 1)
    downloadJobs.delete(job.reel.id)
    pumpDownloadQueue()
  }
}

export const getTemporaryReelVideoCacheStatus = async (
  reelId: string,
): Promise<TemporaryReelVideoCacheStatus> => {
  const memoryStatus = statusByReelId.get(reelId)

  if (memoryStatus === 'QUEUED' || memoryStatus === 'DOWNLOADING') {
    return memoryStatus
  }

  const cachedRecord = await getCachedTemporaryReelVideo(reelId)
  return cachedRecord ? 'CACHED' : (memoryStatus ?? 'NOT_CACHED')
}

export const getCachedTemporaryReelVideo = async (
  reelId: string,
): Promise<TemporaryReelVideoCacheRecord | null> => {
  const record = await findReelVideoCacheRecordByReelId(reelId)

  if (!record) {
    return null
  }

  if (!(await fileExists(record.localManifestUri))) {
    await removeRecords([record])
    return null
  }

  const updatedRecord: TemporaryReelVideoCacheRecord = {
    ...toTemporaryReelVideoCacheRecord(record),
    lastAccessedAt: Date.now(),
  }

  await upsertReelVideoCacheRecord(toReelVideoCacheRecordInput(updatedRecord))
  notifyCacheStatus(reelId, 'CACHED')

  return updatedRecord
}

export const cacheTemporaryReelVideo = async (
  reel: TemporaryReelVideoCacheInput,
  options: { priority?: number } = {},
): Promise<TemporaryReelVideoCacheRecord | null> => {
  if (!reel.streamUrl) {
    return null
  }

  const existingRecord = await getCachedTemporaryReelVideo(reel.id)

  if (existingRecord?.streamUrl === reel.streamUrl) {
    notifyCacheStatus(reel.id, 'CACHED')
    return existingRecord
  }

  const existingJob = downloadJobs.get(reel.id)

  if (existingJob) {
    existingJob.priority = Math.min(existingJob.priority, options.priority ?? existingJob.priority)
    pumpDownloadQueue()
    return existingJob.promise
  }

  let resolveJob!: (record: TemporaryReelVideoCacheRecord | null) => void

  const promise = new Promise<TemporaryReelVideoCacheRecord | null>((resolve) => {
    resolveJob = resolve
  })

  const job: DownloadJob = {
    reel,
    priority: options.priority ?? 50,
    addedAt: Date.now(),
    status: 'QUEUED',
    promise,
    resolve: resolveJob,
  }

  downloadJobs.set(reel.id, job)
  notifyCacheStatus(reel.id, 'QUEUED')
  pumpDownloadQueue()

  return promise
}

export const enqueueTemporaryReelVideoCache = (
  reel: TemporaryReelVideoCacheInput | undefined | null,
  options: { priority?: number } = {},
) => {
  if (!reel?.id || !reel.streamUrl) {
    return
  }

  void cacheTemporaryReelVideo(reel, options).catch(() => null)
}

export const warmTemporaryReelVideoCache = (
  reels: (
    | (Pick<Reel, 'id' | 'streamUrl' | 'thumbnailUrl' | 'status'> & {
        priority?: number
      })
    | undefined
    | null
  )[],
) => {
  reels.forEach((reel) => {
    if (!reel || reel.status !== 'COMPLETED') {
      return
    }

    enqueueTemporaryReelVideoCache(
      {
        id: reel.id,
        streamUrl: reel.streamUrl,
        ...(reel.thumbnailUrl ? { thumbnailUrl: reel.thumbnailUrl } : {}),
      },
      { priority: reel.priority ?? 50 },
    )
  })
}

export const cleanupTemporaryReelVideoCache = async () => {
  ensureCacheDirectoryAvailable()
  await ensureDirectory(TEMP_REEL_VIDEO_CACHE_DIR)
  await cleanupTempDirectories()

  await evictTemporaryReelVideoCache(await getAllReelVideoCacheRecords())
}

export const clearTemporaryReelVideoCache = async () => {
  const records = await getAllReelVideoCacheRecords()

  await FileSystem.deleteAsync(TEMP_REEL_VIDEO_CACHE_DIR, { idempotent: true }).catch(
    () => undefined,
  )
  await deleteReelVideoCacheRecords(records)

  records.forEach((record) => {
    notifyCacheStatus(record.reelId, 'NOT_CACHED')
  })

  downloadJobs.clear()
  statusByReelId.clear()
}
