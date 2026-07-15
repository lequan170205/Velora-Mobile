import type { PaginatedReels, ReelFeedListItem } from '../types/reel.types'
import type { RecommendedPublicUserProfile } from '../types/user.types'

export const parseRecommendedReelsResponse = (
  response: PaginatedReels<ReelFeedListItem>,
): PaginatedReels<ReelFeedListItem> => ({
  ...response,
  items: response.items.map((reel) => ({
    ...reel,
    ...(reel.recommendation ? { recommendation: reel.recommendation } : {}),
  })),
})

export const parseRecommendedUsersResponse = (
  users: RecommendedPublicUserProfile[],
): RecommendedPublicUserProfile[] =>
  users.map((user) => ({
    ...user,
    ...(user.recommendation ? { recommendation: user.recommendation } : {}),
  }))

export const flattenRecommendedReelPages = (
  pages: readonly PaginatedReels<ReelFeedListItem>[],
  feedSessionId: string,
) => {
  const seenReelIds = new Set<string>()

  return pages.flatMap((page) => {
    if (page.feedSessionId && page.feedSessionId !== feedSessionId) {
      return []
    }

    return page.items.filter((reel) => {
      if (seenReelIds.has(reel.id)) {
        return false
      }

      seenReelIds.add(reel.id)
      return true
    })
  })
}
