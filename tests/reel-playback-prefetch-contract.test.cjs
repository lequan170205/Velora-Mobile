const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const offlineCache = read('src/lib/offlineReelVideoCache.ts')
const offlineHook = read('src/hooks/useOfflineReelVideoSource.ts')
const prefetch = read('src/lib/reel-prefetch.ts')
const reelFeedItem = read('src/components/reels/ReelFeedItem.tsx')

test('offline video cache provides synchronous record access and maintains memory cache', () => {
  assert.match(offlineCache, /memoryCachedRecordsByReelId = new Map<string, TemporaryReelVideoCacheRecord>\(\)/)
  assert.match(offlineCache, /export const getSyncCachedTemporaryReelVideo = \(/)
  assert.match(offlineCache, /return memoryCachedRecordsByReelId\.get\(reelId\) \?\? null/)
})

test('useOfflineReelVideoSource uses synchronous cache and defaults to preferring offline playback', () => {
  assert.match(offlineHook, /getSyncCachedTemporaryReelVideo/)
  assert.match(
    offlineHook,
    /const shouldUseOfflineVideo =\s*Boolean\(offlineRecord\) && \(!isOnline \|\| options\.preferOffline !== false\)/,
  )
  assert.match(
    offlineHook,
    /useState<TemporaryReelVideoCacheRecord \| null>\(\(\) =>\s*reel\.id \? getSyncCachedTemporaryReelVideo\(reel\.id\) : null/,
  )
})

test('ReelFeedItem requests preferred offline playback and stabilizes active playback URI', () => {
  assert.match(reelFeedItem, /preferOffline: true/)
  assert.match(reelFeedItem, /activePlaybackUriRef/)
  assert.match(reelFeedItem, /const resolvedVideoUri = activePlaybackUriRef\.current \|\| offlineVideoSource\.uri/)
  assert.match(reelFeedItem, /uri=\{resolvedVideoUri\}/)
})

test('reel-prefetch parses HLS media playlist and prefetches initial segments', () => {
  assert.match(prefetch, /getInitialSegmentUrls/)
  assert.match(prefetch, /#EXT-X-MAP:/)
  assert.match(prefetch, /fetchBinaryQuietly/)
  assert.match(prefetch, /await response\.blob\(\)/)
})
