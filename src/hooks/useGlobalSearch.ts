import { useQuery } from '@tanstack/react-query'

import { getGlobalSearch } from '../api/search.api'
import { queryKeys } from '../constants/queryKeys'
import { filterBlockedUsers } from '../lib/recommendedContacts'

import { useBlockedUserIds } from './useFriends'

import type { GlobalSearchParams } from '../types/search.types'

export function useGlobalSearch(params: GlobalSearchParams) {
  const normalizedQuery = params.q.trim()
  const normalizedType = params.type ?? 'all'
  const blockedUsers = useBlockedUserIds({ enabled: normalizedQuery.length > 0 })

  const query = useQuery({
    queryKey: queryKeys.search.global(normalizedQuery, normalizedType, params.limit),
    queryFn: () =>
      getGlobalSearch({
        q: normalizedQuery,
        type: normalizedType,
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
      }),
    enabled: normalizedQuery.length > 0,
    staleTime: 30_000,
  })

  const data = query.data
  const filteredData = (() => {
    if (!data || !blockedUsers.isVisibilityReady) {
      return undefined
    }

    const users = filterBlockedUsers(data.users, blockedUsers.blockedUserIds)
    const reels = data.reels.filter((reel) => !blockedUsers.blockedUserIds.has(reel.userId))

    return {
      ...data,
      users,
      reels,
      counts: { users: users.length, reels: reels.length, tags: data.tags.length },
    }
  })()

  return {
    ...query,
    data: filteredData,
    isError: query.isError || blockedUsers.isError,
    isLoading: query.isLoading || blockedUsers.isLoading,
  }
}
