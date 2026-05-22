export type FriendshipState = 'none' | 'request_sent' | 'request_received' | 'friends'

export interface FriendPaginationParams {
  limit?: number
  cursor?: string
}

export interface PublicFriendProfile {
  id: string
  fullName: string
  username: string
  picture: string | null
}

export interface FriendshipActionResponse {
  message: string
  status: FriendshipState
  id?: string
  conversationId?: string
}

export interface FriendshipStatusResponse {
  status: FriendshipState
  id?: string
}

export interface PaginatedFriendResults<T> {
  items: T[]
  nextCursor?: string | null
}

export interface FriendRequestSummary {
  id: string
  status: 'request_sent' | 'request_received'
  requestedAt: string
  user: PublicFriendProfile
}

export interface FriendSummary {
  id: string
  status: 'friends'
  friendsSince: string
  user: PublicFriendProfile
}
