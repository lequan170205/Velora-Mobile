import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { queryKeys } from '../constants/queryKeys'

import type { ReelFeedListItem } from '../types/reel.types'

type ReelFeedPage = {
  items: ReelFeedListItem[]
  nextCursor?: string | null
}

type ReelFeedData = InfiniteData<ReelFeedPage, string | undefined>

export const removeCreatorReelsFromViewerFeedCaches = (
  queryClient: QueryClient,
  viewerId: string,
  creatorId: string,
) => {
  queryClient.setQueriesData<ReelFeedData>(
    { queryKey: queryKeys.reels.viewerFeeds(viewerId) },
    (data) => {
      if (!data) {
        return data
      }

      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.filter((reel) => reel.userId !== creatorId),
        })),
      }
    },
  )
}
