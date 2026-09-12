const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const recommendationTypes = read('src/types/recommendation.types.ts')
const recommendedReels = read('src/lib/recommendedReels.ts')
const reelsApi = read('src/api/reels.api.ts')
const reelsHook = read('src/hooks/useReels.ts')
const reelsViewer = read('src/components/reels/ReelsViewer.tsx')
const reelEventAttribution = read('src/lib/reelEventAttribution.ts')

test('reel recommendation types stay aligned with backend candidate sources', () => {
  const sourceListStart = recommendationTypes.indexOf('RECOMMENDATION_CANDIDATE_SOURCES')
  const sourceListEnd = recommendationTypes.indexOf('] as const', sourceListStart)
  const sourceList = recommendationTypes.slice(sourceListStart, sourceListEnd)

  assert.match(sourceList, /'RECENT_QUALITY'/)
  assert.match(sourceList, /'TRENDING'/)
  assert.match(sourceList, /'TAG_AFFINITY'/)
  assert.match(sourceList, /'CREATOR_AFFINITY'/)
  assert.match(sourceList, /'CONTENT_SIMILARITY'/)
  assert.match(sourceList, /'SEMANTIC'/)
  assert.match(sourceList, /'SOCIAL'/)
  assert.match(sourceList, /'EXPLORATION'/)
  assert.match(
    recommendationTypes,
    /candidateSources\?: RecommendationCandidateSource\[\]/,
  )
})

test('recommended reel pagination keeps the backend cursor opaque and reuses its feed session', () => {
  assert.match(reelsApi, /cursor: params\.cursor/)
  assert.match(
    reelsApi,
    /\.\.\.\(params\.feedSessionId \? \{ feedSessionId: params\.feedSessionId \} : \{\}\)/,
  )
  assert.match(recommendedReels, /\.\.\.\(cursor \? \{ cursor \} : \{\}\)/)
  assert.match(
    recommendedReels,
    /\.\.\.\(cursor && this\.feedSessionId \? \{ feedSessionId: this\.feedSessionId \} : \{\}\)/,
  )
  assert.match(recommendedReels, /this\.feedSessionId = page\.feedSessionId/)
  assert.doesNotMatch(recommendedReels, /cursor\.(split|substring|slice|replace)\(/)
  assert.doesNotMatch(reelsApi, /params\.cursor\.(split|substring|slice|replace)\(/)
})

test('recommended feed starts fresh on first page, refresh, and account transition', () => {
  const hookStart = reelsHook.indexOf('export function useRecommendedReelsFeed')
  const recommendedFeedHook = reelsHook.slice(hookStart)

  assert.match(
    recommendedFeedHook,
    /if \(!pageParam\) \{\s*session\.reset\(\)\s*\}/,
  )
  assert.match(recommendedFeedHook, /session\.capture\(response\)/)
  assert.match(
    recommendedFeedHook,
    /previousUserIdRef\.current = userId\s*recommendationSessionRef\.current\.reset\(\)/,
  )
  assert.match(
    recommendedFeedHook,
    /const refreshWithNewSession = useCallback\(async \(\) => \{\s*recommendationSessionRef\.current\.reset\(\)\s*queryClient\.removeQueries\(\{ queryKey, exact: true \}\)\s*return queryClient\.fetchInfiniteQuery\(recommendedQueryOptions\)/,
  )
  assert.match(reelsViewer, /selectedFeedTab === 'friends'[\s\S]*await refreshWithNewSession\(\)/)
})

test('recommendation attribution preserves session, algorithm, source, and global rank', () => {
  assert.match(reelEventAttribution, /recommendationId: recommendation\.recommendationId/)
  assert.match(reelEventAttribution, /feedSessionId: recommendation\.feedSessionId/)
  assert.match(reelEventAttribution, /algorithmVersion: recommendation\.algorithmVersion/)
  assert.match(reelEventAttribution, /candidateSource: recommendation\.candidateSource/)
  assert.match(reelEventAttribution, /rank: recommendation\.rank/)
  assert.match(reelEventAttribution, /generatedAt: recommendation\.generatedAt/)
})
