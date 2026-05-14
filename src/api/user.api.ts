import { apiClient } from './client'

import type { DirectoryUser, UserSession } from '../types/user.types'

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
  update: async (id: string, data: { firstName?: string; lastName?: string }) => {
    const response = await apiClient.patch<UserSession>(`/users/${id}`, data)
    return response.data
  },
}
