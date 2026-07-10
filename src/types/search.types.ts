import type { ReelFeedListItem } from './reel.types'
import type { PublicUserProfile as BasePublicUserProfile } from './user.types'

export type GlobalSearchType = 'all' | 'users' | 'reels'

export type PublicUserProfile = BasePublicUserProfile

export interface GlobalSearchParams {
  q: string
  type?: GlobalSearchType
  limit?: number
}

export interface GlobalSearchResponse {
  query: string
  type: GlobalSearchType
  users: PublicUserProfile[]
  reels: ReelFeedListItem[]
  counts: {
    users: number
    reels: number
  }
}

export interface SearchSuggestionItem {
  label: string
  query: string
  source: 'trending_reel_tag' | 'recent_reel_topic' | 'personalized_reel_tag'
  score?: number
}

export interface SearchSuggestionsParams {
  type?: GlobalSearchType
  limit?: number
}

export interface SearchSuggestionsResponse {
  suggestions: SearchSuggestionItem[]
}
