import { isAxiosError } from 'axios'

import { normalizeReelApiResponse } from '../lib/reelProcessing'

import { apiClient } from './client'

import type {
  GlobalSearchParams,
  GlobalSearchResponse,
  GlobalSearchType,
  SearchSuggestionsParams,
  SearchSuggestionsResponse,
  SearchTagsParams,
  SearchTagsResponse,
  TagReelsPage,
  TagReelsParams,
} from '../types/search.types'

const buildEmptySearchResponse = (
  query: string,
  type: GlobalSearchType = 'all',
): GlobalSearchResponse => ({
  query,
  type,
  users: [],
  reels: [],
  tags: [],
  counts: {
    users: 0,
    reels: 0,
    tags: 0,
  },
})

export async function getGlobalSearch(params: GlobalSearchParams): Promise<GlobalSearchResponse> {
  const normalizedQuery = params.q.trim()
  const normalizedType = params.type ?? 'all'

  if (!normalizedQuery) {
    return buildEmptySearchResponse(normalizedQuery, normalizedType)
  }

  const response = await apiClient.get<GlobalSearchResponse>('/search', {
    params: {
      q: normalizedQuery,
      type: normalizedType,
      ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
    },
  })

  // `tags` is absent until the backend rollout that introduced it reaches this environment.
  return {
    ...response.data,
    tags: response.data.tags ?? [],
    counts: { ...response.data.counts, tags: response.data.counts.tags ?? 0 },
  }
}

export async function getSearchSuggestions(
  params: SearchSuggestionsParams = {},
): Promise<SearchSuggestionsResponse> {
  const response = await apiClient.get<SearchSuggestionsResponse>('/search/suggestions', {
    params: {
      type: params.type ?? 'all',
      ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
    },
  })

  return response.data
}

export async function getSearchTags(params: SearchTagsParams = {}): Promise<SearchTagsResponse> {
  const normalizedQuery = params.q?.trim()

  const response = await apiClient.get<SearchTagsResponse>('/search/tags', {
    params: {
      ...(normalizedQuery ? { q: normalizedQuery } : {}),
      ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
    },
  })

  return response.data
}

export async function getTagReels(params: TagReelsParams): Promise<TagReelsPage> {
  try {
    const response = await apiClient.get<TagReelsPage>('/search/tags/reels', {
      params: {
        tag: params.tag,
        ...(params.cursor ? { cursor: params.cursor } : {}),
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
      },
    })

    return {
      items: response.data.items.map(normalizeReelApiResponse),
      nextCursor: response.data.nextCursor ?? null,
    }
  } catch (error) {
    // Backends that predate /search/tags/reels: fall back to a single page of reel search.
    if (isAxiosError(error) && error.response?.status === 404 && !params.cursor) {
      const fallback = await getGlobalSearch({
        q: params.tag,
        type: 'reels',
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
      })

      return { items: fallback.reels, nextCursor: null }
    }

    throw error
  }
}

export const searchApi = {
  getGlobalSearch,
  getSearchSuggestions,
  getSearchTags,
  getTagReels,
}
