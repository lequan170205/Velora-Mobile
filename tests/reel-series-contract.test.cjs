const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const reelTypes = read('src/types/reel.types.ts')
const reelsApi = read('src/api/reels.api.ts')
const reelsHook = read('src/hooks/useReels.ts')
const reelFeedItem = read('src/components/reels/ReelFeedItem.tsx')
const reelsViewer = read('src/components/reels/ReelsViewer.tsx')
const seriesScreen = fs.existsSync(path.join(root, 'app/series/[id]/index.tsx'))
  ? read('app/series/[id]/index.tsx')
  : read('app/series/[id].tsx')
const seriesManageScreen = read('app/series/[id]/manage.tsx')
const ownedSeriesScreen = read('app/series/index.tsx')
const profileScreen = read('app/(tabs)/profile.tsx')
const reelEditScreen = read('app/reels/[id]/edit.tsx')
const publishStage = read('src/components/reels/create/publish-stage.tsx')
const seriesPicker = read('src/components/reels/series/ReelSeriesPickerSheet.tsx')
const reelCreatorHook = read('src/hooks/useReelCreator.ts')
const reelCacheMappers = read('src/database/reels/reelCacheMappers.ts')
const databaseSchema = read('src/database/schema.ts')
const databaseMigrations = read('src/database/migrations.ts')
const episodePicker = read('src/components/reels/series/ReelEpisodePickerSheet.tsx')
const queryKeysSource = read('src/constants/queryKeys.ts')

const loadReelsApi = () => {
  const compiled = ts.transpileModule(reelsApi, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const calls = []
  const mockApiClient = {
    get: async (url, config) => {
      calls.push({ method: 'GET', url, config })
      return { data: { items: [{ id: 'reel-cand-1' }], nextCursor: 'cursor-next-1' } }
    },
    post: async (url, data) => {
      calls.push({ method: 'POST', url, data })
      return { data: { id: 'series-1', reels: [] } }
    },
  }
  const context = {
    module: { exports: {} },
    exports: {},
    require: (id) => {
      if (id === './client') return { apiClient: mockApiClient }
      if (id.includes('recommendationFeed')) return { parseRecommendedReelsResponse: (x) => x }
      if (id.includes('reelProcessing'))
        return {
          normalizeReelApiResponse: (x) => x,
          normalizeReelProcessingStatusResponse: (x) => x,
        }
      if (id === 'axios') return { isAxiosError: () => false }
      throw new Error(`Unexpected dependency in reels.api: ${id}`)
    },
  }
  context.exports = context.module.exports
  vm.runInNewContext(compiled, context)
  return { reelsApiModule: context.module.exports.reelsApi, calls }
}

const loadManageScreen = () => {
  const compiled = ts.transpileModule(seriesManageScreen, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  const context = {
    module: { exports: {} },
    exports: {},
    require: () => ({}),
  }
  context.exports = context.module.exports
  vm.runInNewContext(compiled, context)
  return context.module.exports
}

const loadReelCacheMappers = () => {
  const compiled = ts.transpileModule(reelCacheMappers, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const context = {
    module: { exports: {} },
    exports: {},
    require: (moduleId) => {
      if (moduleId === '../../constants/reels') {
        return { DEFAULT_REELS_LIMIT: 12 }
      }

      if (moduleId === '../../types/recommendation.types') {
        return {
          RECOMMENDATION_CANDIDATE_SOURCES: [
            'RECENT_QUALITY',
            'TRENDING',
            'TAG_AFFINITY',
            'CREATOR_AFFINITY',
            'CONTENT_SIMILARITY',
            'SEMANTIC',
            'SOCIAL',
            'EXPLORATION',
          ],
        }
      }

      throw new Error(`Unexpected mapper dependency: ${moduleId}`)
    },
  }
  context.exports = context.module.exports
  vm.runInNewContext(compiled, context)
  return context.module.exports
}

test('reel and series types align with the backend contract', () => {
  assert.match(reelTypes, /export type ReelVisibility = 'public' \| 'friends' \| 'private'/)
  assert.match(reelTypes, /export interface ReelSeriesSummary/)
  assert.match(reelTypes, /series\?: ReelSeriesSummary/)
  assert.match(reelTypes, /export interface ReelSeries/)
  assert.match(reelTypes, /export interface CreateReelSeriesPayload/)
  assert.match(reelTypes, /export interface UpdateReelSeriesPayload/)
  assert.match(reelTypes, /export interface AddReelToSeriesPayload/)
  assert.match(reelTypes, /export interface ReorderReelSeriesPayload/)
  assert.match(reelTypes, /export interface ListReelSeriesParams/)
  assert.match(reelTypes, /export interface PaginatedReelSeries/)
})

test('series API operations normalize every returned reel through the shared normalizer', () => {
  assert.match(
    reelsApi,
    /const normalizeReelSeriesResponse = \(series: ReelSeries\): ReelSeries => \(\{[\s\S]*reels: series\.reels\.map\(normalizeReelApiResponse\)/,
  )
  assert.match(reelsApi, /post<ReelSeries>\('\/content\/series', data\)/)
  assert.match(reelsApi, /get<ReelSeries>\(`\/content\/series\/\$\{id\}`\)/)
  assert.match(reelsApi, /patch<ReelSeries>\(`\/content\/series\/\$\{id\}`, data\)/)
  assert.match(reelsApi, /delete\(`\/content\/series\/\$\{id\}`\)/)
  assert.match(reelsApi, /post<ReelSeries>\(`\/content\/series\/\$\{seriesId\}\/reels`, data\)/)
  assert.match(
    reelsApi,
    /delete<ReelSeries>\([\s\S]*\/content\/series\/\$\{seriesId\}\/reels\/\$\{reelId\}/,
  )
  assert.match(
    reelsApi,
    /patch<ReelSeries>\([\s\S]*\/content\/series\/\$\{seriesId\}\/reels\/order/,
  )
  assert.match(reelsApi, /get<PaginatedReelSeries>\('\/content\/series'/)
})

test('owned Series pagination uses opaque cursors and a focused Series-list query key', () => {
  assert.match(reelsHook, /export function useOwnedReelSeries/)
  assert.match(reelsHook, /getNextPageParam: \(lastPage\) => lastPage\.nextCursor \?\? undefined/)
  assert.match(reelsHook, /reelsApi\.listOwnedSeries/)
  assert.match(reelsHook, /queryKeys\.reels\.seriesList\(viewerId, queryParams\)/)
})

test('series hooks use focused query keys and do not invalidate recommendation sessions', () => {
  const start = reelsHook.indexOf('export function useReelSeries')
  const end = reelsHook.indexOf('export function useReelProcessingStatus', start)
  const seriesHooks = reelsHook.slice(start, end)

  for (const hookName of [
    'useReelSeries',
    'useCreateReelSeries',
    'useUpdateReelSeries',
    'useDeleteReelSeries',
    'useAddReelToSeries',
    'useRemoveReelFromSeries',
    'useReorderReelSeries',
  ]) {
    assert.match(seriesHooks, new RegExp(`export function ${hookName}`))
  }

  assert.match(seriesHooks, /queryKeys\.reels\.series\(viewerId, id \|\| 'unknown'\)/)
  assert.doesNotMatch(seriesHooks, /recommended\(/)
  assert.doesNotMatch(seriesHooks, /invalidateQueries/)
})

test('offline Reel persistence round-trips Series metadata without losing recommendation metadata', () => {
  const { serializeReelToCachedReelInput, deserializeCachedReelToReel } = loadReelCacheMappers()
  const recommendation = {
    recommendationId: 'rec-1',
    feedSessionId: 'session-1',
    algorithmVersion: 'v2',
    candidateSource: 'SEMANTIC',
    rank: 7,
    generatedAt: '2026-09-18T00:00:00.000Z',
  }
  const reel = {
    id: 'reel-1',
    userId: 'user-1',
    mediaKey: 'reels/reel-1.mp4',
    tags: ['travel'],
    status: 'COMPLETED',
    visibility: 'friends',
    viewCount: 3,
    streamUrl: 'https://example.test/reel.m3u8',
    createdAt: '2026-09-18T00:00:00.000Z',
    series: { id: 'series-1', title: 'Travel Vietnam', episodeNumber: 3 },
    recommendation,
  }

  const cached = serializeReelToCachedReelInput(reel)
  const restored = deserializeCachedReelToReel(cached)

  assert.deepEqual(JSON.parse(JSON.stringify(restored.series)), reel.series)
  assert.deepEqual(JSON.parse(JSON.stringify(restored.recommendation)), recommendation)
  assert.equal(restored.visibility, 'friends')

  const withoutSeries = deserializeCachedReelToReel(
    serializeReelToCachedReelInput({ ...reel, series: undefined }),
  )
  assert.equal(withoutSeries.series, undefined)
})

test('offline schema adds one nullable Series field through an additive migration', () => {
  assert.match(reelCacheMappers, /seriesJson: serializeReelSeriesSummary\(reel\.series\)/)
  assert.match(reelCacheMappers, /deserializeReelSeriesSummary\(record\.seriesJson\)/)
  assert.match(databaseSchema, /\{ name: 'series_json', type: 'string', isOptional: true \}/)
  assert.match(databaseSchema, /version: 8/)
  assert.match(databaseMigrations, /toVersion: 8[\s\S]*series_json/)
})

test('series indicator is conditional, accessible, and routes with Series and current Reel IDs', () => {
  assert.match(reelFeedItem, /\{displayReel\.series(?: && !isSeriesPlayback)? \? \(/)
  assert.match(
    reelFeedItem,
    /accessibilityLabel=\{`Open \$\{displayReel\.series\.title\}, episode \$\{displayReel\.series\.episodeNumber\}`\}/,
  )
  assert.match(reelFeedItem, /accessibilityRole="button"/)
  assert.match(
    reelFeedItem,
    /displayReel\.series\.title\} · Episode \{displayReel\.series\.episodeNumber\}/,
  )
  assert.match(reelFeedItem, /encodeURIComponent\(displayReel\.series\.id\)/)
  assert.match(reelFeedItem, /reelId=\$\{encodeURIComponent\(displayReel\.id\)\}/)

  // Series badge is placed before avatar row
  const seriesBadgeIndex = reelFeedItem.indexOf('displayReel.series && !isSeriesPlayback')
  const avatarRowIndex = reelFeedItem.indexOf('canOpenAuthorProfile ? `Open ${authorUsernameLine}')
  assert.ok(seriesBadgeIndex > 0 && seriesBadgeIndex < avatarRowIndex)

  // Episode button is rendered under tags for series playback
  assert.match(reelFeedItem, /isSeriesPlayback && onOpenSeriesEpisodes \? \(/)
  assert.match(reelFeedItem, /video-library/)
})

test('series screen preserves backend order and starts at the requested episode with a safe fallback', () => {
  assert.match(seriesScreen, /useReelSeries\(seriesId\)/)
  assert.match(seriesScreen, /series\.reels\.some\(\(reel\) => reel\.id === requestedReelId\)/)
  assert.match(seriesScreen, /return series\.reels\[0\]\?\.id/)
  assert.match(seriesScreen, /contextItems=\{series\.reels\}/)
  assert.match(seriesScreen, /reelId=\{(?:activeReelId|initialReelId)\}/)
  assert.match(seriesScreen, /eventSource="DIRECT"/)
  assert.match(seriesScreen, /series\.title/)
  assert.match(seriesScreen, /series\.description/)
  assert.match(seriesScreen, /series\.reels\.length/)
  assert.match(seriesScreen, /\/series\/\[id\]\/manage/)
})

test('publish flow uploads once before Series creation or attachment and keeps audience in sync', () => {
  const publishStart = reelCreatorHook.indexOf('const handlePublish = useCallback')
  const publishEnd = reelCreatorHook.indexOf('const handleEditorProgress', publishStart)
  const publishFlow = reelCreatorHook.slice(publishStart, publishEnd)

  assert.ok(
    publishFlow.indexOf('createReelAsync(payload)') < publishFlow.indexOf('createReelSeriesAsync'),
  )
  assert.ok(
    publishFlow.indexOf('createReelAsync(payload)') < publishFlow.indexOf('addReelToSeriesAsync'),
  )
  assert.match(publishFlow, /effectiveVisibility = currentSeries\.visibility/)
  assert.match(publishFlow, /deleteReelSeriesAsync\(createdSeriesId\)/)
  assert.match(publishFlow, /Alert\.alert\('Reel published'/)
  assert.match(publishStage, /ReelSeriesPickerSheet/)
  assert.match(publishStage, /Episodes in a series share the same audience/)
  assert.match(publishStage, /label: 'Friends'/)
  assert.match(
    publishStage,
    /flex-1 flex-row items-center justify-center rounded-\[18px\] px-2 py-3/,
  )
  assert.match(seriesPicker, /Create new series/)
  assert.match(seriesPicker, /No series/)
  assert.match(
    seriesPicker,
    /min-h-12 flex-1 flex-row items-center justify-center rounded-\[18px\]/,
  )
  assert.match(seriesPicker, /ml-2 text-xs2 font-semibold/)
})

test('reel edit Series changes use rollback-safe remove, visibility, and add ordering', () => {
  const removeIndex = reelEditScreen.indexOf('removeFromSeries.mutateAsync')
  const visibilityIndex = reelEditScreen.indexOf('updateReel.mutateAsync', removeIndex)
  const addIndex = reelEditScreen.indexOf('addToSeries.mutateAsync', visibilityIndex)

  assert.ok(removeIndex >= 0)
  assert.ok(visibilityIndex > removeIndex)
  assert.ok(addIndex > visibilityIndex)
  assert.match(reelEditScreen, /oldEpisodeNumber/)
  assert.match(reelEditScreen, /seriesId: oldSeriesId/)
  assert.match(reelEditScreen, /episodeNumber: oldEpisodeNumber/)
  assert.match(reelEditScreen, /Episodes in a series share the same audience/)
  assert.match(reelEditScreen, /createAndSelectSeries/)
  assert.match(reelEditScreen, /deleteSeries\.mutateAsync\(created\.id\)/)
})

test('owner management supports metadata, audience, reorder, remove, and safe Series deletion', () => {
  assert.match(seriesManageScreen, /useUpdateReelSeries/)
  assert.match(seriesManageScreen, /useReorderReelSeries/)
  assert.match(seriesManageScreen, /useRemoveReelFromSeries/)
  assert.match(seriesManageScreen, /useDeleteReelSeries/)
  assert.match(seriesManageScreen, /Changing the audience updates every episode in this series/)
  assert.match(
    seriesManageScreen,
    /min-h-\[42px\] flex-1 flex-row items-center justify-center rounded-\[14px\]/,
  )
  assert.match(seriesManageScreen, /NestableDraggableFlatList/)
  assert.match(
    seriesManageScreen,
    /(?:Long-press|Drag) (?:a handle|an episode) to reorder, then save once/,
  )
  assert.match(
    seriesManageScreen,
    /onDragEnd=\{\(\{ data \}\) => (?:setOrderedReels\(data\)|\{[\s\S]*?setOrderedReels\(data\))/,
  )
  assert.doesNotMatch(seriesManageScreen, /Episodes \(\{orderedReels\.length\}\)/)
  assert.match(seriesManageScreen, /Reels stay published; only the Series is removed/)
  assert.match(seriesManageScreen, /response\?\.status === 409/)
})

test('profile and owned-Series screen expose owner Series discovery and creation', () => {
  assert.match(profileScreen, /useOwnedReelSeries\(\{ limit: 6 \}/)
  assert.match(profileScreen, /SeriesHighlight/)
  assert.match(profileScreen, /createSeriesSheetRef\.current\?\.present\(\)/)
  assert.match(profileScreen, /type ProfileContentTab = 'public' \| 'series' \| 'private'/)
  assert.match(profileScreen, /\{ icon: 'grid-on', label: 'Public', value: 'public' \}/)
  assert.match(profileScreen, /\{ icon: 'video-library', label: 'Series', value: 'series' \}/)
  assert.match(profileScreen, /\{ icon: 'lock-outline', label: 'Private', value: 'private' \}/)
  assert.match(profileScreen, /function EmptySeriesState/)
  assert.match(profileScreen, /No series yet/)
  assert.match(profileScreen, /Create series/)
  assert.match(profileScreen, /items-center px-5 pb-2 pt-7/)
  assert.match(ownedSeriesScreen, /useOwnedReelSeries\(\{ limit: 20 \}\)/)
  assert.match(ownedSeriesScreen, /initialMode="create"/)
  assert.match(ownedSeriesScreen, /useCreateReelSeries/)
  assert.match(ownedSeriesScreen, /fetchNextPage/)
})

test('series playback uses ReelsViewer local context as a strict non-paginating boundary', () => {
  assert.match(
    reelsViewer,
    /const shouldUseLocalContext = shouldUseReelContext && contextItems\.length > 0/,
  )
  assert.match(
    reelsViewer,
    /const shouldFetchReelContext = shouldUseReelContext && !shouldUseLocalContext/,
  )
  assert.match(
    reelsViewer,
    /if \([\s\S]*!shouldUseReelContext \|\|[\s\S]*shouldUseLocalContext \|\|[\s\S]*!reelContext\?\.scope/,
  )
  assert.match(
    reelsViewer,
    /shouldUseReelContext &&[\s\S]*!shouldUseLocalContext &&[\s\S]*contextNextCursor/,
  )
  assert.match(
    reelsViewer,
    /return contextItems\.filter\(\(item\) => !deletedReelIds\.has\(item\.id\)\)/,
  )
})

test('candidate API requests target candidate-reels endpoint with pagination and normalization', async () => {
  assert.match(
    reelsApi,
    /get<PaginatedSeriesCandidateReels>\([\s\S]*\/content\/series\/\$\{seriesId\}\/candidate-reels[\s\S]*params/,
  )
  assert.match(reelsHook, /export function useReelSeriesCandidates/)
  assert.match(
    reelsHook,
    /queryKeys\.reels\.seriesCandidateList\([\s\S]*viewerId,\s*seriesId \|\| 'unknown',\s*queryParams/,
  )
  assert.match(reelsHook, /getNextPageParam: \(lastPage\) => lastPage\.nextCursor \?\? undefined/)
  assert.match(queryKeysSource, /allSeriesCandidates/)
  assert.match(queryKeysSource, /seriesCandidates/)
  assert.match(queryKeysSource, /seriesCandidateList/)

  const { reelsApiModule, calls } = loadReelsApi()
  const result = await reelsApiModule.getSeriesCandidateReels('series-test-1', {
    limit: 25,
    cursor: 'cursor-abc',
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'GET')
  assert.equal(calls[0].url, '/content/series/series-test-1/candidate-reels')
  assert.deepEqual(calls[0].config.params, { limit: 25, cursor: 'cursor-abc' })
  assert.equal(result.nextCursor, 'cursor-next-1')
  assert.equal(result.items.length, 1)
})

test('batch add endpoint uses { reelIds } payload and validates batch payload contract', async () => {
  assert.match(
    reelTypes,
    /export interface AddReelToSeriesPayload\s*\{\s*reelIds:\s*string\[\]\s*\}/,
  )
  assert.doesNotMatch(reelTypes, /export interface AddReelToSeriesPayload\s*\{[^}]*reelId:/)

  const { reelsApiModule, calls } = loadReelsApi()
  await reelsApiModule.addReelToSeries('series-test-2', {
    reelIds: ['reel-a', 'reel-b', 'reel-c'],
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, '/content/series/series-test-2/reels')
  assert.deepEqual(calls[0].data, {
    reelIds: ['reel-a', 'reel-b', 'reel-c'],
  })
})

test('episode picker makes no Reel visibility update and uses candidate endpoint as source of truth', () => {
  assert.doesNotMatch(episodePicker, /useUpdateReel/)
  assert.doesNotMatch(episodePicker, /updateReel/)
  assert.doesNotMatch(episodePicker, /useReelsFeed/)
  assert.match(episodePicker, /useReelSeriesCandidates\(seriesId/)
  assert.match(episodePicker, /There are no compatible standalone reels available for this series/)
})

test('selecting multiple Reels produces exactly one batch add request preserving tap order', () => {
  assert.match(
    episodePicker,
    /await addReels\.mutateAsync\(\{\s*seriesId,\s*data:\s*\{\s*reelIds:\s*selectedIds\s*\},?\s*\}\)/,
  )
  assert.doesNotMatch(episodePicker, /for\s*\([^)]*\)\s*\{[\s\S]*addReel/i)
  assert.match(episodePicker, /\[\.\.\.prev,\s*reel\.id\]/)
})

test('deletion and removal invalidate necessary Series caches and candidate queries', () => {
  // In useDeleteReel:
  const deleteReelBlock = reelsHook.slice(reelsHook.indexOf('export function useDeleteReel()'))
  assert.match(
    deleteReelBlock,
    /invalidateQueries\(\{\s*queryKey:\s*queryKeys\.reels\.seriesLists\(viewerId\)\s*\}\)/,
  )
  assert.match(deleteReelBlock, /queryKey\[2\] === 'series'/)
  assert.match(
    deleteReelBlock,
    /invalidateQueries\(\{\s*queryKey:\s*queryKeys\.reels\.allSeriesCandidates\(viewerId\),?\s*\}\)/,
  )

  // In useRemoveReelFromSeries:
  const removeEpisodeBlock = reelsHook.slice(
    reelsHook.indexOf('export function useRemoveReelFromSeries()'),
    reelsHook.indexOf('export function useReorderReelSeries()'),
  )
  assert.match(removeEpisodeBlock, /refreshSeriesCandidates\(queryClient,\s*viewerId,\s*seriesId\)/)

  // In useAddReelToSeries:
  const addReelBlock = reelsHook.slice(
    reelsHook.indexOf('export function useAddReelToSeries()'),
    reelsHook.indexOf('export function useRemoveReelFromSeries()'),
  )
  assert.match(addReelBlock, /refreshSeriesCandidates\(queryClient,\s*viewerId,\s*seriesId\)/)
})

test('candidate queries refresh after Series visibility changes and access-broadening confirms', () => {
  // useUpdateReelSeries refreshes candidate queries
  const updateSeriesBlock = reelsHook.slice(
    reelsHook.indexOf('export function useUpdateReelSeries()'),
    reelsHook.indexOf('export function useDeleteReelSeries()'),
  )
  assert.match(
    updateSeriesBlock,
    /refreshSeriesCandidates\(queryClient,\s*viewerId,\s*series\.id\)/,
  )

  // Series management confirms when broadening visibility
  assert.match(seriesManageScreen, /handleSelectVisibility/)
  assert.match(seriesManageScreen, /Alert\.alert\(\s*['"]Broaden series audience\?['"]/)

  // Test broadening logic
  const manageScreenModule = loadManageScreen()
  const { isBroadeningSeriesVisibility } = manageScreenModule
  assert.equal(isBroadeningSeriesVisibility('private', 'friends'), true)
  assert.equal(isBroadeningSeriesVisibility('private', 'public'), true)
  assert.equal(isBroadeningSeriesVisibility('friends', 'public'), true)
  assert.equal(isBroadeningSeriesVisibility('public', 'friends'), false)
  assert.equal(isBroadeningSeriesVisibility('friends', 'private'), false)
  assert.equal(isBroadeningSeriesVisibility('public', 'private'), false)
  assert.equal(isBroadeningSeriesVisibility('public', 'public'), false)
})

test('reconcileReelSeries and useDeleteReelSeries batch offline database updates', () => {
  const offlineCacheSource = read('src/lib/reelOfflineCache.ts')
  const rootLayoutSource = read('app/_layout.tsx')

  // Offline cache exposes batched update helper
  assert.match(offlineCacheSource, /export const updateCachedReelsSeriesIfPresent = async/)
  assert.match(offlineCacheSource, /await upsertCachedReels\(reelInputs\)/)

  // useReels imports and calls updateCachedReelsSeriesIfPresent
  assert.match(reelsHook, /updateCachedReelsSeriesIfPresent/)
  assert.match(
    reelsHook,
    /const offlineUpdates:\s*\{\s*reelId:\s*string;\s*series\?:\s*ReelSeriesSummary/,
  )

  // Stack screen uses standard series/[id]/index route
  assert.match(rootLayoutSource, /name="series\/\[id\]\/index"/)
})
