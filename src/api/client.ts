import axios, { isAxiosError } from 'axios'

import { authTokenSession } from '../lib/auth/tokenSession'

import type { MobileAuthTokenPair } from '../types/auth.types'

declare module 'axios' {
  interface AxiosRequestConfig {
    commentSessionGuard?: () => boolean
    authSessionGeneration?: number
  }
}

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

apiClient.interceptors.request.use(
  (config) => {
    if (
      authTokenSession.isTransitioning() &&
      (!NON_REFRESHABLE_AUTH_ROUTES.has(config.url ?? '') ||
        config.authSessionGeneration !== undefined)
    ) {
      throw new Error('Auth session changing')
    }
    if (
      config.authSessionGeneration === undefined &&
      !NON_REFRESHABLE_AUTH_ROUTES.has(config.url ?? '')
    ) {
      config.authSessionGeneration = authTokenSession.getGeneration()
    }
    if (
      config.authSessionGeneration !== undefined &&
      config.authSessionGeneration !== authTokenSession.getGeneration()
    ) {
      throw new Error('Auth session changed')
    }
    if (config.commentSessionGuard && !config.commentSessionGuard()) {
      throw new Error('Comment session changed')
    }
    const accessToken = authTokenSession.getAccessToken()
    if (
      accessToken &&
      !authTokenSession.getIdentity() &&
      config.url !== '/auth/me' &&
      !NON_REFRESHABLE_AUTH_ROUTES.has(config.url ?? '')
    ) {
      throw new Error('Auth identity not verified')
    }

    if (accessToken) {
      config.headers.set('Authorization', `Bearer ${accessToken}`)
    }

    return config
  },
  (error) => {
    throw error
  },
  { synchronous: true },
)

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
    const generation = authTokenSession.getGeneration()
    refreshPromise = (async () => {
      await authTokenSession.waitForWrites()
      if (generation !== authTokenSession.getGeneration() || !(await authTokenSession.canRestore()))
        return null
      if (generation !== authTokenSession.getGeneration()) return null
      const refreshToken = await authTokenSession.getRefreshToken()

      if (!refreshToken || generation !== authTokenSession.getGeneration()) {
        return null
      }

      const refreshRequestId = await authTokenSession.getOrCreateRefreshRequestId()
      if (generation !== authTokenSession.getGeneration()) return null

      try {
        const response = await apiClient.post<MobileAuthTokenPair>(
          '/auth/mobile/refresh',
          { refreshToken, refreshRequestId },
          { authSessionGeneration: generation },
        )

        const installed = await authTokenSession.rotateTokenPair(response.data, generation)
        return installed ? response.data : null
      } catch (error) {
        const status = isAxiosError(error) ? error.response?.status : undefined

        if ((status === 401 || status === 403) && generation === authTokenSession.getGeneration()) {
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
  (response) => {
    if (
      response.config.authSessionGeneration !== undefined &&
      response.config.authSessionGeneration !== authTokenSession.getGeneration()
    ) {
      throw new Error('Auth session changed')
    }
    return response
  },
  async (error) => {
    const originalRequest = error.config
    const requestUrl = originalRequest?.url
    if (
      originalRequest?.authSessionGeneration !== undefined &&
      originalRequest.authSessionGeneration !== authTokenSession.getGeneration()
    ) {
      return Promise.reject(new Error('Auth session changed'))
    }

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      (!originalRequest.commentSessionGuard || originalRequest.commentSessionGuard()) &&
      !isLogoutInProgress &&
      !NON_REFRESHABLE_AUTH_ROUTES.has(requestUrl)
    ) {
      originalRequest._retry = true

      try {
        const refreshedSession = await refreshAccessToken()

        if (
          !refreshedSession ||
          (originalRequest.authSessionGeneration !== undefined &&
            originalRequest.authSessionGeneration !== authTokenSession.getGeneration()) ||
          (originalRequest.commentSessionGuard && !originalRequest.commentSessionGuard())
        ) {
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
