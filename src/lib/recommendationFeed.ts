import { flattenRecommendedReels } from './recommendedReels'

import type { RecommendedReelsPage } from '../types/reel.types'
import type { RecommendedPublicUserProfile } from '../types/user.types'

export const parseRecommendedReelsResponse = (
  response: RecommendedReelsPage,
): RecommendedReelsPage => ({
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

export const flattenRecommendedReelPages = (pages: readonly RecommendedReelsPage[]) =>
  flattenRecommendedReels(pages)
