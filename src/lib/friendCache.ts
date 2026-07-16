import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { queryKeys } from '../constants/queryKeys'

import { removeCreatorReelsFromViewerFeedCaches } from './reelFeedCache'

import type {
  FriendRequestSummary,
  FriendSummary,
  FriendshipStatusResponse,
  PaginatedFriendResults,
  BlockedUserSummary,
} from '../types/friend.types'
import type { Reel, ReelContextResponse } from '../types/reel.types'
import type { GlobalSearchResponse } from '../types/search.types'
import type { PublicUserProfile } from '../types/user.types'

type FriendRequestPages = InfiniteData<
  PaginatedFriendResults<FriendRequestSummary>,
  string | undefined
>

type BlockedUserPages = InfiniteData<PaginatedFriendResults<BlockedUserSummary>, string | undefined>

type ReelPages = InfiniteData<{ items: Reel[] }, string | undefined>

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

export const removeFriendRequestsForUserFromPages = (
  data: FriendRequestPages | undefined,
  userId: string,
) => {
  if (!data) return data

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((request) => request.user.id !== userId),
    })),
  }
}

export const removeBlockedUserFromPages = (data: BlockedUserPages | undefined, userId: string) => {
  if (!data) return data

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((blockedUser) => blockedUser.user.id !== userId),
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

export const removeBlockedUsersQueriesForViewer = (queryClient: QueryClient, viewerId: string) => {
  queryClient.removeQueries({ queryKey: queryKeys.friends.blocked(viewerId) })
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

export const removeUserFromRecommendedUsersCaches = (queryClient: QueryClient, userId: string) => {
  queryClient.setQueriesData<PublicUserProfile[]>({ queryKey: ['users', 'recommended'] }, (users) =>
    users?.filter((user) => user.id !== userId),
  )
}

export const removeUserFromDiscoveryCaches = (queryClient: QueryClient, userId: string) => {
  queryClient.setQueriesData<PublicUserProfile[]>({ queryKey: ['users', 'discover'] }, (users) =>
    users?.filter((user) => user.id !== userId),
  )
}

export const removeUserFromGlobalSearchCaches = (queryClient: QueryClient, userId: string) => {
  queryClient.setQueriesData<GlobalSearchResponse>({ queryKey: queryKeys.search.all }, (data) => {
    if (!data) return data

    return {
      ...data,
      users: data.users.filter((user) => user.id !== userId),
      reels: data.reels.filter((reel) => reel.userId !== userId),
      counts: {
        users: data.users.filter((user) => user.id !== userId).length,
        reels: data.reels.filter((reel) => reel.userId !== userId).length,
      },
    }
  })
}

const removeCreatorFromReelPages = (data: ReelPages | undefined, creatorId: string) => {
  if (!data) return data

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((reel) => reel.userId !== creatorId),
    })),
  }
}

export const removeCreatorReelsFromAllCaches = (queryClient: QueryClient, creatorId: string) => {
  queryClient.setQueriesData<ReelPages>(
    {
      predicate: (query) =>
        query.queryKey[0] === 'reels' &&
        (query.queryKey[1] === 'list' ||
          query.queryKey[1] === 'recommended' ||
          query.queryKey[1] === 'friends'),
    },
    (data) => removeCreatorFromReelPages(data, creatorId),
  )
  queryClient.setQueriesData<ReelContextResponse>(
    { queryKey: queryKeys.reels.contexts() },
    (data) => {
      if (!data) return data

      const items = data.items.filter((reel) => reel.userId !== creatorId)
      const selectedIndex = Math.min(data.selectedIndex, Math.max(items.length - 1, 0))
      const selectedId = items[selectedIndex]?.id ?? data.selectedId

      return { ...data, items, selectedId, selectedIndex }
    },
  )
  queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(), (reels) =>
    reels?.filter((reel) => reel.userId !== creatorId),
  )
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === 'reels' &&
      query.queryKey[1] === 'detail' &&
      (query.state.data as Reel | undefined)?.userId === creatorId,
  })
}

export const removeBlockedUserFromCaches = (
  queryClient: QueryClient,
  viewerId: string,
  userId: string,
) => {
  queryClient.setQueryData<FriendSummary[]>(queryKeys.friends.list(viewerId, viewerId), (friends) =>
    removeUserFromFriendList(friends, userId),
  )
  updateIncomingRequestPages(queryClient, viewerId, (data) =>
    removeFriendRequestsForUserFromPages(data, userId),
  )
  updateOutgoingRequestPages(queryClient, viewerId, (data) =>
    removeFriendRequestsForUserFromPages(data, userId),
  )
  updateFriendshipStatus(queryClient, viewerId, userId, { status: 'none' })
  removeUserFromDiscoveryCaches(queryClient, userId)
  removeUserFromRecommendedUsersCaches(queryClient, userId)
  removeUserFromGlobalSearchCaches(queryClient, userId)
  removeCreatorReelsFromAllCaches(queryClient, userId)
  removeCreatorReelsFromViewerFeedCaches(queryClient, viewerId, userId)
}

export const invalidateRelationshipCaches = (
  queryClient: QueryClient,
  viewerId: string,
  targetUserId: string,
) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.friends.list(viewerId, viewerId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.friends.incoming(viewerId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.friends.outgoing(viewerId) }),
    queryClient.invalidateQueries({ queryKey: ['users', 'recommended'] }),
    queryClient.invalidateQueries({ queryKey: ['users', 'discover'] }),
    invalidateFriendshipStatus(queryClient, viewerId, targetUserId),
  ])

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
