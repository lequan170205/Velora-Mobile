import { authTokenSession } from '../lib/auth/tokenSession'

import { apiClient, beginLogout, endLogout, refreshAccessToken } from './client'

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

type LogoutPushToken = {
  provider: 'fcm' | 'apns_voip'
  token: string
  deviceId?: string
  lifecycleVersion?: number
}

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
    const response = await apiClient.post<LoginResponse>('/auth/mobile/login', data)
    await authTokenSession.installTokenPair(response.data)
    return response.data
  },
  logout: async (data?: { pushToken?: string; pushTokens?: LogoutPushToken[] }) => {
    await beginLogout()

    try {
      const refreshToken = await authTokenSession.getRefreshToken()

      if (!refreshToken) {
        throw new Error('Cannot logout without a refresh token')
      }

      const response = await apiClient.post<MessageResponse>(
        '/auth/mobile/logout',
        { ...data, refreshToken },
        {
          timeout: 5000,
        },
      )

      await authTokenSession.clear()
      return response.data
    } finally {
      endLogout()
    }
  },
  refresh: () => refreshAccessToken(),
  /**
   * Restores the in-memory bearer session on cold start when needed.
   *
   * If an access token is already installed, this is a no-op so profile hydration does not rotate
   * refresh credentials unnecessarily. Otherwise it refreshes from SecureStore. Network failures
   * propagate without deleting the stored refresh token; definitive 401/403 refresh failures clear
   * the local token session before propagating the auth error.
   */
  restoreSession: async (): Promise<boolean> => {
    if (authTokenSession.hasAccessToken()) return true

    const restoredSession = await refreshAccessToken()
    return Boolean(restoredSession)
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
    const response = await apiClient.post<LoginResponse>('/auth/mobile/google/verify', data)
    await authTokenSession.installTokenPair(response.data)
    return response.data
  },
  resendVerificationEmail: async (email: string) => {
    const response = await apiClient.post<MessageResponse>('/auth/resend-verification', { email })
    return response.data
  },
}
