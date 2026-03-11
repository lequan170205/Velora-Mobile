import { apiClient } from './client'

export const mediaApi = {
  getUploadUrl: async (data: {
    fileName: string
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  }) => {
    const response = await apiClient.post<{
      uploadUrl: string
      fileKey: string
      publicUrl: string
    }>('/media/upload-url', data)
    return response.data
  },
  confirmUpload: async (data: { fileKey: string }) => {
    const response = await apiClient.post<{ avatar: string }>('/media/confirm', data)
    return response.data
  },
}
