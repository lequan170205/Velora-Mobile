import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { friendApi } from '../api/friend.api'
import { queryKeys } from '../constants/queryKeys'
import { useAuthStore } from '../stores/authStore'

const FRIENDS_LIST_LIMIT = 100
const FRIEND_REQUESTS_PAGE_SIZE = 20

export const getFriendsQueryOptions = (userId?: string | null) => ({
  queryKey: queryKeys.friends.list(userId),
  queryFn: async () => {
    const response = await friendApi.list({
      ...(userId ? { userId } : {}),
      limit: FRIENDS_LIST_LIMIT,
    })
    return response.items
  },
  enabled: Boolean(userId),
})

export const getIncomingFriendRequestsInfiniteQueryOptions = (userId?: string | null) => ({
  queryKey: queryKeys.friends.incoming(userId),
  queryFn: (context: { pageParam: string | undefined }) =>
    friendApi.listIncomingRequests({
      limit: FRIEND_REQUESTS_PAGE_SIZE,
      ...(context.pageParam ? { cursor: context.pageParam } : {}),
    }),
  enabled: Boolean(userId),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (lastPage: Awaited<ReturnType<typeof friendApi.listIncomingRequests>>) =>
    lastPage.nextCursor ?? undefined,
})

export const getOutgoingFriendRequestsInfiniteQueryOptions = (userId?: string | null) => ({
  queryKey: queryKeys.friends.outgoing(userId),
  queryFn: (context: { pageParam: string | undefined }) =>
    friendApi.listOutgoingRequests({
      limit: FRIEND_REQUESTS_PAGE_SIZE,
      ...(context.pageParam ? { cursor: context.pageParam } : {}),
    }),
  enabled: Boolean(userId),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (lastPage: Awaited<ReturnType<typeof friendApi.listOutgoingRequests>>) =>
    lastPage.nextCursor ?? undefined,
})

export const getFriendshipStatusQueryOptions = (userId: string) => ({
  queryKey: queryKeys.friends.status(userId),
  queryFn: () => friendApi.getStatus(userId),
  enabled: Boolean(userId),
})

export function useFriends(targetUserId?: string) {
  const authUserId = useAuthStore((state) => state.user?.id)
  const resolvedUserId = targetUserId ?? authUserId
  const isEnabled = Boolean(authUserId) && Boolean(resolvedUserId)

  return useQuery({
    ...getFriendsQueryOptions(resolvedUserId),
    enabled: isEnabled,
  })
}

export function useIncomingFriendRequests() {
  const userId = useAuthStore((state) => state.user?.id)
  return useInfiniteQuery(getIncomingFriendRequestsInfiniteQueryOptions(userId))
}

export function useOutgoingFriendRequests() {
  const userId = useAuthStore((state) => state.user?.id)
  return useInfiniteQuery(getOutgoingFriendRequestsInfiniteQueryOptions(userId))
}

export function useFriendshipStatus(userId: string) {
  return useQuery(getFriendshipStatusQueryOptions(userId))
}
