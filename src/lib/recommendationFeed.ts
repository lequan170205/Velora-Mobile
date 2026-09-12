import { flattenRecommendedReels } from './recommendedReels'

import type {
  RecommendationMetadata,
  UserRecommendationMetadata,
} from '../types/recommendation.types'
import type { RecommendedReelsPage } from '../types/reel.types'
import type { RecommendedPublicUserProfile } from '../types/user.types'

type RecommendationMetadataLike = RecommendationMetadata | UserRecommendationMetadata

type LegacyRecommendationMetadata = RecommendationMetadataLike & {
  candidateReasons?: unknown
  candidateScore?: unknown
}

const discardLegacyRecommendationFields = <T extends RecommendationMetadataLike>(
  recommendation: T,
): T => {
  const {
    candidateReasons: _candidateReasons,
    candidateScore: _candidateScore,
    ...phaseFiveRecommendation
  } = recommendation as LegacyRecommendationMetadata

  return phaseFiveRecommendation as T
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
  users.map((user) => ({
    ...user,
    recommendation: discardLegacyRecommendationFields(user.recommendation),
  }))

export const flattenRecommendedReelPages = (pages: readonly RecommendedReelsPage[]) =>
  flattenRecommendedReels(pages)
