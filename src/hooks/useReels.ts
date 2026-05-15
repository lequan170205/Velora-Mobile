import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { mediaApi } from '../api/media.api'
import { reelsApi } from '../api/reels.api'
import { queryKeys } from '../constants/queryKeys'
import { DEFAULT_REELS_LIMIT } from '../constants/reels'

import type { AllowedVideoType, ListReelsParams } from '../types/reel.types'

const REELS_QUERY_STALE_TIME_MS = 30 * 1000

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

export function useReelsFeed(params: Omit<ListReelsParams, 'cursor'> = {}) {
  const normalizedParams =
    Object.keys(params).length > 0 ? normalizeListParams(params) : { limit: DEFAULT_REELS_LIMIT }

  return useInfiniteQuery({
    queryKey: queryKeys.reels.list(normalizedParams),
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

export function useReelDetail(reelId?: string, enabled = true) {
  return useQuery({
    queryKey: reelId ? queryKeys.reels.detail(reelId) : ['reels', 'detail', 'unknown'],
    queryFn: () => reelsApi.getById(reelId as string),
    enabled: !!reelId && enabled,
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

      const localFileResponse = await fetch(fileUri)
      const fileBlob = await localFileResponse.blob()

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': fileType },
        body: fileBlob,
      })

      if (!uploadResponse.ok) {
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
