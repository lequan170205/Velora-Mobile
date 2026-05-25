import { apiClient } from './client'

import type {
  CreateReelPayload,
  ReelContextParams,
  ReelContextResponse,
  ListReelsParams,
  ListReelsResponse,
  ReelDetail,
  ReelProcessingStatusResponse,
  UpdateReelPayload,
} from '../types/reel.types'

export const reelsApi = {
  list: async (params: ListReelsParams = {}) => {
    const response = await apiClient.get<ListReelsResponse>('/content/reels', { params })
    return response.data
  },
  getById: async (id: string) => {
    const response = await apiClient.get<ReelDetail>(`/content/reels/${id}`)
    return response.data
  },
  getContext: async (id: string, params: ReelContextParams = {}) => {
    const response = await apiClient.get<ReelContextResponse>(`/content/reels/${id}/context`, {
      params,
    })
    return response.data
  },
  getStatus: async (id: string) => {
    const response = await apiClient.get<ReelProcessingStatusResponse>(
      `/content/reels/${id}/status`,
    )
    return response.data
  },
  create: async (data: CreateReelPayload) => {
    const response = await apiClient.post<ReelDetail>('/content/reels', data)
    return response.data
  },
  update: async (id: string, data: UpdateReelPayload) => {
    const response = await apiClient.patch<ReelDetail>(`/content/reels/${id}`, data)
    return response.data
  },
  delete: async (id: string) => {
    await apiClient.delete(`/content/reels/${id}`)
  },
}
