import { clearCache, convertUrl, startServer } from 'expo-video-cache'
import { Platform } from 'react-native'

const REEL_VIDEO_CACHE_PORT = 9000
const REEL_VIDEO_CACHE_MAX_BYTES = 500 * 1024 * 1024

// The iOS HLS cache is a localhost HTTP proxy that rewrites playlists. Release builds on devices
// could not play reels through it (it also caches non-2xx playlist responses and never restarts a
// failed listener), so AVPlayer streams the CDN URL directly unless the proxy is opted back in.
const IS_IOS_HLS_PROXY_ENABLED = process.env.EXPO_PUBLIC_REEL_IOS_HLS_PROXY === 'true'

const isRemoteHlsUri = (uri: string) => /^https?:\/\//i.test(uri) && /\.m3u8($|[?#])/i.test(uri)

const isIosRemoteHlsUri = (uri: string) => Platform.OS === 'ios' && isRemoteHlsUri(uri)

const shouldUseHlsProxy = (uri: string) => IS_IOS_HLS_PROXY_ENABLED && isIosRemoteHlsUri(uri)

export const initializeReelPlaybackVideoCache = () =>
  IS_IOS_HLS_PROXY_ENABLED
    ? startServer(REEL_VIDEO_CACHE_PORT, REEL_VIDEO_CACHE_MAX_BYTES, true)
    : Promise.resolve()

export const getReelPlaybackVideoUri = (uri: string) =>
  shouldUseHlsProxy(uri) ? convertUrl(uri) : uri

// expo-video's own iOS cache wraps the URL in a custom-scheme resource loader that only supports
// progressive files, so it must stay off for HLS whether or not the proxy is in use.
export const shouldUseNativeReelVideoCaching = (uri: string) => !isIosRemoteHlsUri(uri)

export const clearReelPlaybackVideoCache = () => {
  if (Platform.OS !== 'ios') {
    return Promise.resolve()
  }

  return clearCache()
}
