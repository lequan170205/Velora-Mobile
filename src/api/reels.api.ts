import { apiClient } from './client'

import type {
  CreateReelPayload,
  ListReelsParams,
  ListReelsResponse,
  ReelDetail,
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
  create: async (data: CreateReelPayload) => {
    const response = await apiClient.post<ReelDetail>('/content/reels', data)
    return response.data
  },
}
