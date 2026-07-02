import { reelsApi } from '../api/reels.api'
import {
  deleteReelEventOutboxItems,
  getReelEventOutboxCount,
  getReelEventOutboxItems,
  insertReelEventOutboxItems,
  markReelEventOutboxItemsAttempted,
} from '../database/reels/reelOfflineStore'

import { getIsOnline } from './network'

import type { ReelEventOutboxItemModel } from '../database/models/ReelEventOutboxItemModel'
import type { ReelEventOutboxItemInput } from '../database/reels/reelOfflineStore'
import type { TrackReelEventPayload } from '../types/reel.types'

const MAX_OUTBOX_EVENTS = 500
const BATCH_SIZE = 40

const isTrackReelEventPayload = (value: unknown): value is TrackReelEventPayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Partial<TrackReelEventPayload>
  return typeof candidate.reelId === 'string' && typeof candidate.eventType === 'string'
}

const buildOutboxEventId = (
  event: Pick<TrackReelEventPayload, 'reelId' | 'eventType'>,
  createdAt: number,
  index: number,
) =>
  `${event.reelId}-${event.eventType}-${createdAt}-${index}-${Math.random().toString(36).slice(2, 10)}`

const toOutboxItemInput = (
  event: TrackReelEventPayload,
  createdAt: number,
  index: number,
): ReelEventOutboxItemInput => ({
  eventId: buildOutboxEventId(event, createdAt, index),
  reelId: event.reelId,
  sessionId: event.sessionId ?? null,
  eventType: event.eventType,
  payloadJson: JSON.stringify(event),
  createdAt,
  retryCount: 0,
  lastAttemptedAt: null,
})

const deserializeOutboxItem = (record: ReelEventOutboxItemModel): TrackReelEventPayload | null => {
  try {
    const parsed: unknown = JSON.parse(record.payloadJson)

    if (isTrackReelEventPayload(parsed)) {
      return parsed
    }
  } catch {
    // Fall through to a minimal payload built from indexed columns.
  }

  return {
    reelId: record.reelId,
    eventType: record.eventType as TrackReelEventPayload['eventType'],
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
  }
}

const trimOutbox = async () => {
  const queuedCount = await getReelEventOutboxCount()

  if (queuedCount <= MAX_OUTBOX_EVENTS) {
    return
  }

  const queuedItems = await getReelEventOutboxItems()
  const overflowCount = queuedItems.length - MAX_OUTBOX_EVENTS

  if (overflowCount <= 0) {
    return
  }

  await deleteReelEventOutboxItems(queuedItems.slice(0, overflowCount))
}

export const queueReelEvents = async (events: TrackReelEventPayload[]) => {
  if (events.length === 0) {
    return
  }

  const baseCreatedAt = Date.now()

  await insertReelEventOutboxItems(
    events.map((event, index) => toOutboxItemInput(event, baseCreatedAt + index, index)),
  )

  await trimOutbox()
}

export const flushQueuedReelEvents = async () => {
  const isOnline = await getIsOnline()

  if (!isOnline) {
    return false
  }

  let records = await getReelEventOutboxItems(BATCH_SIZE)

  while (records.length > 0) {
    const events = records
      .map(deserializeOutboxItem)
      .filter((event): event is TrackReelEventPayload => event !== null)

    if (events.length === 0) {
      await deleteReelEventOutboxItems(records)
      continue
    }

    try {
      await reelsApi.trackEvents({ events })
      await deleteReelEventOutboxItems(records)
    } catch {
      await markReelEventOutboxItemsAttempted(records, Date.now())
      return false
    }

    records = await getReelEventOutboxItems(BATCH_SIZE)
  }

  return true
}

export const getQueuedReelEventCount = async () => getReelEventOutboxCount()
