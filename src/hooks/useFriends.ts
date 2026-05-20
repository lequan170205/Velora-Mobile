import { useQuery } from '@tanstack/react-query'

import { friendApi } from '../api/friend.api'
import { queryKeys } from '../constants/queryKeys'

export const getFriendsQueryOptions = () => ({
  queryKey: queryKeys.friends.list(),
  queryFn: () => friendApi.list(),
})

export const getIncomingFriendRequestsQueryOptions = () => ({
  queryKey: queryKeys.friends.incoming(),
  queryFn: () => friendApi.listIncomingRequests(),
})

export const getOutgoingFriendRequestsQueryOptions = () => ({
  queryKey: queryKeys.friends.outgoing(),
  queryFn: () => friendApi.listOutgoingRequests(),
})

export function useFriends() {
  return useQuery(getFriendsQueryOptions())
}

export function useIncomingFriendRequests() {
  return useQuery(getIncomingFriendRequestsQueryOptions())
}

export function useOutgoingFriendRequests() {
  return useQuery(getOutgoingFriendRequestsQueryOptions())
}
