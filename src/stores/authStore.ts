import { isAxiosError } from 'axios'
import { create } from 'zustand'

import { authApi } from '../api/auth.api'
import { resumePushTokenRegistration } from '../lib/notifications/pushTokenOperationState'

import type { UserSession } from '../types/user.types'

type AuthHydrationError = 'network' | 'unauthorized' | null

interface AuthState {
  user: UserSession | null
  isAuthenticated: boolean
  isLoading: boolean
  authHydrationError: AuthHydrationError

  setUser: (user: UserSession) => void
  clearAuth: () => void
  hydrateAuth: (options?: { silent?: boolean }) => Promise<void>
}

const getAuthHydrationError = (error: unknown): Exclude<AuthHydrationError, null> => {
  if (isAxiosError(error)) {
    const status = error.response?.status

    if (status === 401 || status === 403) {
      return 'unauthorized'
    }

    return 'network'
  }

  return 'network'
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  authHydrationError: null,

  setUser: (user) => set({ user, isAuthenticated: true, authHydrationError: null }),

  clearAuth: () => {
    set({ user: null, isAuthenticated: false, authHydrationError: null })
  },

  hydrateAuth: async (options) => {
    const shouldShowLoading = !options?.silent

    try {
      if (shouldShowLoading) {
        set({ isLoading: true })
      }

      const data = await authApi.me()
      await resumePushTokenRegistration()
      set({ user: data, isAuthenticated: true, isLoading: false, authHydrationError: null })
    } catch (error) {
      const hydrationError = getAuthHydrationError(error)

      if (hydrationError === 'unauthorized') {
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          authHydrationError: hydrationError,
        })
        return
      }

      set((state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        isLoading: false,
        authHydrationError: hydrationError,
      }))
    }
  },
}))
