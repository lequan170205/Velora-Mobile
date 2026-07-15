import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { queryKeys } from '../constants/queryKeys'

import type {
  FriendRequestSummary,
  FriendSummary,
  FriendshipStatusResponse,
  PaginatedFriendResults,
} from '../types/friend.types'

type FriendRequestPages = InfiniteData<
  PaginatedFriendResults<FriendRequestSummary>,
  string | undefined
>

export const deduplicateFriendRequestPages = (data: FriendRequestPages | undefined) => {
  if (!data) return data

  const requestIds = new Set<string>()

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((request) => {
        if (requestIds.has(request.id)) return false
        requestIds.add(request.id)
        return true
      }),
    })),
  }
}

export const removeFriendRequestFromPages = (
  data: FriendRequestPages | undefined,
  requestId: string,
) => {
  if (!data) return data

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((request) => request.id !== requestId),
    })),
  }
}

export const removeUserFromFriendList = (friends: FriendSummary[] | undefined, userId: string) =>
  friends?.filter((friend) => friend.user.id !== userId)

export const insertOrReplaceFriendSummary = (
  friends: FriendSummary[] | undefined,
  friend: FriendSummary,
) => {
  const currentFriends = friends ?? []
  const index = currentFriends.findIndex((item) => item.user.id === friend.user.id)

  if (index < 0) return [friend, ...currentFriends]

  return currentFriends.map((item, itemIndex) => (itemIndex === index ? friend : item))
}

export const updateFriendshipStatus = (
  queryClient: QueryClient,
  viewerId: string,
  targetUserId: string,
  status: FriendshipStatusResponse,
) => {
  queryClient.setQueryData(queryKeys.friends.status(viewerId, targetUserId), status)
}

export const invalidateFriendshipStatus = (
  queryClient: QueryClient,
  viewerId: string,
  targetUserId: string,
) => queryClient.invalidateQueries({ queryKey: queryKeys.friends.status(viewerId, targetUserId) })

export const removeFriendshipQueriesForViewer = (queryClient: QueryClient, viewerId: string) => {
  queryClient.removeQueries({ queryKey: queryKeys.friends.viewer(viewerId) })
}

export const removeFriendMutationsForViewer = (queryClient: QueryClient, viewerId: string) => {
  const mutationCache = queryClient.getMutationCache()

  mutationCache.getAll().forEach((mutation) => {
    const mutationKey = mutation.options.mutationKey

    if (Array.isArray(mutationKey) && mutationKey[0] === 'friends' && mutationKey[1] === viewerId) {
      mutationCache.remove(mutation)
    }
  })
}

export const updateIncomingRequestPages = (
  queryClient: QueryClient,
  viewerId: string,
  updater: (data: FriendRequestPages | undefined) => FriendRequestPages | undefined,
) => queryClient.setQueryData(queryKeys.friends.incoming(viewerId), updater)

export const updateOutgoingRequestPages = (
  queryClient: QueryClient,
  viewerId: string,
  updater: (data: FriendRequestPages | undefined) => FriendRequestPages | undefined,
) => queryClient.setQueryData(queryKeys.friends.outgoing(viewerId), updater)
