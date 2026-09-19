import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  cacheReelFeedPage,
  readCachedReelFeedPage,
  updateCachedReelIfPresent,
  updateCachedReelsSeriesIfPresent,
  updateCachedReelSeriesIfPresent,
} from '@/lib/reelOfflineCache'
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
import { RecommendedReelsSession } from '../lib/recommendedReels'
import {
  isReelIndexing,
  isReelMediaProcessing,
  mergeReelProcessingStatus,
  normalizeReelProcessingStatusResponse,
} from '../lib/reelProcessing'
import { useAuthStore } from '../stores/authStore'

import type { CacheableFeedParams } from '../database/reels/reelCacheMappers'
import type { Conversation, Message } from '../types/conversation.types'
import type {
  AddReelToSeriesPayload,
  AllowedVideoType,
  CreateReelSeriesPayload,
  CreateReelPayload,
  ListSeriesCandidateReelsParams,
  ListReelSeriesParams,
  ListReelsParams,
  ListReelsResponse,
  PaginatedSeriesCandidateReels,
  PaginatedReelSeries,
  PaginatedFriendsReels,
  RecommendedReelsPage,
  ReelContextParams,
  ReelContextResponse,
  Reel,
  ReelDetail,
  ReelFeedListItem,
  ReelSeries,
  ReelSeriesSummary,
  ReelProcessingStatusResponse,
  RecommendedReelsParams,
  ReorderReelSeriesPayload,
  ReelShareResponse,
  ReelVisibility,
  ShareReelPayload,
  UpdateReelPayload,
  UpdateReelSeriesPayload,
} from '../types/reel.types'

const REELS_QUERY_STALE_TIME_MS = 30 * 1000
const REEL_STATUS_POLL_INTERVAL_MS = 3000

type ReelsInfiniteData = InfiniteData<ListReelsResponse, string | undefined>
type ReelSeriesInfiniteData = InfiniteData<PaginatedReelSeries, string | undefined>
type ReelSeriesCandidatesInfiniteData = InfiniteData<
  PaginatedSeriesCandidateReels,
  string | undefined
>
type ReelContextData = ReelContextResponse

const flattenReelFeedPages = (pages: readonly { items: ReelFeedListItem[] }[]) => {
  const reelIds = new Set<string>()

  return pages.flatMap((page) =>
    page.items.filter((reel) => {
      if (reelIds.has(reel.id)) {
        return false
      }

      reelIds.add(reel.id)
      return true
    }),
  )
}

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
  clientObservedDurationMs: number
  edit: NonNullable<CreateReelPayload['edit']>
  localThumbnailUri?: string
}

type CreateReelStep = 'idle' | 'uploading' | 'creating'

const isTerminalReelStatus = (status: ReelProcessingStatusResponse) => {
  const normalized = normalizeReelProcessingStatusResponse(status)
  const mediaIsTerminal =
    normalized.mediaStatus === 'COMPLETED' || normalized.mediaStatus === 'FAILED'
  const indexIsTerminal =
    normalized.indexStatus === 'NOT_REQUESTED' ||
    normalized.indexStatus === 'COMPLETED' ||
    normalized.indexStatus === 'DEGRADED' ||
    normalized.indexStatus === 'FAILED'

  return mediaIsTerminal && indexIsTerminal
}

const isProcessingReel = (reel?: Reel | null) =>
  Boolean(reel && (isReelMediaProcessing(reel) || isReelIndexing(reel)))

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

const updateReelInViewerFeedCaches = (queryClient: QueryClient, viewerId: string, reel: Reel) => {
  queryClient.setQueriesData<ReelsInfiniteData>(
    {
      predicate: (query) =>
        query.queryKey[0] === 'reels' &&
        query.queryKey[1] === viewerId &&
        (query.queryKey[2] === 'list' ||
          query.queryKey[2] === 'recommended' ||
          query.queryKey[2] === 'friends'),
    },
    (data) => updateReelInInfiniteData(data, reel),
  )
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

const withReelSeries = (reel: Reel, series?: ReelSeriesSummary): Reel => {
  const nextReel = { ...reel }

  if (series) {
    nextReel.series = series
  } else {
    delete nextReel.series
  }

  return nextReel
}

const updateReelSeriesInInfiniteData = (
  data: ReelsInfiniteData | undefined,
  reelId: string,
  series?: ReelSeriesSummary,
): ReelsInfiniteData | undefined => {
  if (!data?.pages.length) {
    return data
  }

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === reelId ? withReelSeries(item, series) : item)),
    })),
  }
}

const updateReelSeriesInContextData = (
  data: ReelContextData | undefined,
  reelId: string,
  series?: ReelSeriesSummary,
): ReelContextData | undefined => {
  if (!data?.items.length) {
    return data
  }

  return {
    ...data,
    items: data.items.map((item) => (item.id === reelId ? withReelSeries(item, series) : item)),
  }
}

const updateReelSeriesMemoryCaches = (
  queryClient: QueryClient,
  viewerId: string,
  reelId: string,
  series?: ReelSeriesSummary,
) => {
  queryClient.setQueryData<ReelDetail>(queryKeys.reels.detail(viewerId, reelId), (current) =>
    current ? (withReelSeries(current, series) as ReelDetail) : current,
  )
  queryClient.setQueriesData<ReelsInfiniteData>(
    {
      predicate: (query) =>
        query.queryKey[0] === 'reels' &&
        query.queryKey[1] === viewerId &&
        (query.queryKey[2] === 'list' ||
          query.queryKey[2] === 'recommended' ||
          query.queryKey[2] === 'friends'),
    },
    (data) => updateReelSeriesInInfiniteData(data, reelId, series),
  )
  queryClient.setQueriesData<ReelContextData>(
    { queryKey: queryKeys.reels.contexts(viewerId) },
    (data) => updateReelSeriesInContextData(data, reelId, series),
  )
  queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(viewerId), (current) =>
    current?.map((item) => (item.id === reelId ? withReelSeries(item, series) : item)),
  )
}

const updateReelSeriesCaches = (
  queryClient: QueryClient,
  viewerId: string,
  reelId: string,
  series?: ReelSeriesSummary,
) => {
  updateReelSeriesMemoryCaches(queryClient, viewerId, reelId, series)
  void updateCachedReelSeriesIfPresent(reelId, series)
}

const reconcileReelSeries = (
  queryClient: QueryClient,
  viewerId: string,
  series: ReelSeries,
  setSeriesQuery = true,
) => {
  if (setSeriesQuery) {
    queryClient.setQueryData(queryKeys.reels.series(viewerId, series.id), series)
  }

  const offlineUpdates: { reelId: string; series?: ReelSeriesSummary | undefined }[] = []
  series.reels.forEach((reel) => {
    if (reel.series) {
      updateReelSeriesMemoryCaches(queryClient, viewerId, reel.id, reel.series)
      offlineUpdates.push({ reelId: reel.id, series: reel.series })
    }
  })

  if (offlineUpdates.length > 0) {
    void updateCachedReelsSeriesIfPresent(offlineUpdates)
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
  for (let index = queryKey.length - 1; index >= 0; index -= 1) {
    const params = queryKey[index]

    if (params && typeof params === 'object' && !Array.isArray(params)) {
      return params as Partial<ListReelsParams>
    }
  }

  return {}
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
  if (sourceReel?.sourceOrientation) {
    enrichedMedia.reelSourceOrientation = sourceReel.sourceOrientation
    enrichedMedia.sourceOrientation = sourceReel.sourceOrientation
  }
  if (
    typeof sourceReel?.sourceAspectRatio === 'number' &&
    Number.isFinite(sourceReel.sourceAspectRatio)
  ) {
    enrichedMedia.reelSourceAspectRatio = sourceReel.sourceAspectRatio
    enrichedMedia.sourceAspectRatio = sourceReel.sourceAspectRatio
  }
  if (sourceReel?.playbackPresentation) {
    enrichedMedia.reelPlaybackPresentation = sourceReel.playbackPresentation
    enrichedMedia.playbackPresentation = sourceReel.playbackPresentation
  }
  const resolvedWidth =
    typeof sourceReel?.sourceEffectiveWidth === 'number' &&
    Number.isFinite(sourceReel.sourceEffectiveWidth)
      ? sourceReel.sourceEffectiveWidth
      : typeof sourceReel?.sourceWidth === 'number' && Number.isFinite(sourceReel.sourceWidth)
        ? sourceReel.sourceWidth
        : undefined
  const resolvedHeight =
    typeof sourceReel?.sourceEffectiveHeight === 'number' &&
    Number.isFinite(sourceReel.sourceEffectiveHeight)
      ? sourceReel.sourceEffectiveHeight
      : typeof sourceReel?.sourceHeight === 'number' && Number.isFinite(sourceReel.sourceHeight)
        ? sourceReel.sourceHeight
        : undefined
  if (typeof resolvedWidth === 'number') enrichedMedia.width = resolvedWidth
  if (typeof resolvedHeight === 'number') enrichedMedia.height = resolvedHeight

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

const normalizeRecommendedParams = (
  params: Pick<RecommendedReelsParams, 'excludeRecentlySeen' | 'limit'> = {},
) => ({
  limit: Number.isFinite(params.limit)
    ? Math.max(1, Math.floor(params.limit ?? DEFAULT_REELS_LIMIT))
    : DEFAULT_REELS_LIMIT,
  excludeRecentlySeen: params.excludeRecentlySeen ?? true,
})

const normalizeContextParams = (params: ReelContextParams = {}) => ({
  source: params.source ?? 'profile',
  before: params.before ?? Math.max(1, DEFAULT_REELS_LIMIT - 1),
  after: params.after ?? Math.max(1, DEFAULT_REELS_LIMIT - 1),
})

const createInfiniteReelsFeedQueryOptions = ({
  cacheParams,
  enabled,
  fetchPage,
  pendingCreatedKey,
  queryClient,
  queryKey,
}: {
  cacheParams: CacheableFeedParams
  enabled: boolean
  fetchPage: (cursor?: string) => Promise<ListReelsResponse>
  pendingCreatedKey: QueryKey
  queryClient: QueryClient
  queryKey: QueryKey
}) => ({
  queryKey,
  enabled,
  initialPageParam: undefined as string | undefined,
  queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
    try {
      const response = await fetchPage(pageParam)

      const mergedResponse = mergePendingCreatedReelsIntoResponse(
        response,
        queryClient.getQueryData<Reel[]>(pendingCreatedKey),
        cacheParams,
        !pageParam,
      )

      void cacheReelFeedPage(cacheParams, pageParam, mergedResponse)

      return mergedResponse
    } catch (error) {
      const cachedResponse = await readCachedReelFeedPage(cacheParams, pageParam)

      if (cachedResponse) {
        return mergePendingCreatedReelsIntoResponse(
          cachedResponse,
          queryClient.getQueryData<Reel[]>(pendingCreatedKey),
          cacheParams,
          !pageParam,
        )
      }

      throw error
    }
  },
  getNextPageParam: (lastPage: ListReelsResponse) => lastPage.nextCursor ?? undefined,
  staleTime: REELS_QUERY_STALE_TIME_MS,
  retry: 1,
})

export function useReelsFeed(
  params: Omit<ListReelsParams, 'cursor'> = {},
  options: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')
  const normalizedParams =
    Object.keys(params).length > 0 ? normalizeListParams(params) : { limit: DEFAULT_REELS_LIMIT }

  return useInfiniteQuery(
    createInfiniteReelsFeedQueryOptions({
      queryClient,
      queryKey: queryKeys.reels.list(viewerId, normalizedParams),
      pendingCreatedKey: queryKeys.reels.pendingCreated(viewerId),
      cacheParams: { ...normalizedParams, viewerId },
      enabled: options.enabled ?? true,
      fetchPage: (pageParam) =>
        reelsApi.list({
          ...normalizedParams,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
    }),
  )
}

export function useRecommendedReelsFeed(params: { enabled?: boolean; limit?: number } = {}) {
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.user?.id)
  const viewerId = userId ?? 'anonymous'
  const recommendationSessionRef = useRef(new RecommendedReelsSession())
  const previousUserIdRef = useRef(userId)
  const normalizedParams = normalizeRecommendedParams(
    typeof params.limit === 'number' ? { limit: params.limit } : {},
  )
  const recommendedLimit = normalizedParams.limit
  const excludeRecentlySeen = normalizedParams.excludeRecentlySeen
  const isRecommendedFeedEnabled = params.enabled ?? true
  const queryKey = queryKeys.reels.recommended(viewerId, excludeRecentlySeen)
  const cacheParams: CacheableFeedParams = useMemo(
    () => ({
      limit: recommendedLimit,
      excludeRecentlySeen,
      viewerId,
      recommended: true,
      visibility: 'public',
    }),
    [excludeRecentlySeen, recommendedLimit, viewerId],
  )
  const recommendedQueryOptions = useMemo(
    () => ({
      queryKey,
      enabled: isRecommendedFeedEnabled,
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
        const session = recommendationSessionRef.current

        if (!pageParam) {
          session.reset()
        }

        try {
          const response = await reelsApi.getRecommendedReels(
            session.getRequestParams({
              limit: recommendedLimit,
              excludeRecentlySeen,
              ...(pageParam ? { cursor: pageParam } : {}),
            }),
          )

          if (!pageParam && excludeRecentlySeen && response.items.length === 0) {
            const fallbackResponse = await reelsApi.getRecommendedReels({
              excludeRecentlySeen: false,
              limit: recommendedLimit,
            })
            session.capture(fallbackResponse)
            void cacheReelFeedPage(
              { ...cacheParams, excludeRecentlySeen: false },
              pageParam,
              fallbackResponse,
            )
            return fallbackResponse
          }

          session.capture(response)
          void cacheReelFeedPage(cacheParams, pageParam, response)
          return response
        } catch (error) {
          const cachedResponse = await readCachedReelFeedPage(cacheParams, pageParam)

          if (cachedResponse) {
            return {
              ...cachedResponse,
              feedSessionId: cachedResponse.feedSessionId ?? session.getFeedSessionId() ?? '',
              algorithmVersion: cachedResponse.algorithmVersion ?? '',
              generatedAt: cachedResponse.generatedAt ?? new Date().toISOString(),
              nextCursor: cachedResponse.nextCursor ?? null,
            } as RecommendedReelsPage
          }

          throw error
        }
      },
      getNextPageParam: (lastPage: RecommendedReelsPage) => lastPage.nextCursor ?? undefined,
      retry: (failureCount: number, error: unknown) => {
        const status = isAxiosError(error) ? error.response?.status : undefined
        return !(status && status >= 400 && status < 500) && failureCount < 2
      },
      staleTime: REELS_QUERY_STALE_TIME_MS,
    }),
    [cacheParams, excludeRecentlySeen, isRecommendedFeedEnabled, queryKey, recommendedLimit],
  )

  const query = useInfiniteQuery(recommendedQueryOptions)
  const hasActiveAccountSession = previousUserIdRef.current === userId

  useEffect(() => {
    if (previousUserIdRef.current === userId) {
      return
    }

    previousUserIdRef.current = userId
    recommendationSessionRef.current.reset()
    queryClient.removeQueries({ queryKey, exact: true })
  }, [queryClient, queryKey, userId])

  const refreshWithNewSession = useCallback(async () => {
    recommendationSessionRef.current.reset()
    queryClient.removeQueries({ queryKey, exact: true })
    return queryClient.fetchInfiniteQuery(recommendedQueryOptions)
  }, [queryClient, queryKey, recommendedQueryOptions])

  return {
    ...query,
    data: hasActiveAccountSession ? query.data : undefined,
    feedSessionId:
      (hasActiveAccountSession
        ? (recommendationSessionRef.current.getFeedSessionId() ??
          query.data?.pages[0]?.feedSessionId)
        : null) ?? null,
    algorithmVersion: hasActiveAccountSession
      ? query.data?.pages.find((page) => page.algorithmVersion)?.algorithmVersion
      : undefined,
    refreshWithNewSession,
  }
}

export function useFriendsReelsFeed(params: { enabled?: boolean; limit?: number } = {}) {
  const viewerId = useAuthStore((state) => state.user?.id ?? '')
  const limit = Number.isFinite(params.limit)
    ? Math.max(1, Math.floor(params.limit ?? DEFAULT_REELS_LIMIT))
    : DEFAULT_REELS_LIMIT
  const enabled = Boolean(viewerId) && (params.enabled ?? true)
  const query = useInfiniteQuery({
    queryKey: queryKeys.reels.friends(viewerId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      reelsApi.getFriendsReels({
        limit,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PaginatedFriendsReels) => lastPage.nextCursor ?? undefined,
    staleTime: REELS_QUERY_STALE_TIME_MS,
    retry: 1,
  })

  return {
    ...query,
    reels: flattenReelFeedPages(query.data?.pages ?? []),
  }
}

export function useReelDetail(id?: string, options: { enabled?: boolean } = {}) {
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')

  return useQuery({
    queryKey: queryKeys.reels.detail(viewerId, id || 'unknown'),
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
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')
  const normalizedParams = normalizeContextParams(params)

  return useQuery({
    queryKey: queryKeys.reels.context(viewerId, id || 'unknown', normalizedParams),
    queryFn: async () => {
      if (!id) {
        throw new Error('Missing reel id')
      }

      const context = await reelsApi.getContext(id, normalizedParams)
      return mergePendingCreatedReelsIntoContext(
        context,
        queryClient.getQueryData<Reel[]>(queryKeys.reels.pendingCreated(viewerId)),
      )
    },
    enabled: Boolean(id) && (options.enabled ?? true),
    staleTime: REELS_QUERY_STALE_TIME_MS,
  })
}

const refreshOwnedReelSeriesLists = (queryClient: QueryClient, viewerId: string) => {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.reels.seriesLists(viewerId),
  })
}

const refreshSeriesCandidates = (queryClient: QueryClient, viewerId: string, seriesId?: string) => {
  void queryClient.invalidateQueries({
    queryKey: seriesId
      ? queryKeys.reels.seriesCandidates(viewerId, seriesId)
      : queryKeys.reels.allSeriesCandidates(viewerId),
  })
}

export function useOwnedReelSeries(
  params: ListReelSeriesParams = {},
  options: { enabled?: boolean } = {},
) {
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')
  const queryParams = useMemo(
    () => ({
      ...(params.visibility ? { visibility: params.visibility } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    }),
    [params.limit, params.visibility],
  )

  return useInfiniteQuery<
    PaginatedReelSeries,
    Error,
    ReelSeriesInfiniteData,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.reels.seriesList(viewerId, queryParams),
    queryFn: ({ pageParam }) =>
      reelsApi.listOwnedSeries({
        ...queryParams,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: params.cursor,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(viewerId !== 'anonymous') && (options.enabled ?? true),
    staleTime: REELS_QUERY_STALE_TIME_MS,
  })
}

export function useReelSeriesCandidates(
  seriesId?: string,
  params: ListSeriesCandidateReelsParams = {},
  options: { enabled?: boolean } = {},
) {
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')
  const queryParams = useMemo(
    () => ({
      ...(params.limit ? { limit: params.limit } : {}),
    }),
    [params.limit],
  )

  return useInfiniteQuery<
    PaginatedSeriesCandidateReels,
    Error,
    ReelSeriesCandidatesInfiniteData,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.reels.seriesCandidateList(viewerId, seriesId || 'unknown', queryParams),
    queryFn: ({ pageParam }) => {
      if (!seriesId) {
        throw new Error('Missing reel series id')
      }

      return reelsApi.getSeriesCandidateReels(seriesId, {
        ...queryParams,
        ...(pageParam ? { cursor: pageParam } : {}),
      })
    },
    initialPageParam: params.cursor,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(seriesId && viewerId !== 'anonymous') && (options.enabled ?? true),
    staleTime: REELS_QUERY_STALE_TIME_MS,
  })
}

export function useReelSeries(id?: string, options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')
  const query = useQuery({
    queryKey: queryKeys.reels.series(viewerId, id || 'unknown'),
    queryFn: () => {
      if (!id) {
        throw new Error('Missing reel series id')
      }

      return reelsApi.getSeries(id)
    },
    enabled: Boolean(id) && (options.enabled ?? true),
    staleTime: REELS_QUERY_STALE_TIME_MS,
  })

  useEffect(() => {
    if (query.data) {
      reconcileReelSeries(queryClient, viewerId, query.data, false)
    }
  }, [query.data, queryClient, viewerId])

  return query
}

export function useCreateReelSeries() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')

  return useMutation({
    mutationFn: (data: CreateReelSeriesPayload) => reelsApi.createSeries(data),
    onSuccess: (series) => {
      reconcileReelSeries(queryClient, viewerId, series)
      refreshOwnedReelSeriesLists(queryClient, viewerId)
    },
  })
}

export function useUpdateReelSeries() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReelSeriesPayload }) =>
      reelsApi.updateSeries(id, data),
    onSuccess: (series) => {
      reconcileReelSeries(queryClient, viewerId, series)
      refreshOwnedReelSeriesLists(queryClient, viewerId)
      refreshSeriesCandidates(queryClient, viewerId, series.id)
    },
  })
}

export function useDeleteReelSeries() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')

  return useMutation({
    mutationFn: async (id: string) => {
      const series =
        queryClient.getQueryData<ReelSeries>(queryKeys.reels.series(viewerId, id)) ??
        (await reelsApi.getSeries(id))
      await reelsApi.deleteSeries(id)
      return { id, series }
    },
    onSuccess: ({ id, series }) => {
      const offlineUpdates: { reelId: string; series?: ReelSeriesSummary | undefined }[] = []
      series?.reels?.forEach((reel) => {
        updateReelSeriesMemoryCaches(queryClient, viewerId, reel.id)
        offlineUpdates.push({ reelId: reel.id })
      })
      if (offlineUpdates.length > 0) {
        void updateCachedReelsSeriesIfPresent(offlineUpdates)
      }
      queryClient.setQueryData(queryKeys.reels.series(viewerId, id), null)
      queryClient.removeQueries({ queryKey: queryKeys.reels.series(viewerId, id) })
      refreshOwnedReelSeriesLists(queryClient, viewerId)
      refreshSeriesCandidates(queryClient, viewerId, id)
    },
  })
}

export function useAddReelToSeries() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')

  return useMutation({
    mutationFn: ({ seriesId, data }: { seriesId: string; data: AddReelToSeriesPayload }) =>
      reelsApi.addReelToSeries(seriesId, data),
    onSuccess: (series, { seriesId }) => {
      reconcileReelSeries(queryClient, viewerId, series)
      refreshOwnedReelSeriesLists(queryClient, viewerId)
      refreshSeriesCandidates(queryClient, viewerId, seriesId)
    },
  })
}

export function useRemoveReelFromSeries() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')

  return useMutation({
    mutationFn: ({ seriesId, reelId }: { seriesId: string; reelId: string }) =>
      reelsApi.removeReelFromSeries(seriesId, reelId),
    onSuccess: (series, { seriesId, reelId }) => {
      reconcileReelSeries(queryClient, viewerId, series)
      updateReelSeriesCaches(queryClient, viewerId, reelId)
      refreshOwnedReelSeriesLists(queryClient, viewerId)
      refreshSeriesCandidates(queryClient, viewerId, seriesId)
    },
  })
}

export function useReorderReelSeries() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')

  return useMutation({
    mutationFn: ({ seriesId, data }: { seriesId: string; data: ReorderReelSeriesPayload }) =>
      reelsApi.reorderSeries(seriesId, data),
    onSuccess: (series) => {
      reconcileReelSeries(queryClient, viewerId, series)
      refreshOwnedReelSeriesLists(queryClient, viewerId)
    },
  })
}

export function useReelProcessingStatus(reel?: Reel | null, options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')
  const shouldPoll = (options.enabled ?? true) && isProcessingReel(reel)
  const query = useQuery({
    queryKey: queryKeys.reels.status(viewerId, reel?.id || 'unknown'),
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

    const nextReel = mergeReelProcessingStatus(reel, query.data)

    queryClient.setQueryData<ReelDetail>(
      queryKeys.reels.detail(viewerId, nextReel.id),
      (current) =>
        current ? mergeReelProcessingStatus(current, query.data) : (nextReel as ReelDetail),
    )
    updateReelInViewerFeedCaches(queryClient, viewerId, nextReel)
    queryClient.setQueriesData<ReelContextData>(
      { queryKey: queryKeys.reels.contexts(viewerId) },
      (data) => updateReelInContextData(data, nextReel),
    )
    queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(viewerId), (current) =>
      mergePendingCreatedReels(current, nextReel),
    )

    void updateCachedReelIfPresent(nextReel)

    if (isTerminalReelStatus(query.data)) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reels.lists(viewerId),
        refetchType: 'none',
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reels.contexts(viewerId),
        refetchType: 'none',
      })
      queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(viewerId), (current) =>
        current?.filter((item) => item.id !== nextReel.id),
      )
    }
  }, [query.data, queryClient, reel, viewerId])

  return query
}

export function useCreateReel() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')
  const [step, setStep] = useState<CreateReelStep>('idle')

  const mutation = useMutation({
    mutationFn: async ({
      fileUri,
      fileType,
      title,
      description,
      tags,
      visibility,
      clientObservedDurationMs,
      edit,
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
        visibility,
        clientObservedDurationMs,
        edit,
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
      queryClient.setQueryData(queryKeys.reels.detail(viewerId, createdReel.id), createdReel)
      queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(viewerId), (current) =>
        mergePendingCreatedReels(current, createdReel),
      )
      queryClient
        .getQueriesData<ReelsInfiniteData>({ queryKey: queryKeys.reels.lists(viewerId) })
        .forEach(([queryKey, data]) => {
          if (!shouldUpsertCreatedReelIntoList(createdReel, getListParamsFromQueryKey(queryKey))) {
            return
          }

          queryClient.setQueryData(queryKey, upsertReelInInfiniteData(data, createdReel))
        })
      void queryClient.invalidateQueries({ queryKey: queryKeys.reels.lists(viewerId) })
    },
    onSettled: () => {
      setStep('idle')
    },
  })

  return { ...mutation, step }
}

export function useUpdateReel() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReelPayload }) =>
      reelsApi.update(id, data),
    onSuccess: (updatedReel) => {
      queryClient.setQueryData<ReelDetail>(
        queryKeys.reels.detail(viewerId, updatedReel.id),
        (current) => (current ? { ...current, ...updatedReel } : updatedReel),
      )
      updateReelInViewerFeedCaches(queryClient, viewerId, updatedReel)
      queryClient.setQueriesData<ReelContextData>(
        { queryKey: queryKeys.reels.contexts(viewerId) },
        (data) => updateReelInContextData(data, updatedReel),
      )
    },
  })
}

export function useReprocessReel() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')

  return useMutation({
    mutationFn: (id: string) => reelsApi.reprocess(id),
    onSuccess: (reprocessedReel) => {
      queryClient.setQueryData<ReelDetail>(
        queryKeys.reels.detail(viewerId, reprocessedReel.id),
        (current) => (current ? { ...current, ...reprocessedReel } : reprocessedReel),
      )

      updateReelInViewerFeedCaches(queryClient, viewerId, reprocessedReel)

      queryClient.setQueriesData<ReelContextData>(
        { queryKey: queryKeys.reels.contexts(viewerId) },
        (data) => updateReelInContextData(data, reprocessedReel),
      )

      queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(viewerId), (current) =>
        mergePendingCreatedReels(current, reprocessedReel),
      )

      void queryClient.invalidateQueries({
        queryKey: queryKeys.reels.status(viewerId, reprocessedReel.id),
      })

      void queryClient.invalidateQueries({
        queryKey: queryKeys.reels.lists(viewerId),
        refetchType: 'none',
      })

      void queryClient.invalidateQueries({
        queryKey: queryKeys.reels.contexts(viewerId),
        refetchType: 'none',
      })
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
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')

  return useMutation({
    mutationFn: (id: string) => reelsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.reels.detail(viewerId, id) })
      queryClient.setQueryData<Reel[]>(queryKeys.reels.pendingCreated(viewerId), (current) =>
        current?.filter((item) => item.id !== id),
      )
      queryClient.setQueriesData<ReelsInfiniteData>(
        {
          predicate: (query) =>
            query.queryKey[0] === 'reels' &&
            query.queryKey[1] === viewerId &&
            (query.queryKey[2] === 'list' ||
              query.queryKey[2] === 'recommended' ||
              query.queryKey[2] === 'friends'),
        },
        (data) => removeReelFromInfiniteData(data, id),
      )
      queryClient.setQueriesData<ReelContextData>(
        { queryKey: queryKeys.reels.contexts(viewerId) },
        (data) => removeReelFromContextData(data, id),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.reels.lists(viewerId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.reels.contexts(viewerId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.reels.seriesLists(viewerId) })
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'reels' &&
          query.queryKey[1] === viewerId &&
          query.queryKey[2] === 'series',
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reels.allSeriesCandidates(viewerId),
      })
    },
  })
}
