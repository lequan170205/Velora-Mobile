import { apiClient } from './client'

import type {
  FriendPaginationParams,
  FriendRequestSummary,
  FriendSummary,
  FriendshipActionResponse,
  FriendshipStatusResponse,
  PaginatedFriendResults,
} from '../types/friend.types'

export const friendApi = {
  list: async (params?: FriendPaginationParams) => {
    const response = await apiClient.get<PaginatedFriendResults<FriendSummary>>('/friends', {
      params,
    })
    return response.data
  },
  listIncomingRequests: async (params?: FriendPaginationParams) => {
    const response = await apiClient.get<PaginatedFriendResults<FriendRequestSummary>>(
      '/friends/requests/incoming',
      {
        params,
      },
    )
    return response.data
  },
  listOutgoingRequests: async (params?: FriendPaginationParams) => {
    const response = await apiClient.get<PaginatedFriendResults<FriendRequestSummary>>(
      '/friends/requests/outgoing',
      {
        params,
      },
    )
    return response.data
  },
  sendRequest: async (recipientId: string) => {
    const response = await apiClient.post<FriendshipActionResponse>('/friends/requests', {
      recipientId,
    })
    return response.data
  },
  acceptRequest: async (requestId: string) => {
    const response = await apiClient.post<FriendshipActionResponse>(
      `/friends/requests/${requestId}/accept`,
    )
    return response.data
  },
  rejectRequest: async (requestId: string) => {
    const response = await apiClient.post<FriendshipActionResponse>(
      `/friends/requests/${requestId}/reject`,
    )
    return response.data
  },
  cancelRequest: async (requestId: string) => {
    const response = await apiClient.delete<FriendshipActionResponse>(
      `/friends/requests/${requestId}`,
    )
    return response.data
  },
  removeFriend: async (userId: string) => {
    const response = await apiClient.delete<FriendshipActionResponse>(`/friends/${userId}`)
    return response.data
  },
  blockUser: async (userId: string) => {
    const response = await apiClient.post<FriendshipActionResponse>(`/friends/${userId}/block`)
    return response.data
  },
  unblockUser: async (userId: string) => {
    const response = await apiClient.delete<FriendshipActionResponse>(`/friends/${userId}/block`)
    return response.data
  },
  getStatus: async (userId: string) => {
    const response = await apiClient.get<FriendshipStatusResponse>(`/friends/status/${userId}`)
    return response.data
  },
}
