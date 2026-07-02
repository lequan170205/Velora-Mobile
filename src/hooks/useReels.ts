import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { cacheReelFeedPage, readCachedReelFeedPage } from '@/lib/reelOfflineCache'
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { mediaApi } from '../api/media.api'
import { reelsApi } from '../api/reels.api'
import { queryKeys } from '../constants/queryKeys'
import { DEFAULT_REELS_LIMIT } from '../constants/reels'
import { upsertRemoteMessage } from '../database/messageSync'
import {
  upsertConversationSummaryInCache,
  upsertMessageIntoConversationCache,
} from '../lib/chatMessageCache'
import { useAuthStore } from '../stores/authStore'

import type { Conversation, Message } from '../types/conversation.types'
import type {
  AllowedVideoType,
  ListReelsParams,
  ListReelsResponse,
  ReelContextParams,
  ReelContextResponse,
  Reel,
  ReelDetail,
  ReelProcessingStatusResponse,
  ReelShareResponse,
  ReelVisibility,
  ShareReelPayload,
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

const mergePendingCreatedReels = (current: Reel[] | undefined, reel: Reel) => {
  const pendingReels = current ?? []
  const existingIndex = pendingReels.findIndex((item) => item.id === reel.id)

  if (existingIndex === -1) {
    return [reel, ...pendingReels]
  }

  return pendingReels.map((item) => (item.id === reel.id ? { ...item, ...reel } : item))
}

const mergePendingCreatedReelsIntoResponse = (
  response: ListReelsResponse,
  pendingReels: Reel[] | undefined,
  params: Partial<ListReelsParams>,
  shouldPrepend: boolean,
) => {
  if (!shouldPrepend || !pendingReels?.length) {
    return response
  }

  const matchingPendingReels = pendingReels.filter((reel) =>
    shouldUpsertCreatedReelIntoList(reel, params),
  )

  if (matchingPendingReels.length === 0) {
    return response
  }

  const pendingById = new Map(matchingPendingReels.map((reel) => [reel.id, reel]))
  const serverItems = response.items.map((item) => {
    const pendingReel = pendingById.get(item.id)

    if (!pendingReel) {
      return item
    }

    pendingById.delete(item.id)
    return { ...pendingReel, ...item }
  })

  return {
    ...response,
    items: [...pendingById.values(), ...serverItems],
  }
}

const mergePendingCreatedReelsIntoContext = (
  context: ReelContextResponse,
  pendingReels: Reel[] | undefined,
) => {
  if (!pendingReels?.length) {
    return context
  }

  const pendingById = new Map(pendingReels.map((reel) => [reel.id, reel]))
  const items = context.items.map((item) => {
    const pendingReel = pendingById.get(item.id)
    return pendingReel ? { ...pendingReel, ...item } : item
  })
  const selectedPendingReel = pendingById.get(context.selectedId)

  if (selectedPendingReel && !items.some((item) => item.id === selectedPendingReel.id)) {
    items.splice(Math.min(context.selectedIndex, items.length), 0, selectedPendingReel)
  }

  return { ...context, items }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type ShareReelMutationVariables = {
  data: ShareReelPayload
  id: string
  reel?: Reel
}

const toSharedReelMessage = (
  share: ReelShareResponse,
  currentUser: ReturnType<typeof useAuthStore.getState>['user'] | null,
  sourceReel?: Reel,
): Message | null => {
  if (!share.message) {
    return null
  }

  const createdAt = share.message.createdAt || share.createdAt
  const media: NonNullable<Message['media']> = isRecord(share.message.media)
    ? (share.message.media as NonNullable<Message['media']>)
    : {}
  const sourceAuthorUsername = sourceReel?.author?.username?.trim() || undefined
  const sourceAuthorAvatarUrl = sourceReel?.author?.avatarUrl?.trim() || undefined
  const enrichedMedia: NonNullable<Message['media']> = { ...media }
  const reelId = media.reelId ?? sourceReel?.id ?? share.reelId
  const reelOwnerId = media.reelOwnerId ?? sourceReel?.userId ?? share.ownerId
  const reelOwnerUsername = media.reelOwnerUsername ?? sourceAuthorUsername
  const reelOwnerAvatarUrl = media.reelOwnerAvatarUrl ?? sourceAuthorAvatarUrl
  const reelTitle = media.reelTitle ?? sourceReel?.title
  const reelDescription = media.reelDescription ?? sourceReel?.description
  const thumbnailUrl = media.thumbnailUrl ?? sourceReel?.thumbnailUrl
  const fileUrl = media.fileUrl ?? sourceReel?.streamUrl

  enrichedMedia.reelId = reelId
  enrichedMedia.reelOwnerId = reelOwnerId
  if (reelOwnerUsername) enrichedMedia.reelOwnerUsername = reelOwnerUsername
  if (reelOwnerAvatarUrl) enrichedMedia.reelOwnerAvatarUrl = reelOwnerAvatarUrl
  if (reelTitle) enrichedMedia.reelTitle = reelTitle
  if (reelDescription) enrichedMedia.reelDescription = reelDescription
  if (thumbnailUrl) enrichedMedia.thumbnailUrl = thumbnailUrl
  if (fileUrl) enrichedMedia.fileUrl = fileUrl

  return {
    id: share.message.id,
    conversationId: share.message.conversationId,
    senderId: share.message.senderId,
    sender: {
      id: share.message.senderId,
      email: currentUser?.email ?? '',
      ...(currentUser?.picture ? { picture: currentUser.picture } : {}),
    },
    content: share.message.content,
    media: enrichedMedia,
    type: share.message.type === 'reel' ? 'reel' : 'text',
    status: 'SENT',
    createdAt,
    updatedAt: createdAt,
  }
}

const findCachedConversation = (queryClient: QueryClient, conversationId: string) => {
  const cachedData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)

  const conversations = Array.isArray(cachedData)
    ? cachedData
    : (cachedData as { pages?: unknown[] })?.pages?.flat() || []

  return (
    conversations.find((conversation): conversation is Conversation =>
      Boolean(
        conversation &&
        typeof conversation === 'object' &&
        'id' in conversation &&
        conversation.id === conversationId,
      ),
    ) ?? null
  )
}

const toShareMessagePayload = (message: Message): NonNullable<ReelShareResponse['message']> => ({
  id: message.id,
  conversationId: message.conversationId,
  senderId: message.senderId,
  content: message.content,
  type: message.type,
  media: message.media,
  createdAt: message.createdAt,
})

const normalizeListParams = (params: Omit<ListReelsParams, 'cursor'> = {}) => ({
  ...(params.limit ? { limit: params.limit } : {}),
  ...(params.userId ? { userId: params.userId } : {}),
  ...(params.visibility ? { visibility: params.visibility } : {}),
  ...(params.ranked !== undefined ? { ranked: params.ranked } : {}),
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
  const queryClient = useQueryClient()
  const normalizedParams =
    Object.keys(params).length > 0 ? normalizeListParams(params) : { limit: DEFAULT_REELS_LIMIT }

  return useInfiniteQuery({
    queryKey: queryKeys.reels.list(normalizedParams),
    enabled: options.enabled ?? true,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      try {
        const response = await reelsApi.list({
          ...normalizedParams,
          ...(pageParam ? { cursor: pageParam } : {}),
        })

        const mergedResponse = mergePendingCreatedReelsIntoResponse(
          response,
          queryClient.getQueryData<Reel[]>(queryKeys.reels.pendingCreated()),
          normalizedParams,
          !pageParam,
        )

        void cacheReelFeedPage(normalizedParams, pageParam, mergedResponse)

        return mergedResponse
      } catch (error) {
        const cachedResponse = await readCachedReelFeedPage(normalizedParams, pageParam)

        if (cachedResponse) {
          return mergePendingCreatedReelsIntoResponse(
            cachedResponse,
            queryClient.getQueryData<Reel[]>(queryKeys.reels.pendingCreated()),
            normalizedParams,
            !pageParam,
          )
        }

        throw error
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: REELS_QUERY_STALE_TIME_MS,
    retry: 1,
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
  const queryClient = useQueryClient()
  const normalizedParams = normalizeContextParams(params)

  return useQuery({
    queryKey: queryKeys.reels.context(id || 'unknown', normalizedParams),
    queryFn: async () => {
      if (!id) {
        throw new Error('Missing reel id')
      }

      const context = await reelsApi.getContext(id, normalizedParams)
      return mergePendingCreatedReelsIntoContext(
        context,
        queryClient.getQueryData<Reel[]>(queryKeys.reels.pendingCreated()),
      )
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
    queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(), (current) =>
      mergePendingCreatedReels(current, nextReel),
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
      queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(), (current) =>
        current?.filter((item) => item.id !== nextReel.id),
      )
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

      return {
        ...visibleReel,
        ...(localThumbnailUri ? { localThumbnailUri } : {}),
      }
    },
    onSuccess: (createdReel) => {
      queryClient.setQueryData(queryKeys.reels.detail(createdReel.id), createdReel)
      queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(), (current) =>
        mergePendingCreatedReels(current, createdReel),
      )
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

export function useShareReel() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)

  return useMutation({
    mutationFn: async ({ id, data }: ShareReelMutationVariables) => {
      const share = await reelsApi.share(id, data)

      if (share.message) {
        return share
      }

      if (!share.messageId) {
        throw new Error('Reel share completed, but no chat message was returned.')
      }

      const window = await conversationApi.getMessagesAround(
        share.conversationId,
        share.messageId,
        {
          before: 1,
          after: 1,
        },
      )
      const message = window?.messages.find(
        (candidate) => candidate.id === share.messageId || candidate._id === share.messageId,
      )

      if (!message) {
        throw new Error('Reel share completed, but the chat message was not returned.')
      }

      return {
        ...share,
        message: toShareMessagePayload(message),
      }
    },
    onSuccess: async (share, variables) => {
      const message = toSharedReelMessage(share, currentUser ?? null, variables.reel)

      if (message) {
        upsertMessageIntoConversationCache(queryClient, message)
        upsertConversationSummaryInCache(queryClient, {
          id: message.conversationId,
          lastMessage: message.content,
          lastMessageAt: message.createdAt,
          updatedAt: message.updatedAt,
        })
        await upsertRemoteMessage({
          conversation: findCachedConversation(queryClient, message.conversationId),
          currentUser: currentUser ?? null,
          message,
        })
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(share.conversationId),
      })
    },
  })
}

export function useCreateReelShareLink() {
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      reelsApi.createShareLink(id, {
        reuseExisting: true,
      }),
  })
}

export function useDeleteReel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => reelsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.reels.detail(id) })
      queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(), (current) =>
        current?.filter((item) => item.id !== id),
      )
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
