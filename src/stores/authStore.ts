import { isAxiosError } from 'axios'
import { create } from 'zustand'

import { authApi } from '../api/auth.api'
import { resumePushTokenRegistration } from '../lib/notifications/pushTokenOperationState'

import type { UserSession } from '../types/user.types'

type AuthHydrationError = 'network' | 'unauthorized' | null
type HydrateAuthOptions = {
  silent?: boolean
  fresh?: boolean
}

interface AuthState {
  user: UserSession | null
  isAuthenticated: boolean
  isLoading: boolean
  authHydrationError: AuthHydrationError

  setUser: (user: UserSession) => void
  clearAuth: () => void
  hydrateAuth: (options?: HydrateAuthOptions) => Promise<void>
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

let authHydrationPromise: Promise<void> | null = null
let authHydrationVersion = 0

const invalidateAuthHydration = () => {
  authHydrationVersion += 1
  authHydrationPromise = null
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  authHydrationError: null,

  setUser: (user) => {
    invalidateAuthHydration()
    set({ user, isAuthenticated: true, isLoading: false, authHydrationError: null })
  },

  clearAuth: () => {
    invalidateAuthHydration()
    set({ user: null, isAuthenticated: false, isLoading: false, authHydrationError: null })
  },

  hydrateAuth: (options) => {
    const shouldShowLoading = !options?.silent

    if (authHydrationPromise && !options?.fresh) {
      if (shouldShowLoading) {
        set({ isLoading: true })
      }

      return authHydrationPromise
    }

    const hydrationVersion = ++authHydrationVersion
    // Release the shared promise before the final state write. A caller that
    // reacts to that write (e.g. a remounted root layout) must start a new
    // hydration: joining this settled one would set isLoading back to true
    // with nothing left to clear it.
    const settle: typeof set = (partial) => {
      authHydrationPromise = null
      set(partial)
    }
    const hydrationPromise = (async () => {
      try {
        if (shouldShowLoading) {
          set({ isLoading: true })
        }

        const hasSession = await authApi.restoreSession()
        if (hydrationVersion !== authHydrationVersion) return

        if (!hasSession) {
          settle({ user: null, isAuthenticated: false, isLoading: false, authHydrationError: null })
          return
        }

        const data = await authApi.me()
        if (hydrationVersion !== authHydrationVersion) return

        await resumePushTokenRegistration()
        if (hydrationVersion !== authHydrationVersion) return

        settle({ user: data, isAuthenticated: true, isLoading: false, authHydrationError: null })
      } catch (error) {
        if (hydrationVersion !== authHydrationVersion) return

        const hydrationError = getAuthHydrationError(error)

        if (hydrationError === 'unauthorized') {
          settle({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            authHydrationError: hydrationError,
          })
          return
        }

        settle((state) => ({
          user: state.user,
          isAuthenticated: state.isAuthenticated,
          isLoading: false,
          authHydrationError: hydrationError,
        }))
      }
    })()

    authHydrationPromise = hydrationPromise
    return hydrationPromise.finally(() => {
      if (authHydrationPromise === hydrationPromise) {
        authHydrationPromise = null
      }
    })
  },
}))
