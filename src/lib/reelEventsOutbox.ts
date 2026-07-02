import AsyncStorage from '@react-native-async-storage/async-storage'

import { reelsApi } from '../api/reels.api'

import { getIsOnline } from './network'

import type { TrackReelEventPayload } from '../types/reel.types'

const REEL_EVENTS_OUTBOX_KEY = '@velora/reels/events-outbox/v1'
const MAX_OUTBOX_EVENTS = 300
const BATCH_SIZE = 40

const readOutbox = async (): Promise<TrackReelEventPayload[]> => {
  try {
    const raw = await AsyncStorage.getItem(REEL_EVENTS_OUTBOX_KEY)

    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (event): event is TrackReelEventPayload =>
        typeof event?.reelId === 'string' && typeof event?.eventType === 'string',
    )
  } catch {
    return []
  }
}

const writeOutbox = async (events: TrackReelEventPayload[]) => {
  const trimmedEvents = events.slice(-MAX_OUTBOX_EVENTS)
  await AsyncStorage.setItem(REEL_EVENTS_OUTBOX_KEY, JSON.stringify(trimmedEvents))
}

export const queueReelEvents = async (events: TrackReelEventPayload[]) => {
  if (events.length === 0) {
    return
  }

  const currentEvents = await readOutbox()
  await writeOutbox([...currentEvents, ...events])
}

export const flushQueuedReelEvents = async () => {
  const isOnline = await getIsOnline()

  if (!isOnline) {
    return false
  }

  const queuedEvents = await readOutbox()

  if (queuedEvents.length === 0) {
    return true
  }

  let remainingEvents = [...queuedEvents]

  while (remainingEvents.length > 0) {
    const batch = remainingEvents.slice(0, BATCH_SIZE)

    try {
      await reelsApi.trackEvents({ events: batch })
      remainingEvents = remainingEvents.slice(BATCH_SIZE)
      await writeOutbox(remainingEvents)
    } catch {
      await writeOutbox(remainingEvents)
      return false
    }
  }

  await writeOutbox([])
  return true
}

export const getQueuedReelEventCount = async () => {
  const events = await readOutbox()
  return events.length
}
