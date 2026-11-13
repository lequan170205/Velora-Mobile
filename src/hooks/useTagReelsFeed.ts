import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getTagReels } from '../api/search.api'
import { queryKeys } from '../constants/queryKeys'

import type { ReelFeedListItem } from '../types/reel.types'

/** Cursor-paged public reels for one tag. The backend already drops blocked authors. */
export function useTagReelsFeed(params: { tag: string | null; limit?: number }) {
  const limit = params.limit ?? 24
  const tag = params.tag?.trim() ?? ''

  const query = useInfiniteQuery({
    queryKey: queryKeys.search.tagReels(tag, limit),
    queryFn: ({ pageParam }) =>
      getTagReels({ tag, limit, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: tag.length > 0,
    staleTime: 60_000,
    retry: 1,
  })

  const reels = useMemo<ReelFeedListItem[]>(() => {
    const seen = new Set<string>()

    return (query.data?.pages ?? [])
      .flatMap((page) => page.items)
      .filter((reel) => {
        if (seen.has(reel.id)) {
          return false
        }
        seen.add(reel.id)
        return true
      })
  }, [query.data])

  return { ...query, reels }
}
