import { apiClient } from './client'

import type {
  GlobalSearchParams,
  GlobalSearchResponse,
  GlobalSearchType,
  SearchSuggestionsParams,
  SearchSuggestionsResponse,
} from '../types/search.types'

const buildEmptySearchResponse = (
  query: string,
  type: GlobalSearchType = 'all',
): GlobalSearchResponse => ({
  query,
  type,
  users: [],
  reels: [],
  counts: {
    users: 0,
    reels: 0,
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

  return response.data
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

export const searchApi = {
  getGlobalSearch,
  getSearchSuggestions,
}
