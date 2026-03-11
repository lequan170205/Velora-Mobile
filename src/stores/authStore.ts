import { create } from 'zustand'

import { authApi } from '../api/auth.api'
import type { UserSession } from '../types/user.types'

interface AuthState {
  user: UserSession | null
  isAuthenticated: boolean
  isLoading: boolean

  setUser: (user: UserSession) => void
  clearAuth: () => void
  hydrateAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) => set({ user, isAuthenticated: true }),

  clearAuth: () => {
    set({ user: null, isAuthenticated: false })
  },

  hydrateAuth: async () => {
    try {
      set({ isLoading: true })
      const data = await authApi.me()
      set({ user: data, isAuthenticated: true, isLoading: false })
    } catch (error) {
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },
}))
