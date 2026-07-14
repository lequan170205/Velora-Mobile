import { clearCache, convertUrl, startServer } from 'expo-video-cache'
import { Platform } from 'react-native'

const REEL_VIDEO_CACHE_PORT = 9000
const REEL_VIDEO_CACHE_MAX_BYTES = 500 * 1024 * 1024

const isRemoteHlsUri = (uri: string) => /^https?:\/\//i.test(uri) && /\.m3u8($|[?#])/i.test(uri)

const shouldUseHlsProxy = (uri: string) => Platform.OS === 'ios' && isRemoteHlsUri(uri)

export const initializeReelPlaybackVideoCache = () =>
  startServer(REEL_VIDEO_CACHE_PORT, REEL_VIDEO_CACHE_MAX_BYTES, true)

export const getReelPlaybackVideoUri = (uri: string) =>
  shouldUseHlsProxy(uri) ? convertUrl(uri) : uri

export const shouldUseNativeReelVideoCaching = (uri: string) => !shouldUseHlsProxy(uri)

export const clearReelPlaybackVideoCache = () => {
  if (Platform.OS !== 'ios') {
    return Promise.resolve()
  }

  return clearCache()
}
