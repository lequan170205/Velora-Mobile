import type { ReelFeedListItem } from './reel.types'
import type { PublicUserProfile as BasePublicUserProfile } from './user.types'

export type GlobalSearchType = 'all' | 'users' | 'reels' | 'tags'

export type PublicUserProfile = BasePublicUserProfile

export interface GlobalSearchParams {
  q: string
  type?: GlobalSearchType
  limit?: number
}

export interface SearchTagItem {
  /** Normalized key; send it back unchanged to the tag reels endpoint. */
  tag: string
  /** Public, playable reels carrying the tag (recent window). */
  reelCount: number
}

export interface GlobalSearchResponse {
  query: string
  type: GlobalSearchType
  users: PublicUserProfile[]
  reels: ReelFeedListItem[]
  tags: SearchTagItem[]
  counts: {
    users: number
    reels: number
    tags: number
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

export interface SearchTagsParams {
  /** Omit for trending tags. */
  q?: string
  limit?: number
}

export interface SearchTagsResponse {
  tags: SearchTagItem[]
}

export interface TagReelsParams {
  tag: string
  cursor?: string
  limit?: number
}

export interface TagReelsPage {
  items: ReelFeedListItem[]
  nextCursor: string | null
}
