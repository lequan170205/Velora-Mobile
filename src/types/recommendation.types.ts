export const RECOMMENDATION_CANDIDATE_SOURCES = [
  'RECENT_QUALITY',
  'TRENDING',
  'TAG_AFFINITY',
  'CREATOR_AFFINITY',
  'CONTENT_SIMILARITY',
  'SEMANTIC',
  'SOCIAL',
  'EXPLORATION',
] as const

export type RecommendationCandidateSource = (typeof RECOMMENDATION_CANDIDATE_SOURCES)[number]

export const USER_RECOMMENDATION_CANDIDATE_SOURCES = [
  'GRAPH_TWO_HOP',
  'PUBLIC_USER_FALLBACK',
] as const

export type UserRecommendationCandidateSource =
  (typeof USER_RECOMMENDATION_CANDIDATE_SOURCES)[number]

export interface RecommendationMetadata {
  recommendationId: string
  feedSessionId: string
  algorithmVersion: string
  candidateSource: RecommendationCandidateSource
  candidateSources?: RecommendationCandidateSource[]
  rank: number
  generatedAt: string
}

export interface UserRecommendationMetadata extends Omit<
  RecommendationMetadata,
  'candidateSource'
> {
  candidateSource: UserRecommendationCandidateSource
}
