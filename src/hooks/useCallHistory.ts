import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'

import {
  getCallHistory,
  getMissedCallCount,
  markMissedCallsSeen,
  type CallHistoryPage,
} from '../api/call.api'
import { queryKeys } from '../constants/queryKeys'
import { useAuthStore } from '../stores/authStore'

const MISSED_CALL_COUNT_STALE_TIME_MS = 15_000

/** Refreshes the Calls tab and badge, e.g. when a call row arrives in chat. */
export const invalidateCallHistoryQueries = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.calls.all })

export function useCallHistory() {
  const viewerId = useAuthStore((state) => state.user?.id)

  return useInfiniteQuery<
    CallHistoryPage,
    Error,
    InfiniteData<CallHistoryPage>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.calls.history(viewerId ?? 'anonymous'),
    queryFn: ({ pageParam }) => getCallHistory(pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(viewerId),
  })
}

export function useMissedCallCount() {
  const viewerId = useAuthStore((state) => state.user?.id)

  return useQuery({
    queryKey: queryKeys.calls.missedCount(viewerId ?? 'anonymous'),
    queryFn: getMissedCallCount,
    enabled: Boolean(viewerId),
    staleTime: MISSED_CALL_COUNT_STALE_TIME_MS,
  })
}

export function useMarkMissedCallsSeen() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id)

  return useMutation({
    mutationFn: markMissedCallsSeen,
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.calls.missedCount(viewerId ?? 'anonymous'), 0)
    },
  })
}
