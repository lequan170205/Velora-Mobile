import { apiClient } from './client'

import type {
  AuthIdentityResponse,
  LoginResponse,
  MeResponse,
  MessageResponse,
  RegisterPayload,
  RegisterResponse,
  SocketTokenResponse,
} from '../types/auth.types'
import type { UserSession } from '../types/user.types'

const splitFullName = (fullName?: string) => {
  const tokens = fullName?.trim().split(/\s+/).filter(Boolean) ?? []

  if (tokens.length === 0) {
    return { firstName: '', lastName: '' }
  }

  if (tokens.length === 1) {
    return { firstName: tokens[0], lastName: '' }
  }

  return {
    firstName: tokens[0],
    lastName: tokens.slice(1).join(' '),
  }
}

const toUserSession = (data: AuthIdentityResponse): UserSession => {
  const { firstName, lastName } = splitFullName(data.fullName)

  return {
    id: data.id,
    email: data.email,
    firstName,
    lastName,
    picture: data.picture ?? null,
    role: data.roles.includes('ADMIN') ? 'ADMIN' : 'USER',
    isEmailVerified: Boolean(data.isVerified),
    ...(data.fullName ? { fullName: data.fullName } : {}),
    ...(data.username ? { username: data.username } : {}),
  }
}

export const authApi = {
  register: async (data: RegisterPayload) => {
    const response = await apiClient.post<RegisterResponse>('/auth/register', data)
    return response.data
  },
  login: async (data: Record<string, unknown>) => {
    const response = await apiClient.post<LoginResponse>('/auth/login', data)
    return response.data
  },
  logout: async (data?: { pushToken?: string }) => {
    const response = await apiClient.post<MessageResponse>('/auth/logout', data, {
      timeout: 5000,
    })
    return response.data
  },
  refresh: async () => {
    const response = await apiClient.post<LoginResponse>('/auth/refresh')
    return response.data
  },
  me: async () => {
    const response = await apiClient.get<MeResponse>('/auth/me')
    return toUserSession(response.data)
  },
  getSocketToken: async () => {
    const response = await apiClient.get<SocketTokenResponse>('/auth/socket-token', {
      timeout: 5000,
    })
    return response.data
  },
  confirm: async (token: string) => {
    const response = await apiClient.post<MessageResponse>('/auth/confirm', { token })
    return response.data
  },
  forgotPassword: async (email: string) => {
    const response = await apiClient.post<MessageResponse>('/auth/forgot-password', { email })
    return response.data
  },
  resetPassword: async (data: Record<string, unknown>) => {
    const response = await apiClient.post<MessageResponse>('/auth/reset-password', data)
    return response.data
  },
  verifyGoogleToken: async (data: { idToken: string }) => {
    const response = await apiClient.post<MessageResponse>('/auth/google/verify', data)
    return response.data
  },
  resendVerificationEmail: async (email: string) => {
    const response = await apiClient.post<MessageResponse>('/auth/resend-verification', { email })
    return response.data
  },
}
