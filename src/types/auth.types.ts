import type { UserSession } from './user.types'

export interface LoginResponse {
  user: UserSession
}

export type MeResponse = UserSession

export interface SocketTokenResponse {
  accessToken: string
}

export interface MessageResponse {
  message: string
}
