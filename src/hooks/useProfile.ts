import { useMutation } from '@tanstack/react-query'

import { mediaApi } from '../api/media.api'
import { userApi } from '../api/user.api'
import { useAuthStore } from '../stores/authStore'

import type { UserProfileUpdateInput } from '../types/user.types'

export function useUpdateProfile() {
  const { user, hydrateAuth } = useAuthStore()

  return useMutation({
    mutationFn: (data: UserProfileUpdateInput) => {
      if (!user) throw new Error('Not logged in')
      return userApi.update(user.id, data)
    },
    onSuccess: async () => {
      await hydrateAuth({ silent: true })
    },
  })
}

export function useUpdateAvatar() {
  const { user, hydrateAuth } = useAuthStore()

  return useMutation({
    mutationFn: async (fileUri: string) => {
      if (!user) throw new Error('Not logged in')

      const fileName = fileUri.split('/').pop() || 'avatar.jpg'
      const normalizedFileName = fileName.toLowerCase()
      const mimeType = normalizedFileName.endsWith('.png')
        ? 'image/png'
        : normalizedFileName.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg'

      const { key, uploadUrl } = await mediaApi.getUploadUrl({ fileType: mimeType })

      const resp = await fetch(fileUri)
      const blob = await resp.blob()
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
      })

      const result = await userApi.updateAvatar({ avatarKey: key })
      return result
    },
    onSuccess: async () => {
      await hydrateAuth({ silent: true })
    },
  })
}
