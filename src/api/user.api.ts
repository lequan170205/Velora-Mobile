import type { UserSession } from '../types/user.types'

import { apiClient } from './client'

export const userApi = {
  getAll: async (params: { page: number; limit: number; search?: string }) => {
    const response = await apiClient.get<{
      users: UserSession[]
      total: number
      page: number
      totalPages: number
    }>('/users', { params })
    return response.data
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
