import {
  createFeedCacheKey,
  deserializeReelRecommendations,
  deserializeCachedReelToReel,
  getCachedFeedPageReelIds,
  normalizeFeedParams,
  serializeReelToCachedReelInput,
  serializeReelRecommendations,
  toCachedReelFeedPageInput,
} from '../database/reels/reelCacheMappers'
import {
  deleteCachedReelFeedPages,
  deleteCachedReels,
  findCachedReelFeedPageByCacheKey,
  getAllCachedReelFeedPages,
  getAllCachedReels,
  getCachedReelsByReelIds,
  touchCachedReelFeedPageAndReels,
  upsertCachedReelFeedPage,
  upsertCachedReels,
} from '../database/reels/reelOfflineStore'

import type { CacheableFeedParams } from '../database/reels/reelCacheMappers'
import type { ListReelsResponse } from '../types/reel.types'

const MAX_CACHED_FEED_PAGES = 24
const MAX_CACHE_AGE_MS = 1000 * 60 * 60 * 24 * 7

const getPageAgeMs = (cachedAt: number) => Date.now() - cachedAt

export const pruneCachedReelOfflineMetadata = async () => {
  const now = Date.now()
  const allPages = await getAllCachedReelFeedPages()
  const pagesByFreshness = [...allPages].sort((a, b) => b.cachedAt - a.cachedAt)
  const stalePages = pagesByFreshness.filter((page) => now - page.cachedAt > MAX_CACHE_AGE_MS)
  const freshPages = pagesByFreshness.filter((page) => now - page.cachedAt <= MAX_CACHE_AGE_MS)
  const overflowPages = freshPages.slice(MAX_CACHED_FEED_PAGES)
  const pagesToDelete = [...stalePages, ...overflowPages]

  if (pagesToDelete.length > 0) {
    await deleteCachedReelFeedPages(pagesToDelete)
  }

  const retainedPages = freshPages.slice(0, MAX_CACHED_FEED_PAGES)
  const referencedReelIds = new Set(retainedPages.flatMap((page) => getCachedFeedPageReelIds(page)))
  const cachedReels = await getAllCachedReels()
  const orphanedReels = cachedReels.filter((reel) => {
    if (referencedReelIds.has(reel.reelId)) {
      return false
    }

    return now - Math.max(reel.cachedAt, reel.lastAccessedAt) > MAX_CACHE_AGE_MS
  })

  if (orphanedReels.length > 0) {
    await deleteCachedReels(orphanedReels)
  }
}

export const cacheReelFeedPage = async (
  params: CacheableFeedParams,
  cursor: string | undefined,
  response: ListReelsResponse,
) => {
  if (response.items.length === 0) {
    return
  }

  const savedAt = Date.now()
  const normalizedParams = normalizeFeedParams(params)
  const reelInputs = response.items.map((reel) => ({
    ...serializeReelToCachedReelInput(reel),
    cachedAt: savedAt,
    lastAccessedAt: savedAt,
  }))

  await upsertCachedReels(reelInputs)
  await upsertCachedReelFeedPage(
    toCachedReelFeedPageInput({
      cacheKey: createFeedCacheKey(normalizedParams, cursor),
      params: normalizedParams,
      ...(cursor ? { cursor } : {}),
      reelIds: response.items.map((reel) => reel.id),
      recommendations: serializeReelRecommendations(response.items),
      ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
      ...(response.feedSessionId ? { feedSessionId: response.feedSessionId } : {}),
      ...(response.algorithmVersion ? { algorithmVersion: response.algorithmVersion } : {}),
      ...(response.generatedAt ? { generatedAt: response.generatedAt } : {}),
      cachedAt: savedAt,
      lastAccessedAt: savedAt,
    }),
  )

  await pruneCachedReelOfflineMetadata()
}

export const readCachedReelFeedPage = async (
  params: CacheableFeedParams,
  cursor?: string,
): Promise<ListReelsResponse | null> => {
  const normalizedParams = normalizeFeedParams(params)
  const page = await findCachedReelFeedPageByCacheKey(createFeedCacheKey(normalizedParams, cursor))

  if (!page) {
    return null
  }

  if (getPageAgeMs(page.cachedAt) > MAX_CACHE_AGE_MS) {
    await deleteCachedReelFeedPages([page])
    void pruneCachedReelOfflineMetadata().catch(() => undefined)
    return null
  }

  const reelIds = getCachedFeedPageReelIds(page)

  if (reelIds.length === 0) {
    return null
  }

  const reelRecords = await getCachedReelsByReelIds(reelIds)

  if (reelRecords.length === 0) {
    return null
  }

  const reelsById = new Map(reelRecords.map((record) => [record.reelId, record]))
  const recommendationsByReelId = deserializeReelRecommendations(page.recommendationsJson)
  const items = reelIds
    .map((reelId) => reelsById.get(reelId))
    .filter((record): record is NonNullable<typeof record> => record !== undefined)
    .map((record) => {
      const reel = deserializeCachedReelToReel(record)
      const recommendation = recommendationsByReelId[reel.id]

      if (recommendation) {
        return { ...reel, recommendation }
      }

      if (!normalizedParams.recommended) {
        return reel
      }

      const { recommendation: _recommendation, ...reelWithoutRecommendation } = reel
      return reelWithoutRecommendation
    })

  if (items.length === 0) {
    return null
  }

  const touchedAt = Date.now()
  void touchCachedReelFeedPageAndReels({
    page,
    reels: reelRecords,
    touchedAt,
  }).catch(() => undefined)

  return {
    items,
    nextCursor: page.nextCursor,
    fromOfflineCache: true,
    cachedAt: page.cachedAt,
    ...(page.feedSessionId ? { feedSessionId: page.feedSessionId } : {}),
    ...(page.algorithmVersion ? { algorithmVersion: page.algorithmVersion } : {}),
    ...(page.generatedAt ? { generatedAt: page.generatedAt } : {}),
  }
}
