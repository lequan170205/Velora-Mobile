import type { FriendSummary } from '../types/friend.types'
import type { PublicUserProfile } from '../types/user.types'

export const filterBlockedUsers = <T extends { id: string }>(
  users: T[],
  blockedUserIds: Set<string>,
) => users.filter((user) => !blockedUserIds.has(user.id))

export const filterAcceptedFriendsFromRecommendedContacts = <T extends PublicUserProfile>(
  users: T[],
  acceptedFriends: FriendSummary[],
) => {
  const acceptedFriendIds = new Set(acceptedFriends.map((friend) => friend.user.id))
  return users.filter((user) => !acceptedFriendIds.has(user.id))
}
