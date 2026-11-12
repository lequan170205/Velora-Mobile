import type { Reel } from '../types/reel.types'

// Profile grids open the reel viewer with the list of reels around the tapped one. Putting that
// list in the route URL means JSON-encoding every loaded reel on the JS thread at tap time, so it
// grows with every page scrolled. Keep the list in memory and pass only a short key instead.
const STASH_PREFIX = 'stash:'
const MAX_STASHED_CONTEXTS = 8

const stashedContexts = new Map<string, Reel[]>()
let stashCounter = 0

export const stashReelRouteContext = (reels: Reel[]): string | null => {
  if (reels.length === 0) {
    return null
  }

  stashCounter += 1
  const key = `${STASH_PREFIX}${stashCounter.toString(36)}`
  stashedContexts.set(key, reels)

  while (stashedContexts.size > MAX_STASHED_CONTEXTS) {
    const oldestKey = stashedContexts.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    stashedContexts.delete(oldestKey)
  }

  return key
}

export const getStashedReelRouteContext = (key?: string | null): Reel[] | undefined =>
  key?.startsWith(STASH_PREFIX) ? stashedContexts.get(key) : undefined
