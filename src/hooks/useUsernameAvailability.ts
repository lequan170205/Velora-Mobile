import { useQuery } from '@tanstack/react-query'

import { userApi } from '../api/user.api'
import { queryKeys } from '../constants/queryKeys'

export function useUsernameAvailability(username: string, enabled: boolean) {
  const normalizedUsername = username.trim().replace(/^@+/, '')

  return useQuery({
    queryKey: queryKeys.users.usernameAvailability(normalizedUsername),
    queryFn: () => userApi.checkUsernameAvailability(normalizedUsername),
    enabled: enabled && normalizedUsername.length > 0,
    staleTime: 60 * 1000,
  })
}
