import { reelEventQueue } from '../services/reelEventQueue'

import type { TrackReelEventPayload } from '../types/reel.types'

export const queueReelEvents = async (events: TrackReelEventPayload[]) => {
  events.forEach((event) => reelEventQueue.enqueue(event))
}

export const flushQueuedReelEvents = () => reelEventQueue.flush()

export const getQueuedReelEventCount = async () => reelEventQueue.getDiagnostics().pendingCount
