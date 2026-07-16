import { isAxiosError } from 'axios'

import { parseRecommendedReelsResponse } from '../lib/recommendationFeed'

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
  return parseRecommendedReelsResponse(response.data)
}

export async function getFriendsReels(
  params: { limit?: number; cursor?: string } = {},
): Promise<PaginatedFriendsReels> {
  try {
    const response = await apiClient.get<PaginatedFriendsReels>('/content/reels/friends', {
      params,
    })
    return response.data
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

export const reelsApi = {
  list: async (params: ListReelsParams = {}) => {
    const response = await apiClient.get<ListReelsResponse>('/content/reels', { params })
    return response.data
  },
  getRecommendedReels,
  getFriendsReels,
  getById: async (id: string) => {
    const response = await apiClient.get<ReelDetail>(`/content/reels/${id}`)
    return response.data
  },
  getContext: async (id: string, params: ReelContextParams = {}) => {
    const response = await apiClient.get<ReelContextResponse>(`/content/reels/${id}/context`, {
      params,
    })
    return response.data
  },
  getStatus: async (id: string) => {
    const response = await apiClient.get<ReelProcessingStatusResponse>(
      `/content/reels/${id}/status`,
    )
    return response.data
  },
  create: async (data: CreateReelPayload) => {
    const response = await apiClient.post<ReelDetail>('/content/reels', data)
    return response.data
  },
  update: async (id: string, data: UpdateReelPayload) => {
    const response = await apiClient.patch<ReelDetail>(`/content/reels/${id}`, data)
    return response.data
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
    return response.data
  },
}
