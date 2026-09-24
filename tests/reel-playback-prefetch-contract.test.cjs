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
const reelsViewer = read('src/components/reels/ReelsViewer.tsx')
const playbackCoordinator = read('src/lib/reelPlaybackCoordinator.ts')

test('offline video cache provides synchronous record access and maintains memory cache', () => {
  assert.match(
    offlineCache,
    /memoryCachedRecordsByReelId = new Map<string, TemporaryReelVideoCacheRecord>\(\)/,
  )
  assert.match(offlineCache, /export const getSyncCachedTemporaryReelVideo = \(/)
  assert.match(offlineCache, /const record = memoryCachedRecordsByReelId\.get\(reelId\)/)
  assert.match(offlineCache, /return record \?\? null/)
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
  assert.match(
    reelFeedItem,
    /const resolvedVideoUri = isUsingRemotePlaybackFallback\s*\? displayReel\.streamUrl\s*: activePlaybackUriRef\.current \|\| offlineVideoSource\.uri/,
  )
  assert.match(reelFeedItem, /uri=\{resolvedVideoUri\}/)
})

test('reel-prefetch parses HLS media playlist and prefetches initial segments', () => {
  assert.match(prefetch, /getInitialSegmentUrls/)
  assert.match(prefetch, /#EXT-X-MAP:/)
  assert.match(prefetch, /fetchBinaryQuietly/)
  assert.match(prefetch, /await response\.blob\(\)/)
})

test('playlist prefetch and offline caching skip non-HLS video URLs', () => {
  assert.match(offlineCache, /export const isHlsReelUrl/)
  assert.match(offlineCache, /if \(record && !isHlsReelUrl\(record\.streamUrl\)\)/)
  assert.match(
    offlineCache,
    /if \(!isHlsReelUrl\(record\.streamUrl\)\) \{\s*await removeRecords\(\[record\]\)/,
  )
  assert.match(offlineCache, /if \(!isHlsReelUrl\(url\)\)/)
  assert.match(offlineCache, /if \(!isHlsReelUrl\(reel\.streamUrl\)\)\s*\{\s*return null/)
  assert.match(prefetch, /if \(!isHlsReelUrl\(url\) \|\| hasPrefetchedUrl\(url\)\)/)
  assert.match(prefetch, /if \(!isHlsReelUrl\(reel\.streamUrl\)\)/)
  assert.match(offlineHook, /isHlsReelUrl\(reel\.streamUrl\)/)
})

test('native pager keeps a bounded, scrollable reel window and switches audio at page selection', () => {
  assert.match(reelsViewer, /const PAGER_WINDOW_RADIUS = DEFAULT_REELS_LIMIT \* 2/)
  assert.match(reelsViewer, /const PAGER_WINDOW_SIZE = PAGER_WINDOW_RADIUS \* 2 \+ 1/)
  assert.match(
    reelsViewer,
    /reels\.slice\(visiblePagerWindowStart, visiblePagerWindowStart \+ PAGER_WINDOW_SIZE\)/,
  )
  assert.match(reelsViewer, /initialPage=\{initialPagerPage\}/)
  assert.match(reelsViewer, /setPageWithoutAnimation\(pendingIndex - visiblePagerWindowStart\)/)
  assert.match(reelsViewer, /const maybeRecenterPagerWindow = useCallback/)
  assert.match(reelsViewer, /pendingPagerWindowIndexRef\.current = index/)
  assert.match(reelsViewer, /pagerWindowStartRef\.current \+ event\.nativeEvent\.position/)
  assert.match(reelsViewer, /maybeRecenterPagerWindow\(nextIndex\)/)
  assert.doesNotMatch(reelsViewer, /reels\.map\(renderReelPage\)/)
  assert.match(
    reelsViewer,
    /currentActiveReelId && reels\.some\(\(item\) => item\.id === currentActiveReelId\)/,
  )
  assert.match(reelsViewer, /onPageSelected=\{handlePageSelected\}/)
  assert.match(reelsViewer, /playbackCoordinatorRef\.current\.transition\(nextReelId, isMuted\)/)
  assert.match(playbackCoordinator, /this\.desiredReelId === nextReelId/)
  assert.match(playbackCoordinator, /this\.pendingSeekTimers\.has\(nextReelId\)/)
  assert.match(reelFeedItem, /scrubUpdateSample\.value = \(scrubUpdateSample\.value \+ 1\) % 6/)
  assert.match(
    reelFeedItem,
    /if \(scrubUpdateSample\.value === 0\) \{\s*scheduleOnRN\(updateScrub, event\.x\)/,
  )
})
