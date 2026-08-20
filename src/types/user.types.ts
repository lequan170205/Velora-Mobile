import type { RecommendationMetadata } from './recommendation.types'

export interface UserSession {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName?: string
  username?: string
  picture?: string | null
  role: 'USER' | 'ADMIN'
  isEmailVerified: boolean
  createdAt?: string
}

export interface UserProfileUpdateInput {
  fullName?: string
  username?: string
}

export interface DirectoryUser {
  id: string
  email: string
  fullName?: string
  username?: string | null
  picture?: string | null
  createdAt: string
}

export interface UserSummary {
  id: string
  email: string
  picture?: string | null
}

export interface PublicUserProfile {
  id: string
  fullName: string
  username: string | null
  picture: string | null
  isVerified: boolean
}

export interface RecommendedPublicUserProfile extends PublicUserProfile {
  recommendation?: RecommendationMetadata
}
