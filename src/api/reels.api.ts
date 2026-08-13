import { isAxiosError } from 'axios'

import { parseRecommendedReelsResponse } from '../lib/recommendationFeed'
import {
  normalizeReelApiResponse,
  normalizeReelProcessingStatusResponse,
} from '../lib/reelProcessing'

import { apiClient } from './client'

import type {
  CreateReelPayload,
  ReelContextParams,
  ReelContextResponse,
  CreateReelShareLinkPayload,
  ListReelsParams,
  ListReelsResponse,
  PaginatedFriendsReels,
  RecommendedReelsPage,
  ReelDetail,
  ReelProcessingStatusResponse,
  RecommendedReelsParams,
  ReelShareLinkResponse,
  ReelShareResponse,
  ShareReelPayload,
  TrackReelEventsPayload,
  TrackReelEventsResponse,
  UpdateReelPayload,
} from '../types/reel.types'

export async function getRecommendedReels(
  params: RecommendedReelsParams = {},
): Promise<RecommendedReelsPage> {
  const response = await apiClient.get<RecommendedReelsPage>('/content/reels/recommended', {
    params: {
      limit: params.limit,
      cursor: params.cursor,
      excludeRecentlySeen: params.excludeRecentlySeen,
      ...(params.feedSessionId ? { feedSessionId: params.feedSessionId } : {}),
    },
  })
  return parseRecommendedReelsResponse({
    ...response.data,
    items: response.data.items.map(normalizeReelApiResponse),
  })
}

export async function getFriendsReels(
  params: { limit?: number; cursor?: string } = {},
): Promise<PaginatedFriendsReels> {
  try {
    const response = await apiClient.get<PaginatedFriendsReels>('/content/reels/friends', {
      params,
    })
    return {
      ...response.data,
      items: response.data.items.map(normalizeReelApiResponse),
    }
  } catch (error) {
    const message = isAxiosError(error) ? error.response?.data?.message : null
    const isRouteMiss =
      isAxiosError(error) &&
      error.response?.status === 404 &&
      typeof message === 'string' &&
      message.trim().toLowerCase() === 'reel not found'

    if (isRouteMiss) {
      return { items: [], nextCursor: null }
    }

    throw error
  }
}

const hydrateMissingReelAuthor = async (reel: ReelDetail): Promise<ReelDetail> => {
  const normalizedReel = normalizeReelApiResponse(reel)
  const hasAuthorIdentity = Boolean(
    normalizedReel.author?.username?.trim() || normalizedReel.author?.displayName?.trim(),
  )
  const hasAuthorAvatar = Boolean(normalizedReel.author?.avatarUrl?.trim())

  if (hasAuthorIdentity && hasAuthorAvatar) {
    return normalizedReel
  }

  try {
    const response = await apiClient.get<ReelContextResponse>(
      `/content/reels/${normalizedReel.id}/context`,
      {
        params: {
          source: 'profile',
          before: 1,
          after: 1,
        },
      },
    )
    const contextReel = response.data.items
      .map(normalizeReelApiResponse)
      .find((item) => item.id === normalizedReel.id)

    if (!contextReel?.author) {
      return normalizedReel
    }

    const detailAuthor = normalizedReel.author
    const contextAuthor = contextReel.author

    return {
      ...contextReel,
      ...normalizedReel,
      author: {
        id: detailAuthor?.id ?? contextAuthor.id,
        username: detailAuthor?.username ?? contextAuthor.username,
        displayName: detailAuthor?.displayName ?? contextAuthor.displayName,
        avatarUrl: detailAuthor?.avatarUrl ?? contextAuthor.avatarUrl,
        isVerified: detailAuthor?.isVerified ?? contextAuthor.isVerified,
      },
    }
  } catch {
    return normalizedReel
  }
}

export const reelsApi = {
  list: async (params: ListReelsParams = {}) => {
    const response = await apiClient.get<ListReelsResponse>('/content/reels', { params })
    return {
      ...response.data,
      items: response.data.items.map(normalizeReelApiResponse),
    }
  },
  getRecommendedReels,
  getFriendsReels,
  getById: async (id: string) => {
    const response = await apiClient.get<ReelDetail>(`/content/reels/${id}`)
    return hydrateMissingReelAuthor(response.data)
  },
  getContext: async (id: string, params: ReelContextParams = {}) => {
    const response = await apiClient.get<ReelContextResponse>(`/content/reels/${id}/context`, {
      params,
    })
    return {
      ...response.data,
      items: response.data.items.map(normalizeReelApiResponse),
    }
  },
  getStatus: async (id: string) => {
    const response = await apiClient.get<ReelProcessingStatusResponse>(
      `/content/reels/${id}/status`,
    )
    return normalizeReelProcessingStatusResponse(response.data)
  },
  create: async (data: CreateReelPayload) => {
    const response = await apiClient.post<ReelDetail>('/content/reels', data)
    return normalizeReelApiResponse(response.data)
  },
  update: async (id: string, data: UpdateReelPayload) => {
    const response = await apiClient.patch<ReelDetail>(`/content/reels/${id}`, data)
    return normalizeReelApiResponse(response.data)
  },
  share: async (id: string, data: ShareReelPayload) => {
    const response = await apiClient.post<ReelShareResponse>(`/content/reels/${id}/share`, data)
    return response.data
  },
  createShareLink: async (id: string, data: CreateReelShareLinkPayload = {}) => {
    const response = await apiClient.post<ReelShareLinkResponse>(
      `/content/reels/${id}/share-link`,
      data,
    )
    return response.data
  },
  revokeShareLink: async (token: string) => {
    const response = await apiClient.delete<ReelShareLinkResponse>(
      `/content/reels/share-links/${token}`,
    )
    return response.data
  },
  trackEvents: async (payload: TrackReelEventsPayload): Promise<TrackReelEventsResponse> => {
    const response = await apiClient.post<TrackReelEventsResponse>('/content/reels/events', payload)
    return response.data
  },
  delete: async (id: string) => {
    await apiClient.delete(`/content/reels/${id}`)
  },
  reprocess: async (id: string) => {
    const response = await apiClient.post<ReelDetail>(`/content/reels/${id}/reprocess`)
    return normalizeReelApiResponse(response.data)
  },
}
