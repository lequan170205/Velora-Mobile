export const RECOMMENDATION_CANDIDATE_SOURCES = [
  'RECENT_QUALITY',
  'TRENDING',
  'TAG_AFFINITY',
  'CREATOR_AFFINITY',
  'CONTENT_SIMILARITY',
  'SOCIAL',
  'EXPLORATION',
] as const

export type RecommendationCandidateSource = (typeof RECOMMENDATION_CANDIDATE_SOURCES)[number]

export interface RecommendationMetadata {
  recommendationId: string
  feedSessionId: string
  algorithmVersion: string
  candidateSource: RecommendationCandidateSource
  candidateSources?: string[]
  candidateReasons?: string[]
  candidateScore?: number
  rank: number
  generatedAt: string
}
