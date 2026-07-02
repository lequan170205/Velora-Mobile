import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { reelsApi } from '../api/reels.api'

import type { ReelViewEventType, TrackReelEventPayload } from '../types/reel.types'
import type { AppStateStatus } from 'react-native'

const FLUSH_INTERVAL_MS = 5000
const QUICK_SKIP_THRESHOLD_MS = 1800
const MAX_BATCH_SIZE = 40
const MAX_RETRY_QUEUE_SIZE = MAX_BATCH_SIZE * 3

type EndReason = 'switch' | 'screen_blur' | 'manual_refresh' | 'unmount'

interface ActiveSession {
  reelId: string
  sessionId: string
  startedAt: number
  muted: boolean
}

const createSessionId = (reelId: string) =>
  `${reelId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const buildEndSessionEvents = (session: ActiveSession): TrackReelEventPayload[] => {
  const watchMs = Math.max(0, Date.now() - session.startedAt)
  const skipped = watchMs > 0 && watchMs < QUICK_SKIP_THRESHOLD_MS

  const events: TrackReelEventPayload[] = [
    {
      reelId: session.reelId,
      sessionId: session.sessionId,
      eventType: 'WATCH_END',
      watchMs,
      muted: session.muted,
      skipped,
    },
  ]

  if (skipped) {
    events.push({
      reelId: session.reelId,
      sessionId: session.sessionId,
      eventType: 'SKIP',
      watchMs,
      muted: session.muted,
      skipped: true,
    })
  } else if (watchMs > 0) {
    events.push({
      reelId: session.reelId,
      sessionId: session.sessionId,
      eventType: 'WATCH_PROGRESS',
      watchMs,
      muted: session.muted,
    })
  }

  return events
}

export function useReelAnalyticsTracker() {
  const pendingEventsRef = useRef<TrackReelEventPayload[]>([])
  const activeSessionRef = useRef<ActiveSession | null>(null)
  const isFlushingRef = useRef(false)

  const flushReelEvents = useCallback(async () => {
    if (isFlushingRef.current || pendingEventsRef.current.length === 0) {
      return
    }

    const batch = pendingEventsRef.current.splice(0, MAX_BATCH_SIZE)

    isFlushingRef.current = true

    try {
      await reelsApi.trackEvents({ events: batch })
    } catch {
      pendingEventsRef.current = [...batch, ...pendingEventsRef.current].slice(
        0,
        MAX_RETRY_QUEUE_SIZE,
      )
    } finally {
      isFlushingRef.current = false
    }
  }, [])

  const enqueueEvent = useCallback(
    (event: TrackReelEventPayload) => {
      pendingEventsRef.current.push(event)

      if (pendingEventsRef.current.length >= MAX_BATCH_SIZE) {
        void flushReelEvents()
      }
    },
    [flushReelEvents],
  )

  const enqueueEvents = useCallback(
    (events: TrackReelEventPayload[]) => {
      if (events.length === 0) {
        return
      }

      pendingEventsRef.current.push(...events)

      if (pendingEventsRef.current.length >= MAX_BATCH_SIZE) {
        void flushReelEvents()
      }
    },
    [flushReelEvents],
  )

  const trackReelEvent = useCallback(
    (
      reelId: string | null | undefined,
      eventType: ReelViewEventType,
      data: Partial<Omit<TrackReelEventPayload, 'reelId' | 'eventType'>> = {},
    ) => {
      if (!reelId) {
        return
      }

      enqueueEvent({
        reelId,
        eventType,
        ...data,
      })
    },
    [enqueueEvent],
  )

  const startReelSession = useCallback(
    (reelId: string | null | undefined, options: { muted?: boolean } = {}) => {
      if (!reelId) {
        return
      }

      const currentSession = activeSessionRef.current

      if (currentSession?.reelId === reelId) {
        currentSession.muted = options.muted ?? currentSession.muted
        return
      }

      if (currentSession) {
        enqueueEvents(buildEndSessionEvents(currentSession))
        activeSessionRef.current = null
      }

      const nextSession: ActiveSession = {
        reelId,
        sessionId: createSessionId(reelId),
        startedAt: Date.now(),
        muted: options.muted ?? false,
      }

      activeSessionRef.current = nextSession

      enqueueEvents([
        {
          reelId,
          sessionId: nextSession.sessionId,
          eventType: 'IMPRESSION',
          muted: nextSession.muted,
        },
        {
          reelId,
          sessionId: nextSession.sessionId,
          eventType: 'WATCH_START',
          muted: nextSession.muted,
        },
      ])
    },
    [enqueueEvents],
  )

  const endCurrentReelSession = useCallback(
    (reason: EndReason = 'switch') => {
      const currentSession = activeSessionRef.current

      if (!currentSession) {
        return
      }

      enqueueEvents(buildEndSessionEvents(currentSession))
      activeSessionRef.current = null

      if (reason !== 'switch') {
        void flushReelEvents()
      }
    },
    [enqueueEvents, flushReelEvents],
  )

  const updateActiveMutedState = useCallback(
    (muted: boolean) => {
      const currentSession = activeSessionRef.current

      if (!currentSession || currentSession.muted === muted) {
        return
      }

      currentSession.muted = muted

      enqueueEvent({
        reelId: currentSession.reelId,
        sessionId: currentSession.sessionId,
        eventType: muted ? 'MUTE' : 'UNMUTE',
        muted,
      })
    },
    [enqueueEvent],
  )

  useEffect(() => {
    const timer = setInterval(() => {
      void flushReelEvents()
    }, FLUSH_INTERVAL_MS)

    return () => {
      clearInterval(timer)
      endCurrentReelSession('unmount')
      void flushReelEvents()
    }
  }, [endCurrentReelSession, flushReelEvents])

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        endCurrentReelSession('screen_blur')
        void flushReelEvents()
      }
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange)

    return () => {
      subscription.remove()
    }
  }, [endCurrentReelSession, flushReelEvents])

  return {
    startReelSession,
    endCurrentReelSession,
    updateActiveMutedState,
    trackReelEvent,
    flushReelEvents,
  }
}
