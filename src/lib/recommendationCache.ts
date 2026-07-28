import type { QueryClient, QueryKey } from '@tanstack/react-query'

const getQueryUserId = (queryKey: QueryKey) => {
  const params = queryKey[queryKey.length - 1]

  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return null
  }

  const userId = (params as Record<string, unknown>).userId
  return typeof userId === 'string' ? userId : null
}

export const isRecommendationQueryForUser = (queryKey: QueryKey, userId: string) => {
  const isRecommendedReels =
    queryKey[0] === 'reels' && queryKey[1] === userId && queryKey[2] === 'recommended'
  const isRecommendedUsers = queryKey[0] === 'users' && queryKey[1] === 'recommended'

  return isRecommendedReels || (isRecommendedUsers && getQueryUserId(queryKey) === userId)
}

export const removeRecommendationQueriesForUser = (queryClient: QueryClient, userId: string) => {
  queryClient.removeQueries({
    predicate: (query) => isRecommendationQueryForUser(query.queryKey, userId),
  })
}
