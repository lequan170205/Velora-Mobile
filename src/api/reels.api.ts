import { parseRecommendedReelsResponse } from '../lib/recommendationFeed'

import { apiClient } from './client'

import type {
  CreateReelPayload,
  ReelContextParams,
  ReelContextResponse,
  CreateReelShareLinkPayload,
  ListReelsParams,
  ListReelsResponse,
  PaginatedReels,
  ReelDetail,
  ReelProcessingStatusResponse,
  RecommendedReelsParams,
  ReelFeedListItem,
  ReelShareLinkResponse,
  ReelShareResponse,
  ShareReelPayload,
  TrackReelEventsPayload,
  TrackReelEventsResponse,
  UpdateReelPayload,
} from '../types/reel.types'

export async function getRecommendedReels(
  params: RecommendedReelsParams = {},
): Promise<PaginatedReels<ReelFeedListItem>> {
  const response = await apiClient.get<PaginatedReels<ReelFeedListItem>>(
    '/content/reels/recommended',
    {
      params: {
        limit: params.limit,
        cursor: params.cursor,
        excludeRecentlySeen: params.excludeRecentlySeen,
        feedSessionId: params.feedSessionId,
      },
    },
  )
  return parseRecommendedReelsResponse(response.data)
}

export const reelsApi = {
  list: async (params: ListReelsParams = {}) => {
    const response = await apiClient.get<ListReelsResponse>('/content/reels', { params })
    return response.data
  },
  getRecommendedReels,
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
