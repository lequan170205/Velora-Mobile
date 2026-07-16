import { flattenRecommendedReels } from './recommendedReels'

import type { RecommendationMetadata } from '../types/recommendation.types'
import type { RecommendedReelsPage } from '../types/reel.types'
import type { RecommendedPublicUserProfile } from '../types/user.types'

type LegacyRecommendationMetadata = RecommendationMetadata & {
  candidateReasons?: unknown
  candidateScore?: unknown
}

const discardLegacyRecommendationFields = (
  recommendation: RecommendationMetadata,
): RecommendationMetadata => {
  const {
    candidateReasons: _candidateReasons,
    candidateScore: _candidateScore,
    ...phaseFiveRecommendation
  } = recommendation as LegacyRecommendationMetadata

  return phaseFiveRecommendation
}

export const parseRecommendedReelsResponse = (
  response: RecommendedReelsPage,
): RecommendedReelsPage => ({
  ...response,
  items: response.items.map((reel) =>
    reel.recommendation
      ? { ...reel, recommendation: discardLegacyRecommendationFields(reel.recommendation) }
      : reel,
  ),
})

export const parseRecommendedUsersResponse = (
  users: RecommendedPublicUserProfile[],
): RecommendedPublicUserProfile[] =>
  users.map((user) =>
    user.recommendation
      ? { ...user, recommendation: discardLegacyRecommendationFields(user.recommendation) }
      : user,
  )

export const flattenRecommendedReelPages = (pages: readonly RecommendedReelsPage[]) =>
  flattenRecommendedReels(pages)
