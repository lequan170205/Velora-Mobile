import { useQuery } from '@tanstack/react-query'

import { userApi } from '../api/user.api'
import { queryKeys } from '../constants/queryKeys'

export function useRecommendedUsers(params: { enabled?: boolean; limit?: number } = {}) {
  const limit = params.limit ?? 20

  return useQuery({
    queryKey: queryKeys.users.recommended(limit),
    queryFn: () => userApi.recommended({ limit }),
    enabled: params.enabled ?? true,
    staleTime: 2 * 60_000,
  })
}
