import { apiClient } from './client'

import type { UsernameAvailabilityResponse } from '../types/auth.types'
import type {
  DirectoryUser,
  PublicUserProfile,
  UserProfileUpdateInput,
  UserSession,
} from '../types/user.types'

interface UsersIndexResponse {
  data: DirectoryUser[]
  meta: {
    total: number
    page: number
    limit: number
    lastPage: number
  }
}

export const userApi = {
  getAll: async (params: { page: number; limit: number; search?: string }) => {
    const response = await apiClient.get<UsersIndexResponse>('/users', { params })
    const { data, meta } = response.data

    return {
      users: data,
      total: meta.total,
      page: meta.page,
      totalPages: meta.lastPage,
    }
  },
  discover: async (params: { query: string; limit?: number }) => {
    const normalizedQuery = params.query.trim()

    if (!normalizedQuery) {
      return []
    }

    const response = await apiClient.get<PublicUserProfile[]>('/users/discover', {
      params: {
        query: normalizedQuery,
        limit: params.limit ?? 20,
      },
    })

    return response.data
  },
  recommended: async (params: { limit?: number } = {}) => {
    const response = await apiClient.get<PublicUserProfile[]>('/users/recommended', {
      params: {
        limit: params.limit ?? 20,
      },
    })

    return response.data
  },
  findPublicProfile: async (username: string) => {
    const normalizedUsername = username.trim().replace(/^@+/, '')

    if (!normalizedUsername) {
      throw new Error('Username is required.')
    }

    const response = await apiClient.get<PublicUserProfile>(
      `/users/public/${encodeURIComponent(normalizedUsername)}`,
    )

    return response.data
  },
  findByEmail: async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      return null
    }

    const response = await userApi.getAll({
      page: 1,
      limit: 20,
      search: normalizedEmail,
    })

    return (
      response.users.find((user) => user.email.trim().toLowerCase() === normalizedEmail) ?? null
    )
  },
  getById: async (id: string) => {
    const response = await apiClient.get<UserSession>(`/users/${id}`)
    return response.data
  },
  update: async (id: string, data: UserProfileUpdateInput) => {
    const response = await apiClient.patch<UserSession>(`/users/${id}`, data)
    return response.data
  },
  updateAvatar: async (data: { avatarKey: string }) => {
    const response = await apiClient.patch<UserSession>('/users/me/avatar', data)
    return response.data
  },
  checkUsernameAvailability: async (username: string) => {
    const response = await apiClient.get<UsernameAvailabilityResponse>(
      '/users/username-availability',
      {
        params: { username },
      },
    )
    return response.data
  },
}
