import { apiClient } from './client'

import type { ReelUploadUrlRequest, ReelUploadUrlResponse } from '../types/reel.types'

export const mediaApi = {
  getUploadUrl: async (data: { fileType: 'image/jpeg' | 'image/png' | 'image/webp' }) => {
    const response = await apiClient.post<{
      uploadUrl: string
      key: string
      expiresIn: number
    }>('/media/upload-url', data)
    return response.data
  },
  getReelUploadUrl: async (data: ReelUploadUrlRequest) => {
    const response = await apiClient.post<ReelUploadUrlResponse>('/media/upload-url', data)
    return response.data
  },
}
