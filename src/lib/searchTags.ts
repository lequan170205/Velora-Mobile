import type { Reel } from '../types/reel.types'
import type { SearchTagItem } from '../types/search.types'

const MIN_TAG_LENGTH = 2
const MAX_TAG_LENGTH = 32

/** Mirrors the backend's tag key normalization so derived keys match server keys. */
export const normalizeSearchTag = (value: string): string | null => {
  const normalized = value
    .trim()
    .replace(/^#+/, '')
    .replace(/[\s_-]+/g, ' ')
    .trim()
    .toLowerCase()

  if (
    normalized.length < MIN_TAG_LENGTH ||
    normalized.length > MAX_TAG_LENGTH ||
    /^\d+$/.test(normalized)
  ) {
    return null
  }

  return normalized
}

/**
 * Most common tags on the reels already on screen. Used for the chip rail when the
 * trending-tags endpoint has nothing (e.g. not deployed yet), so the rail is never empty.
 */
export const deriveTagsFromReels = (
  reels: readonly Pick<Reel, 'tags'>[],
  limit: number,
): SearchTagItem[] => {
  const counts = new Map<string, number>()

  for (const reel of reels) {
    for (const tag of new Set((reel.tags ?? []).map(normalizeSearchTag))) {
      if (tag) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([tag, reelCount]) => ({ tag, reelCount }))
}
