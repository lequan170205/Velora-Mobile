import { useQuery } from '@tanstack/react-query'

import { getSearchSuggestions } from '../api/search.api'
import { queryKeys } from '../constants/queryKeys'

import type { SearchSuggestionsParams } from '../types/search.types'

export function useSearchSuggestions(
  params: SearchSuggestionsParams = {},
  options: { enabled?: boolean } = {},
) {
  const normalizedType = params.type ?? 'all'
  const limit = params.limit ?? 8

  return useQuery({
    queryKey: queryKeys.search.suggestions(normalizedType, limit),
    queryFn: () =>
      getSearchSuggestions({
        type: normalizedType,
        limit,
      }),
    enabled: options.enabled ?? true,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
  })
}
