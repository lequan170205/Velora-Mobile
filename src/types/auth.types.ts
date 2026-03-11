import type { UserSession } from './user.types'

export interface LoginResponse {
  user: UserSession
}

export interface MeResponse {
  user: UserSession
}

export interface MessageResponse {
  message: string
}
