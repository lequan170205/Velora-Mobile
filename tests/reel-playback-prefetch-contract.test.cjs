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
    /const shouldUseOfflineVideo =\s*isRemotePlaybackReady &&\s*Boolean\(offlineRecord\) &&\s*\(!isOnline \|\| options\.preferOffline !== false\)/,
  )
  assert.match(
    offlineHook,
    /useState<TemporaryReelVideoCacheRecord \| null>\(\(\) =>\s*reel\.id \? getSyncCachedTemporaryReelVideo\(reel\.id\) : null/,
  )
})

test('ReelFeedItem keeps the online native source stable and uses offline playback only offline', () => {
  assert.match(reelFeedItem, /preferOffline: false/)
  assert.match(reelFeedItem, /activePlaybackUriRef/)
  assert.match(reelFeedItem, /offlineVideoSource\.isOfflineVideoActive/)
  assert.match(reelFeedItem, /const resolvedVideoUri = isUsingRemotePlaybackFallback/)
  assert.match(reelFeedItem, /uri=\{resolvedVideoUri\}/)
})

test('reel-prefetch parses HLS media playlist and prefetches initial segments', () => {
  assert.match(prefetch, /getInitialSegmentUrls/)
  assert.match(prefetch, /#EXT-X-MAP:/)
  assert.match(prefetch, /fetchBinaryQuietly/)
  assert.match(prefetch, /await response\.blob\(\)/)
  assert.match(prefetch, /PREFETCH_MEDIA_SEGMENT_COUNT = 2/)
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
})

test('every viewer defers full-HLS background saving until settled and pauses it on swipe', () => {
  assert.match(reelsViewer, /const REEL_CACHE_SETTLE_MS = 3000/)
  assert.match(reelsViewer, /const shouldDeferReelVideoCache = true/)
  assert.match(reelsViewer, /if \(!shouldDeferReelVideoCache \|\| isFetchingContextPage\)/)
  assert.match(
    reelsViewer,
    /reelSavingModeEnabled &&\s*\(!shouldDeferReelVideoCache \|\| isReelCacheSettled\)/,
  )
  assert.match(
    reelsViewer,
    /cancelQueuedTemporaryReelVideoCacheExcept\(allowedReelIds, \{\s*includeActive: shouldDeferReelVideoCache,?\s*\}\)/,
  )
  assert.match(offlineCache, /options\.includeActive/)
  assert.match(offlineCache, /downloadWithConcurrency\(resources, isCanceled\)/)
  assert.match(offlineCache, /if \(job\.isCanceled\) \{[\s\S]*notifyStoredCacheStatus/)
})

test('series episodes pill keeps the chevron separate and truncates only the title', () => {
  const pillBlock = reelFeedItem.slice(reelFeedItem.indexOf('episodes list'))
  assert.match(pillBlock, /ml-3 h-7 w-7 shrink-0/)
  assert.match(pillBlock, /min-w-0 shrink font-heading/)
})

test('reels rebuilt from chat metadata recover playback from the authoritative reel detail', () => {
  assert.match(
    reelFeedItem,
    /const needsPlaybackRecovery =\s*!isReelPlayable\(reel\) && !isReelMediaProcessing\(reel\) && !isReelMediaFailed\(reel\)/,
  )
  assert.match(reelFeedItem, /\(isActive && needsPlaybackRecovery\)/)
  assert.match(
    reelFeedItem,
    /reelDetail && !isReelPlayable\(nextReel\) && isReelPlayable\(reelDetail\)/,
  )
})

test('chat reel cards fall back to the reel detail thumbnail when the message thumbnail is missing or fails', () => {
  const chatReelCard = read('src/components/chat/ChatReelCard.tsx')
  assert.match(chatReelCard, /failedThumbnailUrls/)
  assert.match(chatReelCard, /!hasUsableMessageThumbnail/)
  assert.match(chatReelCard, /\[messageThumbnailUrl, reelDetail\?\.thumbnailUrl\]/)
  assert.match(chatReelCard, /onError=\{\(\) => \{/)
})

test('profile grids open the viewer with an in-memory context key instead of a JSON route param', () => {
  const store = read('src/lib/reelRouteContextStore.ts')
  const profileScreen = read('app/(tabs)/profile.tsx')
  const userProfileScreen = read('app/users/[username].tsx')
  const reelRoute = read('app/reels/[id]/index.tsx')

  assert.match(store, /export const stashReelRouteContext/)
  assert.match(store, /export const getStashedReelRouteContext/)
  assert.match(store, /MAX_STASHED_CONTEXTS/)
  for (const screen of [profileScreen, userProfileScreen]) {
    assert.match(screen, /stashReelRouteContext\(/)
    assert.doesNotMatch(screen, /serializeChatReelRouteContext/)
    assert.match(screen, /removeClippedSubviews/)
    assert.match(screen, /windowSize=\{PROFILE_GRID_WINDOW_SIZE\}/)
  }
  assert.match(reelRoute, /getStashedReelRouteContext\(normalizedContextReels\) \?\?/)
})

test('reel thumbnail tiles are memoized and keep a stable image cache key', () => {
  const grid = read('src/components/reels/ReelThumbnailGrid.tsx')

  assert.match(grid, /export const ReelThumbnailTile = memo\(/)
  assert.match(grid, /onPress=\{\(\) => onPress\(reel\)\}/)
  assert.match(grid, /cacheKey: `reel-thumbnail:\$\{reel\.id\}:/)
  assert.match(grid, /recyclingKey=\{reel\.id\}/)
})

test('reel feed page caching throttles the full-cache prune scan', () => {
  const reelOfflineCache = read('src/lib/reelOfflineCache.ts')

  assert.match(reelOfflineCache, /PRUNE_MIN_INTERVAL_MS/)
  assert.match(reelOfflineCache, /savedAt - lastPruneStartedAt >= PRUNE_MIN_INTERVAL_MS/)
})

test('paged context viewers re-anchor the pager when reels are inserted before the active one', () => {
  assert.match(reelsViewer, /const armPendingPagerSelection = useCallback/)
  assert.match(reelsViewer, /PENDING_PAGER_SELECTION_TIMEOUT_MS/)
  assert.doesNotMatch(reelsViewer, /pendingPagerSelectionReelIdRef\.current = reelsRef/)
  assert.match(
    reelsViewer,
    /anchoredIndex !== knownPagerIndex &&\s*pagerScrollStateRef\.current === 'idle'/,
  )
  assert.match(reelsViewer, /pager\.setPageWithoutAnimation\(anchoredIndex\)/)
})

test('paged context requests expire their guard, cover both edges, and re-check after a page lands', () => {
  assert.match(reelsViewer, /const CONTEXT_PAGE_REQUEST_COOLDOWN_MS = 1000/)
  assert.match(reelsViewer, /contextPageRequestStartedAtRef/)
  assert.doesNotMatch(reelsViewer, /contextPageRequestInFlightRef/)
  assert.match(reelsViewer, /isNearEnd && hasNextContextPage/)
  assert.match(reelsViewer, /isNearStart && hasPreviousContextPage/)
  assert.match(reelsViewer, /needsContextPageRecheckRef\.current = true/)
})

test('feed players recover from stalls the coordinator cannot see', () => {
  const reelVideo = read('src/components/reels/ReelVideo.tsx')
  assert.match(reelVideo, /minBufferForPlayback: 1\.5/)
  assert.match(reelVideo, /preferredForwardBufferDuration: 12/)
  assert.match(reelVideo, /if \(!shouldPlay \|\| !externallyManagedPlayback\)/)
  assert.match(reelVideo, /AppState\.currentState !== 'active'/)
  assert.match(reelVideo, /resuming player paused outside the coordinator/)
  assert.match(reelVideo, /reloading player stuck buffering/)
})

test('iOS streams HLS directly unless the localhost proxy is explicitly enabled', () => {
  const playbackCache = read('src/lib/reelPlaybackVideoCache.ts')
  assert.match(
    playbackCache,
    /IS_IOS_HLS_PROXY_ENABLED = process\.env\.EXPO_PUBLIC_REEL_IOS_HLS_PROXY === 'true'/,
  )
  assert.match(
    playbackCache,
    /const shouldUseHlsProxy = \(uri: string\) => IS_IOS_HLS_PROXY_ENABLED && isIosRemoteHlsUri\(uri\)/,
  )
  assert.match(
    playbackCache,
    /IS_IOS_HLS_PROXY_ENABLED\s*\?\s*startServer\([^)]*\)\s*:\s*Promise\.resolve\(\)/,
  )
  // expo-video's custom-scheme cache loader must stay off for iOS HLS in both modes.
  assert.match(
    playbackCache,
    /shouldUseNativeReelVideoCaching = \(uri: string\) => !isIosRemoteHlsUri\(uri\)/,
  )
})

test('warm players follow the network policy ahead and keep a small buffer while paused', () => {
  const reelVideo = read('src/components/reels/ReelVideo.tsx')
  assert.match(
    reelsViewer,
    /const warmAheadRadius = Math\.min\(\s*PAGE_RENDER_RADIUS,\s*Math\.max\(PRELOAD_RADIUS, reelCachePolicy\.preloadAheadCount\),?\s*\)/,
  )
  assert.match(
    reelsViewer,
    /pageDistance > 0 \? pageDistance <= warmAheadRadius : -pageDistance <= PRELOAD_RADIUS/,
  )
  assert.match(reelsViewer, /viewportHeight,\s*warmAheadRadius,\s*\],/)
  assert.match(reelVideo, /WARM_REEL_BUFFER_OPTIONS: VideoBufferOptions = \{[^}]*preferredForwardBufferDuration: 6/)
  assert.match(
    reelVideo,
    /player\.bufferOptions = shouldPlay \? REEL_BUFFER_OPTIONS : WARM_REEL_BUFFER_OPTIONS/,
  )
})
