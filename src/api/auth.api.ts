import type { LoginResponse, MeResponse, MessageResponse } from '../types/auth.types'

import { apiClient } from './client'

export const authApi = {
  register: async (data: Record<string, unknown>) => {
    const response = await apiClient.post<MessageResponse>('/auth/register', data)
    return response.data
  },
  login: async (data: Record<string, unknown>) => {
    const response = await apiClient.post<LoginResponse>('/auth/login', data)
    return response.data
  },
  logout: async () => {
    const response = await apiClient.post('/auth/logout')
    return response.data
  },
  refresh: async () => {
    const response = await apiClient.post<LoginResponse>('/auth/refresh')
    return response.data
  },
  me: async () => {
    const response = await apiClient.get<MeResponse>('/auth/me')
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
}
