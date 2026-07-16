import { useQuery } from '@tanstack/react-query'

import { userApi } from '../api/user.api'
import { queryKeys } from '../constants/queryKeys'
import { filterBlockedUsers } from '../lib/recommendedContacts'

import { useBlockedUserIds } from './useFriends'

export function useContacts(search: string = '') {
  const normalizedSearch = search.trim()
  const blockedUsers = useBlockedUserIds()
  const query = useQuery({
    queryKey: queryKeys.users.discover(normalizedSearch),
    queryFn: () => userApi.discover({ query: normalizedSearch, limit: 20 }),
    enabled: normalizedSearch.length > 0,
    staleTime: 60_000,
  })

  return {
    ...query,
    data: blockedUsers.isVisibilityReady
      ? filterBlockedUsers(query.data ?? [], blockedUsers.blockedUserIds)
      : undefined,
    isError: query.isError || blockedUsers.isError,
    isLoading: query.isLoading || blockedUsers.isLoading,
  }
}

export function usePublicProfile(username: string = '') {
  const normalizedUsername = username.trim().replace(/^@+/, '')

  return useQuery({
    queryKey: queryKeys.users.publicProfile(normalizedUsername),
    queryFn: () => userApi.findPublicProfile(normalizedUsername),
    enabled: normalizedUsername.length > 0,
    staleTime: 60_000,
  })
}
