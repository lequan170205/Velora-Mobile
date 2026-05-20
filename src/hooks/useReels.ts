import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { mediaApi } from '../api/media.api'
import { reelsApi } from '../api/reels.api'
import { queryKeys } from '../constants/queryKeys'
import { DEFAULT_REELS_LIMIT } from '../constants/reels'

import type { AllowedVideoType, ListReelsParams } from '../types/reel.types'

const REELS_QUERY_STALE_TIME_MS = 30 * 1000

type LegacyFileSystemModule = {
  FileSystemUploadType: {
    BINARY_CONTENT: number
  }
  uploadAsync: (
    url: string,
    fileUri: string,
    options: {
      headers?: Record<string, string>
      httpMethod?: string
      uploadType?: number
    },
  ) => Promise<{ status: number }>
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const LegacyFileSystem = require('expo-file-system/legacy') as LegacyFileSystemModule

interface CreateReelVariables {
  fileUri: string
  fileType: AllowedVideoType
  title: string
  description: string
  tags: string[]
}

type CreateReelStep = 'idle' | 'uploading' | 'creating'

const normalizeListParams = (params: Omit<ListReelsParams, 'cursor'> = {}) => ({
  ...(params.limit ? { limit: params.limit } : {}),
  ...(params.userId ? { userId: params.userId } : {}),
  ...(params.visibility ? { visibility: params.visibility } : {}),
})

export function useReelsFeed(
  params: Omit<ListReelsParams, 'cursor'> = {},
  options: { enabled?: boolean } = {},
) {
  const normalizedParams =
    Object.keys(params).length > 0 ? normalizeListParams(params) : { limit: DEFAULT_REELS_LIMIT }

  return useInfiniteQuery({
    queryKey: queryKeys.reels.list(normalizedParams),
    enabled: options.enabled ?? true,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      reelsApi.list({
        ...normalizedParams,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: REELS_QUERY_STALE_TIME_MS,
  })
}

export function useReelDetail(id?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.reels.detail(id || 'unknown'),
    queryFn: () => {
      if (!id) {
        throw new Error('Missing reel id')
      }

      return reelsApi.getById(id)
    },
    enabled: Boolean(id) && (options.enabled ?? true),
    staleTime: REELS_QUERY_STALE_TIME_MS,
  })
}

export function useCreateReel() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<CreateReelStep>('idle')

  const mutation = useMutation({
    mutationFn: async ({ fileUri, fileType, title, description, tags }: CreateReelVariables) => {
      setStep('uploading')
      const { uploadUrl, key } = await mediaApi.getReelUploadUrl({ fileType })

      const uploadResponse = await LegacyFileSystem.uploadAsync(uploadUrl, fileUri, {
        httpMethod: 'PUT',
        uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': fileType },
      })

      if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
        throw new Error('Video upload failed')
      }

      setStep('creating')
      return reelsApi.create({
        mediaKey: key,
        title,
        description,
        tags,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.reels.all })
    },
    onSettled: () => {
      setStep('idle')
    },
  })

  return { ...mutation, step }
}
