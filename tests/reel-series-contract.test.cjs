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
const seriesScreen = read('app/series/[id].tsx')
const reelCacheMappers = read('src/database/reels/reelCacheMappers.ts')
const databaseSchema = read('src/database/schema.ts')
const databaseMigrations = read('src/database/migrations.ts')

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
  assert.match(reelFeedItem, /\{displayReel\.series \? \(/)
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
})

test('series screen preserves backend order and starts at the requested episode with a safe fallback', () => {
  assert.match(seriesScreen, /useReelSeries\(seriesId\)/)
  assert.match(seriesScreen, /series\.reels\.some\(\(reel\) => reel\.id === requestedReelId\)/)
  assert.match(seriesScreen, /return series\.reels\[0\]\?\.id/)
  assert.match(seriesScreen, /contextItems=\{series\.reels\}/)
  assert.match(seriesScreen, /reelId=\{initialReelId\}/)
  assert.match(seriesScreen, /eventSource="DIRECT"/)
  assert.match(seriesScreen, /series\.title/)
  assert.match(seriesScreen, /series\.description/)
  assert.match(seriesScreen, /series\.reels\.length/)
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
