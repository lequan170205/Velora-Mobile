import AsyncStorage from '@react-native-async-storage/async-storage'
import { isAxiosError } from 'axios'

import { reelsApi } from '../api/reels.api'
import { getIsOnline } from '../lib/network'

import type { TrackReelEventPayload } from '../types/reel.types'

const MAX_QUEUE_SIZE = 500
const MAX_BATCH_SIZE = 50
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000
const INITIAL_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 5 * 60 * 1000

type QueueDiagnostics = {
  currentBackoffMs: number
  lastFailureAt: number | null
  lastFailureReason: string | null
  lastSuccessfulFlushAt: number | null
  pendingCount: number
}

const isCriticalEvent = (event: TrackReelEventPayload) =>
  event.eventType === 'COMPLETE' || event.eventType === 'SKIP' || event.eventType === 'WATCH_END'

const isExpired = (event: TrackReelEventPayload, now: number) => {
  const occurredAt = new Date(event.occurredAt).getTime()
  return !Number.isFinite(occurredAt) || now - occurredAt > MAX_EVENT_AGE_MS
}

class ReelEventQueue {
  private activeUserId: string | null = null
  private events: TrackReelEventPayload[] = []
  private flushPromise: Promise<void> | null = null
  private isAuthBlocked = false
  private nextFlushAt = 0
  private writeChain = Promise.resolve()
  private diagnostics: QueueDiagnostics = {
    currentBackoffMs: 0,
    lastFailureAt: null,
    lastFailureReason: null,
    lastSuccessfulFlushAt: null,
    pendingCount: 0,
  }

  private getStorageKey(userId = this.activeUserId) {
    return userId ? `reel-event-queue:${userId}` : null
  }

  private reportDiagnostics() {
    this.diagnostics.pendingCount = this.events.length
  }

  private trim(now = Date.now()) {
    this.events = this.events.filter((event) => !isExpired(event, now))

    while (this.events.length > MAX_QUEUE_SIZE) {
      const progressIndex = this.events.findIndex((event) => event.eventType === 'WATCH_PROGRESS')
      const removableIndex =
        progressIndex >= 0
          ? progressIndex
          : this.events.findIndex((event) => !isCriticalEvent(event))
      this.events.splice(removableIndex >= 0 ? removableIndex : 0, 1)
    }
  }

  private persist() {
    const storageKey = this.getStorageKey()
    const snapshot = [...this.events]

    if (!storageKey) {
      return
    }

    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await AsyncStorage.setItem(storageKey, JSON.stringify(snapshot))
      })
  }

  private removeSubmittedBatch(batch: TrackReelEventPayload[]) {
    const ids = new Set(batch.map((event) => event.eventId))
    this.events = this.events.filter((event) => !ids.has(event.eventId))
    this.persist()
    this.reportDiagnostics()
  }

  private fail(reason: string, shouldBackoff: boolean) {
    this.diagnostics.lastFailureAt = Date.now()
    this.diagnostics.lastFailureReason = reason
    this.diagnostics.currentBackoffMs = shouldBackoff
      ? Math.min(
          MAX_BACKOFF_MS,
          Math.max(INITIAL_BACKOFF_MS, this.diagnostics.currentBackoffMs * 2),
        )
      : 0
    this.nextFlushAt = shouldBackoff ? Date.now() + this.diagnostics.currentBackoffMs : 0
    this.reportDiagnostics()
  }

  async setAuthenticatedUser(userId: string | null) {
    if (this.activeUserId === userId) {
      if (userId) {
        this.isAuthBlocked = false
      }
      return
    }

    await this.writeChain.catch(() => undefined)
    this.activeUserId = userId
    this.events = []
    this.isAuthBlocked = false
    this.nextFlushAt = 0

    const storageKey = this.getStorageKey()
    if (storageKey) {
      try {
        const stored = await AsyncStorage.getItem(storageKey)
        const parsed: unknown = stored ? JSON.parse(stored) : []
        this.events = Array.isArray(parsed) ? (parsed as TrackReelEventPayload[]) : []
      } catch {
        this.events = []
      }
    }

    this.trim()
    this.persist()
    this.reportDiagnostics()
  }

  async clearUser(userId: string) {
    if (!userId) {
      return
    }

    if (this.activeUserId === userId) {
      this.events = []
      this.isAuthBlocked = false
      this.nextFlushAt = 0
      this.reportDiagnostics()
    }

    await AsyncStorage.removeItem(`reel-event-queue:${userId}`)
  }

  enqueue(event: TrackReelEventPayload) {
    if (!this.activeUserId) {
      return
    }

    this.events.push(event)
    this.trim()
    this.persist()
    this.reportDiagnostics()

    if (this.events.length >= 10) {
      void this.flush()
    }
  }

  async flush() {
    if (this.flushPromise) {
      return this.flushPromise
    }

    this.flushPromise = this.flushInternal().finally(() => {
      this.flushPromise = null
    })
    return this.flushPromise
  }

  private async flushInternal() {
    if (!this.activeUserId || this.isAuthBlocked || Date.now() < this.nextFlushAt) {
      return
    }

    this.trim()
    this.persist()

    if (this.events.length === 0 || !(await getIsOnline())) {
      this.reportDiagnostics()
      return
    }

    while (this.events.length > 0 && !this.isAuthBlocked && Date.now() >= this.nextFlushAt) {
      const batch = this.events.slice(0, MAX_BATCH_SIZE)

      try {
        await reelsApi.trackEvents({ events: batch })
        this.removeSubmittedBatch(batch)
        this.diagnostics.lastSuccessfulFlushAt = Date.now()
        this.diagnostics.lastFailureAt = null
        this.diagnostics.lastFailureReason = null
        this.diagnostics.currentBackoffMs = 0
        this.nextFlushAt = 0
      } catch (error) {
        const status = isAxiosError(error) ? error.response?.status : undefined

        if (status === 401) {
          this.isAuthBlocked = true
          this.fail('HTTP 401', false)
          return
        }

        if (status && status >= 400 && status < 500) {
          if (__DEV__) {
            console.warn('[ReelTelemetry] Dropping invalid telemetry batch')
          }
          this.removeSubmittedBatch(batch)
          this.fail(`HTTP ${status}`, false)
          continue
        }

        this.fail(status ? `HTTP ${status}` : 'Network failure', true)
        return
      }
    }
  }

  getDiagnostics() {
    return { ...this.diagnostics, pendingCount: this.events.length }
  }
}

export const reelEventQueue = new ReelEventQueue()

export const getReelEventQueueDiagnostics = () => (__DEV__ ? reelEventQueue.getDiagnostics() : null)
