import * as Crypto from 'expo-crypto'

import { reelEventQueue } from './reelEventQueue'

import type {
  ReelEventRecommendation,
  ReelEventSource,
  ReelViewEventType,
  TrackReelEventPayload,
} from '../types/reel.types'

const IMPRESSION_DELAY_MS = 500
const PROGRESS_THRESHOLDS = [25, 50, 75]

type PlaybackTrackerOptions = {
  durationMs?: number
  muted: boolean
  recommendation?: ReelEventRecommendation
  reelId: string
  source: ReelEventSource
}

export class ReelPlaybackTracker {
  private readonly playbackSessionId: string
  private readonly progressThresholds = new Set<number>()
  private completionState = false
  private cumulativeWatchMs = 0
  private disposed = false
  private durationMs = 0
  private impressionState = false
  private impressionTimer: ReturnType<typeof setTimeout> | null = null
  private lastProgressAt: number | null = null
  private maxWatchedPositionMs = 0
  private mutedState: boolean
  private pausedState = false
  private playbackStartTimestamp: number | null = null
  private replayState = false
  private sequence = 0
  private startState = false

  constructor(private readonly options: PlaybackTrackerOptions) {
    this.playbackSessionId = Crypto.randomUUID()
    this.durationMs = options.durationMs ?? 0
    this.mutedState = options.muted
  }

  private emit(
    eventType: ReelViewEventType,
    fields: Partial<
      Omit<
        TrackReelEventPayload,
        | 'eventId'
        | 'eventType'
        | 'occurredAt'
        | 'playbackSessionId'
        | 'reelId'
        | 'sequence'
        | 'source'
      >
    > = {},
  ) {
    if (this.disposed) {
      return
    }

    let eventId: string

    try {
      eventId = Crypto.randomUUID()
    } catch {
      this.disposed = true
      return
    }

    reelEventQueue.enqueue({
      eventId,
      reelId: this.options.reelId,
      playbackSessionId: this.playbackSessionId,
      sequence: this.sequence,
      eventType,
      source: this.options.source,
      occurredAt: new Date().toISOString(),
      muted: this.mutedState,
      ...(this.options.recommendation ? { recommendation: this.options.recommendation } : {}),
      ...fields,
    })
    this.sequence += 1
  }

  activate() {
    if (this.disposed || this.impressionState || this.impressionTimer) {
      return
    }

    this.impressionTimer = setTimeout(() => {
      this.impressionTimer = null
      if (!this.disposed && !this.impressionState) {
        this.impressionState = true
        this.emit('IMPRESSION')
      }
    }, IMPRESSION_DELAY_MS)
  }

  setMuted(muted: boolean) {
    if (this.disposed || this.mutedState === muted) {
      return
    }

    this.mutedState = muted
    this.emit(muted ? 'MUTE' : 'UNMUTE', { muted })
  }

  setIntentionalPaused(paused: boolean) {
    if (this.disposed || this.pausedState === paused) {
      return
    }

    this.pausedState = paused
    this.lastProgressAt = null

    if (paused) {
      this.emit('PAUSE')
      return
    }

    if (this.startState) {
      this.emit('RESUME')
    }
  }

  setAppActive(isActive: boolean) {
    this.lastProgressAt = null
    if (!isActive) {
      this.emitProgressIfMeaningful()
    }
  }

  onProgress({
    currentTimeMs,
    durationMs,
    isBuffering,
    isPlaying,
  }: {
    currentTimeMs: number
    durationMs: number
    isBuffering: boolean
    isPlaying: boolean
  }) {
    if (this.disposed) {
      return
    }

    if (durationMs > 0) {
      this.durationMs = durationMs
    }

    this.maxWatchedPositionMs = Math.max(this.maxWatchedPositionMs, currentTimeMs)
    const now = Date.now()

    if (!isPlaying || isBuffering || this.pausedState) {
      this.lastProgressAt = null
      return
    }

    if (
      this.completionState &&
      this.startState &&
      currentTimeMs < this.maxWatchedPositionMs * 0.1
    ) {
      this.startState = false
      this.lastProgressAt = null
    }

    if (!this.startState) {
      if (this.completionState) {
        this.replayState = true
        this.emit('REPLAY', { replayed: true })
      } else {
        this.emit('WATCH_START')
      }
      this.startState = true
      this.playbackStartTimestamp = now
    }

    if (this.lastProgressAt !== null) {
      this.cumulativeWatchMs += Math.max(0, now - this.lastProgressAt)
    }
    this.lastProgressAt = now

    const percentageWatched = this.getPercentageWatched()
    PROGRESS_THRESHOLDS.forEach((threshold) => {
      if (percentageWatched >= threshold && !this.progressThresholds.has(threshold)) {
        this.progressThresholds.add(threshold)
        this.emit('WATCH_PROGRESS', this.getProgressFields())
      }
    })

    if (percentageWatched >= 95 && !this.completionState) {
      this.completionState = true
      this.emit('COMPLETE', { ...this.getProgressFields(), completed: true })
    }
  }

  finalize() {
    if (this.disposed) {
      return
    }

    if (this.impressionTimer) {
      clearTimeout(this.impressionTimer)
      this.impressionTimer = null
    }

    this.emitProgressIfMeaningful()
    if (this.startState) {
      const fields = this.getProgressFields()
      this.emit('WATCH_END', fields)
      if (this.getPercentageWatched() < 15 && this.cumulativeWatchMs < 3_000) {
        this.emit('SKIP', { ...fields, skipped: true })
      }
    }
    this.disposed = true
  }

  private getPercentageWatched() {
    if (this.durationMs <= 0) {
      return 0
    }

    return Math.min(100, (this.maxWatchedPositionMs / this.durationMs) * 100)
  }

  private getProgressFields() {
    return {
      watchMs: Math.max(0, Math.round(this.cumulativeWatchMs)),
      ...(this.durationMs > 0 ? { durationMs: Math.round(this.durationMs) } : {}),
      percentageWatched: this.getPercentageWatched(),
      ...(this.completionState ? { completed: true } : {}),
      ...(this.replayState ? { replayed: true } : {}),
    }
  }

  private emitProgressIfMeaningful() {
    if (this.startState && this.cumulativeWatchMs > 0) {
      this.emit('WATCH_PROGRESS', this.getProgressFields())
    }
  }
}
