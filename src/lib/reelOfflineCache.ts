import AsyncStorage from '@react-native-async-storage/async-storage'

import { DEFAULT_REELS_LIMIT } from '../constants/reels'

import type { ListReelsParams, ListReelsResponse } from '../types/reel.types'

const REEL_FEED_CACHE_PREFIX = '@velora/reels/feed-page/v1'
const REEL_FEED_CACHE_INDEX_KEY = '@velora/reels/feed-page-index/v1'
const MAX_CACHED_FEED_PAGES = 24
const MAX_CACHE_AGE_MS = 1000 * 60 * 60 * 24 * 7

type CacheableFeedParams = Omit<ListReelsParams, 'cursor'>

interface ReelFeedCacheEntry {
  key: string
  savedAt: number
}

interface CachedReelFeedPage {
  savedAt: number
  params: CacheableFeedParams
  cursor?: string
  response: ListReelsResponse
}

const normalizeFeedParams = (params: CacheableFeedParams = {}) => ({
  limit: params.limit ?? DEFAULT_REELS_LIMIT,
  ...(params.userId ? { userId: params.userId } : {}),
  ...(params.visibility ? { visibility: params.visibility } : {}),
  ...(params.ranked !== undefined ? { ranked: params.ranked } : {}),
})

const stableStringify = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = value[key]
        return result
      }, {}),
  )

const getPageCacheKey = (params: CacheableFeedParams = {}, cursor?: string) => {
  const normalizedParams = normalizeFeedParams(params)
  const paramsKey = stableStringify(normalizedParams)
  const cursorKey = cursor ?? 'FIRST_PAGE'

  return `${REEL_FEED_CACHE_PREFIX}/${paramsKey}/${cursorKey}`
}

const readCacheIndex = async (): Promise<ReelFeedCacheEntry[]> => {
  try {
    const raw = await AsyncStorage.getItem(REEL_FEED_CACHE_INDEX_KEY)

    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (item): item is ReelFeedCacheEntry =>
        typeof item?.key === 'string' && typeof item?.savedAt === 'number',
    )
  } catch {
    return []
  }
}

const writeCacheIndex = async (entries: ReelFeedCacheEntry[]) => {
  await AsyncStorage.setItem(REEL_FEED_CACHE_INDEX_KEY, JSON.stringify(entries))
}

const trimCacheIndex = async (entries: ReelFeedCacheEntry[]) => {
  const now = Date.now()
  const uniqueEntriesByKey = new Map<string, ReelFeedCacheEntry>()

  for (const entry of entries) {
    if (now - entry.savedAt > MAX_CACHE_AGE_MS) {
      await AsyncStorage.removeItem(entry.key).catch(() => undefined)
      continue
    }

    const existing = uniqueEntriesByKey.get(entry.key)

    if (!existing || existing.savedAt < entry.savedAt) {
      uniqueEntriesByKey.set(entry.key, entry)
    }
  }

  const sortedEntries = [...uniqueEntriesByKey.values()].sort((a, b) => b.savedAt - a.savedAt)
  const keptEntries = sortedEntries.slice(0, MAX_CACHED_FEED_PAGES)
  const removedEntries = sortedEntries.slice(MAX_CACHED_FEED_PAGES)

  await Promise.all(
    removedEntries.map((entry) => AsyncStorage.removeItem(entry.key).catch(() => undefined)),
  )

  await writeCacheIndex(keptEntries)
}

export const cacheReelFeedPage = async (
  params: CacheableFeedParams,
  cursor: string | undefined,
  response: ListReelsResponse,
) => {
  if (!response.items.length) {
    return
  }

  const key = getPageCacheKey(params, cursor)
  const savedAt = Date.now()

  const payload: CachedReelFeedPage = {
    savedAt,
    params: normalizeFeedParams(params),
    ...(cursor ? { cursor } : {}),
    response: {
      ...response,
      fromOfflineCache: false,
      cachedAt: savedAt,
    },
  }

  await AsyncStorage.setItem(key, JSON.stringify(payload))

  const index = await readCacheIndex()
  await trimCacheIndex([{ key, savedAt }, ...index])
}

export const readCachedReelFeedPage = async (
  params: CacheableFeedParams,
  cursor?: string,
): Promise<ListReelsResponse | null> => {
  const key = getPageCacheKey(params, cursor)

  try {
    const raw = await AsyncStorage.getItem(key)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as CachedReelFeedPage

    if (!parsed?.response?.items?.length) {
      return null
    }

    return {
      ...parsed.response,
      fromOfflineCache: true,
      cachedAt: parsed.savedAt,
    }
  } catch {
    return null
  }
}
