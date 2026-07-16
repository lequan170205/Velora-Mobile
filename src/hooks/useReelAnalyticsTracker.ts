import * as Network from 'expo-network'
import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { reelEventQueue } from '../services/reelEventQueue'
import { ReelPlaybackTracker } from '../services/reelPlaybackTracker'
import { useAuthStore } from '../stores/authStore'

import type { RecommendationMetadata } from '../types/recommendation.types'
import type { ReelEventSource } from '../types/reel.types'
import type { AppStateStatus } from 'react-native'

const FLUSH_INTERVAL_MS = 30_000

export function useReelAnalyticsTracker() {
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const trackerRef = useRef<ReelPlaybackTracker | null>(null)

  useEffect(() => {
    void reelEventQueue.setAuthenticatedUser(userId).then(() => {
      if (userId) {
        void reelEventQueue.flush()
      }
    })
  }, [userId])

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const isActive = nextState === 'active'
      trackerRef.current?.setAppActive(isActive)
      void reelEventQueue.flush()
    }

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange)
    const networkSubscription = Network.addNetworkStateListener((networkState) => {
      if (networkState.isConnected && networkState.isInternetReachable !== false) {
        void reelEventQueue.flush()
      }
    })
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') {
        void reelEventQueue.flush()
      }
    }, FLUSH_INTERVAL_MS)

    return () => {
      appStateSubscription.remove()
      networkSubscription.remove()
      clearInterval(interval)
    }
  }, [])

  const startReelSession = useCallback(
    ({
      muted,
      recommendation,
      reelId,
      source,
    }: {
      muted: boolean
      recommendation?: RecommendationMetadata
      reelId: string
      source: ReelEventSource
    }) => {
      if (trackerRef.current) {
        return
      }

      try {
        const tracker = new ReelPlaybackTracker({
          muted,
          ...(recommendation ? { recommendation } : {}),
          reelId,
          source,
        })
        trackerRef.current = tracker
        tracker.activate()
      } catch {
        trackerRef.current = null
      }
    },
    [],
  )

  const endCurrentReelSession = useCallback(async (_reason?: string) => {
    trackerRef.current?.finalize()
    trackerRef.current = null
    await reelEventQueue.flush()
  }, [])

  const updateActiveMutedState = useCallback((muted: boolean) => {
    trackerRef.current?.setMuted(muted)
  }, [])

  const updateIntentionalPauseState = useCallback((paused: boolean) => {
    trackerRef.current?.setIntentionalPaused(paused)
  }, [])

  const updatePlaybackProgress = useCallback(
    ({
      currentTime,
      duration,
      isBuffering,
      isPlaying,
    }: {
      currentTime: number
      duration: number
      isBuffering: boolean
      isPlaying: boolean
    }) => {
      trackerRef.current?.onProgress({
        currentTimeMs: Math.max(0, currentTime * 1000),
        durationMs: Math.max(0, duration * 1000),
        isBuffering,
        isPlaying,
      })
    },
    [],
  )

  return {
    endCurrentReelSession,
    flushReelEvents: reelEventQueue.flush.bind(reelEventQueue),
    startReelSession,
    updateActiveMutedState,
    updateIntentionalPauseState,
    updatePlaybackProgress,
  }
}
