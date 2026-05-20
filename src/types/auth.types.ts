export interface AuthIdentityResponse {
  id: string
  email: string
  fullName?: string
  username?: string | null
  picture?: string | null
  isVerified?: boolean
  roles: string[]
}

export interface AuthMessageResponse {
  message: string
}

export interface RegisterPayload {
  email: string
  password: string
  fullName: string
}

export interface RegisterResponse {
  id: string
  email: string
  fullName: string
  username: string | null
  message: string
}

export interface UsernameAvailabilityResponse {
  username: string
  available: boolean
}

export type LoginResponse = AuthMessageResponse
export type MeResponse = AuthIdentityResponse

export interface SocketTokenResponse {
  accessToken: string
}

export type MessageResponse = AuthMessageResponse
