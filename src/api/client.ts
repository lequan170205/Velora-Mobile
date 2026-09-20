import axios, { isAxiosError } from 'axios'

import { authTokenSession } from '../lib/auth/tokenSession'

import type { MobileAuthTokenPair } from '../types/auth.types'

export const apiClient = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL || '',
  timeout: 10_000,
})

let refreshPromise: Promise<MobileAuthTokenPair | null> | null = null
let isLogoutInProgress = false

const NON_REFRESHABLE_AUTH_ROUTES = new Set([
  '/auth/mobile/login',
  '/auth/mobile/google/verify',
  '/auth/mobile/refresh',
  '/auth/mobile/logout',
])

apiClient.interceptors.request.use((config) => {
  const accessToken = authTokenSession.getAccessToken()

  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return config
})

export const beginLogout = async () => {
  isLogoutInProgress = true

  try {
    await refreshPromise
  } catch {
    // A failed refresh cannot restore the session and must not block logout.
  }
}

export const endLogout = () => {
  isLogoutInProgress = false
}

export const refreshAccessToken = () => {
  if (isLogoutInProgress) {
    return Promise.resolve(null)
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await authTokenSession.getRefreshToken()

      if (!refreshToken) {
        return null
      }

      const refreshRequestId = await authTokenSession.getOrCreateRefreshRequestId()

      try {
        const response = await apiClient.post<MobileAuthTokenPair>('/auth/mobile/refresh', {
          refreshToken,
          refreshRequestId,
        })

        await authTokenSession.installTokenPair(response.data)
        return response.data
      } catch (error) {
        const status = isAxiosError(error) ? error.response?.status : undefined

        if (status === 401 || status === 403) {
          try {
            await authTokenSession.clear()
          } catch {
            // Preserve the definitive auth error. The server-side token is already unusable.
          }
        }

        throw error
      }
    })().finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const requestUrl = originalRequest?.url

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !isLogoutInProgress &&
      !NON_REFRESHABLE_AUTH_ROUTES.has(requestUrl)
    ) {
      originalRequest._retry = true

      try {
        const refreshedSession = await refreshAccessToken()

        if (!refreshedSession) {
          return Promise.reject(error)
        }

        return apiClient(originalRequest)
      } catch (refreshError) {
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)
