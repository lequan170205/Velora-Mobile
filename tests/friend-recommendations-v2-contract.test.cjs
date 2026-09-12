const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const recommendationTypes = read('src/types/recommendation.types.ts')
const userTypes = read('src/types/user.types.ts')
const recommendationFeed = read('src/lib/recommendationFeed.ts')
const recommendedUsersHook = read('src/hooks/useRecommendedUsers.ts')
const friendsHook = read('src/hooks/useFriends.ts')
const globalSearchHook = read('src/hooks/useGlobalSearch.ts')
const friendCache = read('src/lib/friendCache.ts')
const friendMutations = read('src/hooks/useFriendMutations.ts')
const searchScreen = read('app/(tabs)/search.tsx')

test('user recommendation types and parser preserve the graph V2 contract', () => {
  assert.match(userTypes, /mutualFriendCount\?: number/)
  assert.match(userTypes, /recommendation: UserRecommendationMetadata/)
  assert.doesNotMatch(userTypes, /recommendation\?: RecommendationMetadata/)
  assert.match(recommendationTypes, /USER_RECOMMENDATION_CANDIDATE_SOURCES/)
  assert.match(recommendationTypes, /'GRAPH_TWO_HOP'/)
  assert.match(recommendationTypes, /'PUBLIC_USER_FALLBACK'/)
  assert.match(recommendationFeed, /discardLegacyRecommendationFields\(user\.recommendation\)/)
})

test('recommended contacts render graph social proof without friendship-status requests', () => {
  const recommendedRowStart = searchScreen.indexOf('function RecommendedContactRow')
  const recommendedRowEnd = searchScreen.indexOf('type ContactResultsListProps')
  const recommendedRow = searchScreen.slice(recommendedRowStart, recommendedRowEnd)
  const searchRowStart = searchScreen.indexOf('function ContactResultRow')
  const searchRow = searchScreen.slice(searchRowStart, recommendedRowStart)

  assert.match(recommendedRow, /getMutualFriendLabel\(user\)/)
  assert.doesNotMatch(recommendedRow, /useFriendshipStatus/)
  assert.match(searchRow, /useFriendshipStatus\(user\.id\)/)
  assert.match(searchScreen, /candidateSource !== 'GRAPH_TWO_HOP'/)
  assert.match(searchScreen, /count === 1 \? '' : 's'/)
  assert.match(searchScreen, /mode="recommended"/)
  assert.match(searchScreen, /mode="search"/)
})

test('recommendation failures remain distinct from an empty successful response', () => {
  assert.match(searchScreen, /isRecommendedUsersError/)
  assert.match(searchScreen, /title="Couldn’t load suggestions"/)
  assert.match(searchScreen, /onRecommendedUsersRetry/)
  assert.match(searchScreen, /refetch: refetchRecommendedUsers/)
  assert.match(searchScreen, /isRecommendedUsersError=\{isRecommendedUsersError\}/)
})

test('friendship transitions keep recommendation caches aligned with eligibility', () => {
  const sendStart = friendMutations.indexOf('export function useSendFriendRequest')
  const acceptStart = friendMutations.indexOf('export function useAcceptFriendRequest')
  const rejectStart = friendMutations.indexOf('export function useRejectFriendRequest')
  const cancelStart = friendMutations.indexOf('export function useCancelFriendRequest')
  const removeStart = friendMutations.indexOf('export function useRemoveFriend')
  const blockStart = friendMutations.indexOf('export function useBlockUser')
  const unblockStart = friendMutations.indexOf('export function useUnblockUser')

  const sendMutation = friendMutations.slice(sendStart, acceptStart)
  const acceptMutation = friendMutations.slice(acceptStart, rejectStart)
  const rejectMutation = friendMutations.slice(rejectStart, cancelStart)
  const cancelMutation = friendMutations.slice(cancelStart, removeStart)
  const removeMutation = friendMutations.slice(removeStart, blockStart)
  const blockMutation = friendMutations.slice(blockStart, unblockStart)
  const unblockMutation = friendMutations.slice(unblockStart)

  assert.match(
    sendMutation,
    /response\.status !== 'none'[\s\S]*removeUserFromRecommendedUsersCaches\(queryClient, targetUserId\)[\s\S]*invalidateRecommendedUsersQueries\(queryClient\)/,
  )
  assert.match(acceptMutation, /removeUserFromRecommendedUsersCaches\(queryClient, input\.userId\)/)
  assert.match(rejectMutation, /invalidateRecommendedUsersQueries\(queryClient\)/)
  assert.match(cancelMutation, /invalidateRecommendedUsersQueries\(queryClient\)/)
  assert.match(removeMutation, /invalidateRelationshipCaches\(queryClient, viewerId, userId\)/)
  assert.match(blockMutation, /removeBlockedUserFromCaches\(queryClient, viewerId, userId\)/)
  assert.match(unblockMutation, /invalidateRelationshipCaches\(queryClient, viewerId, userId\)/)
  assert.match(friendCache, /invalidateRecommendedUsersQueries/)
})

test('recommendation visibility safeguards are cache-only and limits stay within the backend range', () => {
  assert.match(
    recommendedUsersHook,
    /Math\.min\(30, Math\.max\(1, Math\.floor\(limit \?\? 20\)\)\)/,
  )
  assert.match(recommendedUsersHook, /useFriends\(undefined, \{ enabled: false \}\)/)
  assert.match(recommendedUsersHook, /useBlockedUserIds\(\{ enabled: false \}\)/)
  assert.match(recommendedUsersHook, /data: visibleUsers/)
  assert.doesNotMatch(recommendedUsersHook, /blockedUsers\.isVisibilityReady \? visibleUsers/)
  assert.match(friendsHook, /options: \{ enabled\?: boolean \} = \{\}/)
  assert.match(globalSearchHook, /useBlockedUserIds\(\{ enabled: normalizedQuery\.length > 0 \}\)/)
})
