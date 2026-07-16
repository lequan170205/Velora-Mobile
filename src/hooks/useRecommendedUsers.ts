import { useQuery } from '@tanstack/react-query'
import { useRef } from 'react'

import { userApi } from '../api/user.api'
import { queryKeys } from '../constants/queryKeys'
import { RecommendationSession } from '../lib/recommendationSession'
import {
  filterAcceptedFriendsFromRecommendedContacts,
  filterBlockedUsers,
} from '../lib/recommendedContacts'
import { useAuthStore } from '../stores/authStore'

import { useBlockedUserIds, useFriends } from './useFriends'

const normalizeRecommendedUsersLimit = (limit?: number) => {
  if (!Number.isFinite(limit)) {
    return 20
  }

  return Math.max(1, Math.floor(limit ?? 20))
}

export function useRecommendedUsers(params: { enabled?: boolean; limit?: number } = {}) {
  const userId = useAuthStore((state) => state.user?.id)
  const { data: acceptedFriends = [] } = useFriends(undefined, { enabled: Boolean(userId) })
  const blockedUsers = useBlockedUserIds()
  const recommendationSessionRef = useRef<RecommendationSession | null>(null)

  if (!recommendationSessionRef.current) {
    recommendationSessionRef.current = new RecommendationSession(userId)
  }

  const feedSessionId = recommendationSessionRef.current.getFeedSessionId(userId)
  const limit = normalizeRecommendedUsersLimit(params.limit)

  const query = useQuery({
    queryKey: queryKeys.users.recommended({ userId: userId ?? null, feedSessionId, limit }),
    queryFn: () => userApi.recommended({ limit, feedSessionId }),
    enabled: params.enabled ?? true,
    staleTime: 2 * 60_000,
  })

  const visibleUsers = query.data
    ? filterBlockedUsers(
        filterAcceptedFriendsFromRecommendedContacts(query.data, acceptedFriends),
        blockedUsers.blockedUserIds,
      )
    : undefined

  return {
    ...query,
    data: blockedUsers.isVisibilityReady ? visibleUsers : undefined,
    isError: query.isError || blockedUsers.isError,
    isLoading: query.isLoading || blockedUsers.isLoading,
    feedSessionId,
  }
}
