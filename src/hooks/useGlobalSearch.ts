import { useQuery } from '@tanstack/react-query'

import { getGlobalSearch } from '../api/search.api'
import { queryKeys } from '../constants/queryKeys'

import type { GlobalSearchParams } from '../types/search.types'

export function useGlobalSearch(params: GlobalSearchParams) {
  const normalizedQuery = params.q.trim()
  const normalizedType = params.type ?? 'all'

  return useQuery({
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
}
