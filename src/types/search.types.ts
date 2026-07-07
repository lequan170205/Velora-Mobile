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
