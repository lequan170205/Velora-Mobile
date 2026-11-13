import { useQuery } from '@tanstack/react-query'

import { getSearchTags } from '../api/search.api'
import { queryKeys } from '../constants/queryKeys'

/** Trending tags when `q` is empty, otherwise tags matching `q`. */
export function useSearchTags(
  params: { q?: string; limit?: number } = {},
  options: { enabled?: boolean } = {},
) {
  const normalizedQuery = params.q?.trim() ?? ''
  const limit = params.limit ?? 12

  return useQuery({
    queryKey: queryKeys.search.tags(normalizedQuery, limit),
    queryFn: () => getSearchTags({ q: normalizedQuery, limit }),
    select: (data) => data.tags,
    enabled: options.enabled ?? true,
    staleTime: normalizedQuery ? 30_000 : 5 * 60_000,
    gcTime: 15 * 60_000,
  })
}
