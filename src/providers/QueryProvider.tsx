import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { useEffect, useRef } from 'react'

import { queryKeys } from '../constants/queryKeys'
import {
  removeFriendMutationsForViewer,
  removeFriendshipQueriesForViewer,
  removeBlockedUsersQueriesForViewer,
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

export const clearAccountScopedQueryCaches = (client: QueryClient, viewerId: string) => {
  removeRecommendationQueriesForUser(client, viewerId)
  removeFriendshipQueriesForViewer(client, viewerId)
  removeBlockedUsersQueriesForViewer(client, viewerId)
  removeFriendMutationsForViewer(client, viewerId)
  client.removeQueries({ queryKey: queryKeys.search.all })
  client.removeQueries({ queryKey: ['users', 'discover'] })
  client.removeQueries({ queryKey: ['users', 'recommended'] })
  client.removeQueries({ queryKey: queryKeys.reels.all })
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const userId = useAuthStore((state) => state.user?.id)
  const previousUserIdRef = useRef<string | undefined>(userId)

  useEffect(() => {
    const previousUserId = previousUserIdRef.current

    if (previousUserId && previousUserId !== userId) {
      clearAccountScopedQueryCaches(queryClient, previousUserId)
    }

    previousUserIdRef.current = userId
  }, [userId])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
