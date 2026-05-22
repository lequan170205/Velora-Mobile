import { useQuery } from '@tanstack/react-query'

import { userApi } from '../api/user.api'
import { queryKeys } from '../constants/queryKeys'

export function useContacts(search: string = '') {
  const normalizedSearch = search.trim()

  return useQuery({
    queryKey: queryKeys.users.discover(normalizedSearch),
    queryFn: () => userApi.discover({ query: normalizedSearch, limit: 20 }),
    enabled: normalizedSearch.length > 0,
    staleTime: 60_000,
  })
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
