import { Image as ExpoImage } from 'expo-image'

import { warmTemporaryReelVideoCache } from './offlineReelVideoCache'

import type { Reel } from '../types/reel.types'

const MAX_PREFETCHED_URLS = 160
const prefetchedUrls = new Set<string>()

const rememberPrefetchedUrl = (url: string) => {
  prefetchedUrls.add(url)

  if (prefetchedUrls.size <= MAX_PREFETCHED_URLS) {
    return
  }

  const [oldestUrl] = prefetchedUrls

  if (oldestUrl) {
    prefetchedUrls.delete(oldestUrl)
  }
}

const hasPrefetchedUrl = (url: string) => prefetchedUrls.has(url)

const toAbsoluteUrl = (baseUrl: string, value: string) => {
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return null
  }
}

const fetchTextQuietly = async (url: string) => {
  if (hasPrefetchedUrl(url)) {
    return null
  }

  try {
    rememberPrefetchedUrl(url)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
      },
    })

    if (!response.ok) {
      return null
    }

    return await response.text()
  } catch {
    return null
  }
}

const fetchBinaryQuietly = async (url: string) => {
  if (hasPrefetchedUrl(url)) {
    return
  }

  try {
    rememberPrefetchedUrl(url)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    })

    if (!response.ok) {
      return
    }

    await response.blob()
  } catch {
    // Silently ignore prefetch network errors
  }
}

const getFirstVariantPlaylistUrl = (masterUrl: string, masterPlaylistText: string) => {
  const lines = masterPlaylistText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (line.startsWith('#')) {
      continue
    }

    if (!line.toLowerCase().includes('.m3u8')) {
      continue
    }

    return toAbsoluteUrl(masterUrl, line)
  }

  return null
}

const getInitialSegmentUrls = (mediaPlaylistUrl: string, mediaPlaylistText: string) => {
  const lines = mediaPlaylistText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const segmentUrls: string[] = []

  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP:')) {
      const uriMatch = line.match(/URI=["']?([^"']+)["']?/)
      if (uriMatch?.[1]) {
        const initUrl = toAbsoluteUrl(mediaPlaylistUrl, uriMatch[1])
        if (initUrl) {
          segmentUrls.push(initUrl)
        }
      }
      continue
    }

    if (line.startsWith('#')) {
      continue
    }

    const segmentUrl = toAbsoluteUrl(mediaPlaylistUrl, line)
    if (segmentUrl) {
      segmentUrls.push(segmentUrl)
      // Only prefetch the first media segment to prime playback without wasting bandwidth
      break
    }
  }

  return segmentUrls
}

export const prefetchReelAssets = async (
  reel?: Pick<Reel, 'thumbnailUrl' | 'streamUrl'> | null,
) => {
  if (!reel) {
    return
  }

  if (reel.thumbnailUrl && !hasPrefetchedUrl(reel.thumbnailUrl)) {
    rememberPrefetchedUrl(reel.thumbnailUrl)
    void ExpoImage.prefetch(reel.thumbnailUrl).catch(() => undefined)
  }

  if (!reel.streamUrl) {
    return
  }

  const masterPlaylistText = await fetchTextQuietly(reel.streamUrl)

  if (!masterPlaylistText) {
    return
  }

  const isMediaPlaylist = masterPlaylistText.includes('#EXTINF:')
  const variantPlaylistUrl = isMediaPlaylist
    ? reel.streamUrl
    : getFirstVariantPlaylistUrl(reel.streamUrl, masterPlaylistText)

  if (!variantPlaylistUrl) {
    return
  }

  const variantPlaylistText = isMediaPlaylist
    ? masterPlaylistText
    : await fetchTextQuietly(variantPlaylistUrl)

  if (!variantPlaylistText) {
    return
  }

  const segmentUrls = getInitialSegmentUrls(variantPlaylistUrl, variantPlaylistText)
  await Promise.all(segmentUrls.map((segmentUrl) => fetchBinaryQuietly(segmentUrl)))
}

export const prefetchReelsForTemporaryOfflinePlayback = (
  reels: (
    | (Pick<Reel, 'id' | 'thumbnailUrl' | 'streamUrl' | 'status'> & {
        priority?: number
      })
    | undefined
    | null
  )[],
  options: { maxBytes?: number } = {},
) => {
  warmTemporaryReelVideoCache(reels, options)
}
