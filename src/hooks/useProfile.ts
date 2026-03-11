import { useMutation } from '@tanstack/react-query'

import { mediaApi } from '../api/media.api'
import { userApi } from '../api/user.api'
import { useAuthStore } from '../stores/authStore'

export function useUpdateProfile() {
  const { user, hydrateAuth } = useAuthStore()

  return useMutation({
    mutationFn: (data: { firstName?: string; lastName?: string }) => {
      if (!user) throw new Error('Not logged in')
      return userApi.update(user.id, data)
    },
    onSuccess: () => {
      hydrateAuth()
    },
  })
}

export function useUpdateAvatar() {
  const { user, hydrateAuth } = useAuthStore()

  return useMutation({
    mutationFn: async (fileUri: string) => {
      if (!user) throw new Error('Not logged in')

      const fileName = fileUri.split('/').pop() || 'avatar.jpg'
      const mimeType = fileName.endsWith('png') ? 'image/png' : 'image/jpeg'

      const { uploadUrl, fileKey } = await mediaApi.getUploadUrl({ fileName, mimeType })

      const resp = await fetch(fileUri)
      const blob = await resp.blob()
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
      })

      const result = await mediaApi.confirmUpload({ fileKey })
      return result
    },
    onSuccess: () => {
      hydrateAuth()
    },
  })
}
