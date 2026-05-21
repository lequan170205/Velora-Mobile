import { apiClient } from './client'

import type { AllowedChatMediaType } from '../lib/chatMedia'
import type { MessageMedia } from '../types/conversation.types'
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
  confirmUpload: async (data: { fileKey: string }) => {
    const response = await apiClient.post<{ avatar: string }>('/media/confirm', data)
    return response.data
  },
  getChatUploadUrl: async (data: {
    fileType: AllowedChatMediaType
    purpose?: 'chat' | 'chat_thumbnail'
  }) => {
    const response = await apiClient.post<{
      uploadUrl: string
      key: string
      expiresIn: number
    }>('/media/upload-url', {
      fileType: data.fileType,
      purpose: data.purpose ?? 'chat',
    })
    return response.data
  },
  finalizeChatUpload: async (data: {
    key: string
    fileType: AllowedChatMediaType
    thumbnailKey?: string
  }) => {
    const response = await apiClient.post<MessageMedia>('/media/finalize-upload', data)
    return response.data
  },
  getReelUploadUrl: async (data: ReelUploadUrlRequest) => {
    const response = await apiClient.post<ReelUploadUrlResponse>('/media/upload-url', data)
    return response.data
  },
}
