import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { InfiniteData, QueryKey } from '@tanstack/react-query'

import { mediaApi } from '../api/media.api'
import { reelsApi } from '../api/reels.api'
import { queryKeys } from '../constants/queryKeys'
import { DEFAULT_REELS_LIMIT } from '../constants/reels'

import type {
  AllowedVideoType,
  ListReelsParams,
  ListReelsResponse,
  ReelContextParams,
  ReelContextResponse,
  Reel,
  ReelDetail,
  ReelProcessingStatusResponse,
  ReelVisibility,
  UpdateReelPayload,
} from '../types/reel.types'

const REELS_QUERY_STALE_TIME_MS = 30 * 1000
const REEL_STATUS_POLL_INTERVAL_MS = 3000

type ReelsInfiniteData = InfiniteData<ListReelsResponse, string | undefined>
type ReelContextData = ReelContextResponse

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
  visibility: ReelVisibility
  localThumbnailUri?: string
}

type CreateReelStep = 'idle' | 'uploading' | 'creating'

const isTerminalReelStatus = (status?: string | null) => {
  const normalized = status?.trim().toUpperCase()
  return normalized === 'COMPLETED' || normalized === 'FAILED'
}

const isProcessingReel = (reel?: Pick<Reel, 'status'> | null) =>
  Boolean(reel?.status && !isTerminalReelStatus(reel.status))

const mergeReelStatus = <T extends Reel>(reel: T, status: ReelProcessingStatusResponse): T => {
  const nextReel: T = {
    ...reel,
    id: status.reelId || reel.id,
    status: status.status,
    ...(status.mediaKey ? { mediaKey: status.mediaKey } : {}),
    ...(status.thumbnailKey ? { thumbnailKey: status.thumbnailKey } : {}),
    ...(status.thumbnailUrl ? { thumbnailUrl: status.thumbnailUrl } : {}),
    ...(status.streamUrl ? { streamUrl: status.streamUrl } : {}),
  }

  if (typeof status.stage === 'string') {
    nextReel.stage = status.stage
    nextReel.processingStage = status.stage
  }

  if (typeof status.message === 'string') {
    nextReel.message = status.message
    nextReel.processingMessage = status.message
  }

  if (typeof status.progress === 'number') {
    nextReel.progress = status.progress
    nextReel.processingProgress = status.progress
  }

  return nextReel
}

const upsertReelInInfiniteData = (
  data: ReelsInfiniteData | undefined,
  reel: Reel,
): ReelsInfiniteData | undefined => {
  if (!data?.pages.length) {
    return data
  }

  let didUpdate = false
  const pages = data.pages.map((page, pageIndex) => {
    const nextItems = page.items.map((item) => {
      if (item.id !== reel.id) {
        return item
      }

      didUpdate = true
      return { ...item, ...reel }
    })

    if (pageIndex === 0 && !didUpdate) {
      didUpdate = true
      return {
        ...page,
        items: [reel, ...nextItems],
      }
    }

    return {
      ...page,
      items: nextItems,
    }
  })

  return {
    ...data,
    pages,
  }
}

const updateReelInInfiniteData = (
  data: ReelsInfiniteData | undefined,
  reel: Reel,
): ReelsInfiniteData | undefined => {
  if (!data?.pages.length) {
    return data
  }

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === reel.id ? { ...item, ...reel } : item)),
    })),
  }
}

const updateReelInContextData = (
  data: ReelContextData | undefined,
  reel: Reel,
): ReelContextData | undefined => {
  if (!data?.items.length) {
    return data
  }

  return {
    ...data,
    items: data.items.map((item) => (item.id === reel.id ? { ...item, ...reel } : item)),
  }
}

const removeReelFromInfiniteData = (
  data: ReelsInfiniteData | undefined,
  reelId: string,
): ReelsInfiniteData | undefined => {
  if (!data?.pages.length) {
    return data
  }

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.id !== reelId),
    })),
  }
}

const removeReelFromContextData = (
  data: ReelContextData | undefined,
  reelId: string,
): ReelContextData | undefined => {
  if (!data?.items.length) {
    return data
  }

  const removedIndex = data.items.findIndex((item) => item.id === reelId)
  const items = data.items.filter((item) => item.id !== reelId)

  if (removedIndex === -1) {
    return data
  }

  const selectedIndex =
    removedIndex < data.selectedIndex
      ? Math.max(0, data.selectedIndex - 1)
      : Math.min(data.selectedIndex, Math.max(0, items.length - 1))

  return {
    ...data,
    items,
    selectedIndex,
  }
}

const getListParamsFromQueryKey = (queryKey: QueryKey): Partial<ListReelsParams> => {
  const params = queryKey[2]

  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {}
  }

  return params as Partial<ListReelsParams>
}

const shouldUpsertCreatedReelIntoList = (reel: Reel, params: Partial<ListReelsParams>) => {
  if (params.userId && params.userId !== reel.userId) {
    return false
  }

  if (params.visibility && params.visibility !== reel.visibility) {
    return false
  }

  return params.visibility === reel.visibility || reel.visibility === 'public'
}

const normalizeListParams = (params: Omit<ListReelsParams, 'cursor'> = {}) => ({
  ...(params.limit ? { limit: params.limit } : {}),
  ...(params.userId ? { userId: params.userId } : {}),
  ...(params.visibility ? { visibility: params.visibility } : {}),
})

const normalizeContextParams = (params: ReelContextParams = {}) => ({
  source: params.source ?? 'profile',
  before: params.before ?? Math.max(1, DEFAULT_REELS_LIMIT - 1),
  after: params.after ?? Math.max(1, DEFAULT_REELS_LIMIT - 1),
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

export function useReelContext(
  id?: string,
  params: ReelContextParams = {},
  options: { enabled?: boolean } = {},
) {
  const normalizedParams = normalizeContextParams(params)

  return useQuery({
    queryKey: queryKeys.reels.context(id || 'unknown', normalizedParams),
    queryFn: () => {
      if (!id) {
        throw new Error('Missing reel id')
      }

      return reelsApi.getContext(id, normalizedParams)
    },
    enabled: Boolean(id) && (options.enabled ?? true),
    staleTime: REELS_QUERY_STALE_TIME_MS,
  })
}

export function useReelProcessingStatus(reel?: Reel | null, options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const shouldPoll = (options.enabled ?? true) && isProcessingReel(reel)
  const query = useQuery({
    queryKey: queryKeys.reels.status(reel?.id || 'unknown'),
    queryFn: () => {
      if (!reel?.id) {
        throw new Error('Missing reel id')
      }

      return reelsApi.getStatus(reel.id)
    },
    enabled: Boolean(reel?.id) && shouldPoll,
    refetchInterval: shouldPoll ? REEL_STATUS_POLL_INTERVAL_MS : false,
    staleTime: 0,
  })

  useEffect(() => {
    if (!reel || !query.data) {
      return
    }

    const nextReel = mergeReelStatus(reel, query.data)

    queryClient.setQueryData<ReelDetail>(queryKeys.reels.detail(nextReel.id), (current) =>
      current ? mergeReelStatus(current, query.data) : (nextReel as ReelDetail),
    )
    queryClient.setQueriesData<ReelsInfiniteData>({ queryKey: queryKeys.reels.lists() }, (data) =>
      updateReelInInfiniteData(data, nextReel),
    )
    queryClient.setQueriesData<ReelContextData>({ queryKey: queryKeys.reels.contexts() }, (data) =>
      updateReelInContextData(data, nextReel),
    )

    if (isTerminalReelStatus(query.data.status)) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reels.lists(),
        refetchType: 'none',
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reels.contexts(),
        refetchType: 'none',
      })
    }
  }, [query.data, queryClient, reel])

  return query
}

export function useCreateReel() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<CreateReelStep>('idle')

  const mutation = useMutation({
    mutationFn: async ({
      fileUri,
      fileType,
      title,
      description,
      tags,
      visibility,
      localThumbnailUri,
    }: CreateReelVariables) => {
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
      const createdReel = await reelsApi.create({
        mediaKey: key,
        title,
        description,
        tags,
      })

      const visibleReel =
        createdReel.visibility === visibility
          ? createdReel
          : await reelsApi.update(createdReel.id, { visibility }).catch((error) => {
              const visibilityError = new Error('Reel was created, but visibility was not updated.')
              ;(visibilityError as Error & { reelCreated?: boolean; cause?: unknown }).reelCreated =
                true
              ;(visibilityError as Error & { reelCreated?: boolean; cause?: unknown }).cause = error
              throw visibilityError
            })

      return { ...visibleReel, localThumbnailUri }
    },
    onSuccess: (createdReel) => {
      queryClient.setQueryData(queryKeys.reels.detail(createdReel.id), createdReel)
      queryClient
        .getQueriesData<ReelsInfiniteData>({ queryKey: queryKeys.reels.lists() })
        .forEach(([queryKey, data]) => {
          if (!shouldUpsertCreatedReelIntoList(createdReel, getListParamsFromQueryKey(queryKey))) {
            return
          }

          queryClient.setQueryData(queryKey, upsertReelInInfiniteData(data, createdReel))
        })
      void queryClient.invalidateQueries({ queryKey: queryKeys.reels.lists() })
    },
    onSettled: () => {
      setStep('idle')
    },
  })

  return { ...mutation, step }
}

export function useUpdateReel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReelPayload }) =>
      reelsApi.update(id, data),
    onSuccess: (updatedReel) => {
      queryClient.setQueryData(queryKeys.reels.detail(updatedReel.id), updatedReel)
      queryClient.setQueriesData<ReelsInfiniteData>({ queryKey: queryKeys.reels.lists() }, (data) =>
        updateReelInInfiniteData(data, updatedReel),
      )
      queryClient.setQueriesData<ReelContextData>(
        { queryKey: queryKeys.reels.contexts() },
        (data) => updateReelInContextData(data, updatedReel),
      )
    },
  })
}

export function useDeleteReel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => reelsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.reels.detail(id) })
      queryClient.setQueriesData<ReelsInfiniteData>({ queryKey: queryKeys.reels.lists() }, (data) =>
        removeReelFromInfiniteData(data, id),
      )
      queryClient.setQueriesData<ReelContextData>(
        { queryKey: queryKeys.reels.contexts() },
        (data) => removeReelFromContextData(data, id),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.reels.lists() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.reels.contexts() })
    },
  })
}
