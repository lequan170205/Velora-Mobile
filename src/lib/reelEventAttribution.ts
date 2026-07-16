import type { RecommendationMetadata } from '../types/recommendation.types'
import type { ReelEventRecommendation } from '../types/reel.types'

export const toReelEventRecommendation = (
  recommendation: RecommendationMetadata | undefined,
): ReelEventRecommendation | undefined => {
  if (!recommendation) {
    return undefined
  }

  return {
    recommendationId: recommendation.recommendationId,
    feedSessionId: recommendation.feedSessionId,
    algorithmVersion: recommendation.algorithmVersion,
    candidateSource: recommendation.candidateSource,
    rank: recommendation.rank,
    generatedAt: recommendation.generatedAt,
  }
}
