import { apiClient } from './client'

import type {
  FriendRequestSummary,
  FriendSummary,
  FriendshipActionResponse,
  FriendshipStatusResponse,
} from '../types/friend.types'

export const friendApi = {
  list: async () => {
    const response = await apiClient.get<FriendSummary[]>('/friends')
    return response.data
  },
  listIncomingRequests: async () => {
    const response = await apiClient.get<FriendRequestSummary[]>('/friends/requests/incoming')
    return response.data
  },
  listOutgoingRequests: async () => {
    const response = await apiClient.get<FriendRequestSummary[]>('/friends/requests/outgoing')
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
  getStatus: async (userId: string) => {
    const response = await apiClient.get<FriendshipStatusResponse>(`/friends/status/${userId}`)
    return response.data
  },
}
