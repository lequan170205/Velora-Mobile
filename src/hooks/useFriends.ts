import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'
import { useMemo } from 'react'

import { friendApi } from '../api/friend.api'
import { queryKeys } from '../constants/queryKeys'
import { deduplicateFriendRequestPages } from '../lib/friendCache'
import { useAuthStore } from '../stores/authStore'

const FRIENDS_LIST_LIMIT = 100
const FRIEND_REQUESTS_PAGE_SIZE = 20
const BLOCKED_USERS_PAGE_SIZE = 20

export const getFriendsQueryOptions = (viewerId: string, targetUserId: string) =>
  queryOptions({
    queryKey: queryKeys.friends.list(viewerId, targetUserId),
    queryFn: async () => {
      const response = await friendApi.list({
        ...(targetUserId === viewerId ? {} : { userId: targetUserId }),
        limit: FRIENDS_LIST_LIMIT,
      })
      return response.items
    },
    enabled: Boolean(viewerId) && Boolean(targetUserId),
  })

export const getIncomingFriendRequestsInfiniteQueryOptions = (viewerId: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.friends.incoming(viewerId),
    queryFn: (context: { pageParam: string | undefined }) =>
      friendApi.listIncomingRequests({
        limit: FRIEND_REQUESTS_PAGE_SIZE,
        ...(context.pageParam ? { cursor: context.pageParam } : {}),
      }),
    enabled: Boolean(viewerId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: Awaited<ReturnType<typeof friendApi.listIncomingRequests>>) =>
      lastPage.nextCursor ?? undefined,
    select: deduplicateFriendRequestPages,
  })

export const getOutgoingFriendRequestsInfiniteQueryOptions = (viewerId: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.friends.outgoing(viewerId),
    queryFn: (context: { pageParam: string | undefined }) =>
      friendApi.listOutgoingRequests({
        limit: FRIEND_REQUESTS_PAGE_SIZE,
        ...(context.pageParam ? { cursor: context.pageParam } : {}),
      }),
    enabled: Boolean(viewerId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: Awaited<ReturnType<typeof friendApi.listOutgoingRequests>>) =>
      lastPage.nextCursor ?? undefined,
    select: deduplicateFriendRequestPages,
  })

export const getBlockedUsersInfiniteQueryOptions = (viewerId: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.friends.blocked(viewerId),
    queryFn: (context: { pageParam: string | undefined }) =>
      friendApi.listBlockedUsers({
        limit: BLOCKED_USERS_PAGE_SIZE,
        ...(context.pageParam ? { cursor: context.pageParam } : {}),
      }),
    enabled: Boolean(viewerId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: Awaited<ReturnType<typeof friendApi.listBlockedUsers>>) =>
      lastPage.nextCursor ?? undefined,
  })

export const getFriendshipStatusQueryOptions = (viewerId: string, targetUserId: string) =>
  queryOptions({
    queryKey: queryKeys.friends.status(viewerId, targetUserId),
    queryFn: () => friendApi.getStatus(targetUserId),
    enabled: Boolean(viewerId) && Boolean(targetUserId) && viewerId !== targetUserId,
  })

export function useFriends(targetUserId?: string, options: { enabled?: boolean } = {}) {
  const authUserId = useAuthStore((state) => state.user?.id)
  const viewerId = authUserId ?? ''
  const resolvedUserId = targetUserId ?? viewerId

  return useQuery({
    ...getFriendsQueryOptions(viewerId, resolvedUserId),
    enabled: Boolean(viewerId) && Boolean(resolvedUserId) && (options.enabled ?? true),
  })
}

export function useIncomingFriendRequests() {
  const viewerId = useAuthStore((state) => state.user?.id) ?? ''
  return useInfiniteQuery(getIncomingFriendRequestsInfiniteQueryOptions(viewerId))
}

export function useOutgoingFriendRequests() {
  const viewerId = useAuthStore((state) => state.user?.id) ?? ''
  return useInfiniteQuery(getOutgoingFriendRequestsInfiniteQueryOptions(viewerId))
}

export function useBlockedUsersInfiniteQuery() {
  const viewerId = useAuthStore((state) => state.user?.id) ?? ''
  return useInfiniteQuery(getBlockedUsersInfiniteQueryOptions(viewerId))
}

export function useBlockedUserIds() {
  const viewerId = useAuthStore((state) => state.user?.id) ?? ''
  const query = useBlockedUsersInfiniteQuery()
  const blockedUserIds = useMemo(
    () =>
      new Set(query.data?.pages.flatMap((page) => page.items.map((item) => item.user.id)) ?? []),
    [query.data],
  )

  return {
    ...query,
    blockedUserIds,
    isVisibilityReady: !viewerId || query.isSuccess,
  }
}

export function useFriendshipStatus(targetUserId: string) {
  const viewerId = useAuthStore((state) => state.user?.id) ?? ''
  return useQuery(getFriendshipStatusQueryOptions(viewerId, targetUserId))
}
