import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { useEffect, useRef } from 'react'

import { queryKeys } from '../constants/queryKeys'
import {
  removeFriendMutationsForViewer,
  removeFriendshipQueriesForViewer,
} from '../lib/friendCache'
import { removeRecommendationQueriesForUser } from '../lib/recommendationCache'
import { useAuthStore } from '../stores/authStore'

import type { ReactNode } from 'react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60, // 1 minute
    },
  },
})

export function QueryProvider({ children }: { children: ReactNode }) {
  const userId = useAuthStore((state) => state.user?.id)
  const previousUserIdRef = useRef<string | undefined>(userId)

  useEffect(() => {
    const previousUserId = previousUserIdRef.current

    if (previousUserId && previousUserId !== userId) {
      removeRecommendationQueriesForUser(queryClient, previousUserId)
      removeFriendshipQueriesForViewer(queryClient, previousUserId)
      removeFriendMutationsForViewer(queryClient, previousUserId)
      queryClient.removeQueries({ queryKey: queryKeys.reels.viewerFeeds(previousUserId) })
      queryClient.removeQueries({ queryKey: queryKeys.reels.friends() })
    }

    previousUserIdRef.current = userId
  }, [userId])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
