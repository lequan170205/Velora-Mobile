import type {
  RecommendedReelsPage,
  RecommendedReelsParams,
  ReelFeedListItem,
} from '../types/reel.types'

export class RecommendedReelsSession {
  private feedSessionId: string | null = null

  getRequestParams({
    cursor,
    excludeRecentlySeen,
    limit,
  }: Pick<RecommendedReelsParams, 'cursor' | 'excludeRecentlySeen' | 'limit'>) {
    return {
      ...(typeof limit === 'number' ? { limit } : {}),
      ...(typeof excludeRecentlySeen === 'boolean' ? { excludeRecentlySeen } : {}),
      ...(cursor ? { cursor } : {}),
      ...(cursor && this.feedSessionId ? { feedSessionId: this.feedSessionId } : {}),
    }
  }

  capture(page: Pick<RecommendedReelsPage, 'feedSessionId'>) {
    this.feedSessionId = page.feedSessionId
  }

  reset() {
    this.feedSessionId = null
  }

  getFeedSessionId() {
    return this.feedSessionId
  }
}

export const flattenRecommendedReels = (
  pages: readonly Pick<RecommendedReelsPage, 'items'>[],
): ReelFeedListItem[] => {
  const seenReelIds = new Set<string>()

  return pages.flatMap((page) =>
    page.items.filter((reel) => {
      if (seenReelIds.has(reel.id)) {
        return false
      }

      seenReelIds.add(reel.id)
      return true
    }),
  )
}
