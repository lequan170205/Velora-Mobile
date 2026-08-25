import { useCallback } from 'react'
import { AppState, Platform } from 'react-native'

import { useCallStore } from '../../stores/callStore'
import { veloraSystemCalls } from '../systemCalls/veloraSystemCalls'

import {
  CALL_SETUP_CANCELLED_ERROR,
  IOS_AUDIO_SESSION_READY_TIMEOUT_MS,
  IOS_AUDIO_SESSION_SNAPSHOT_POLL_MS,
} from './callConstants'
import { shouldDefaultVideoToSpeaker } from './callPolicies'

import type { AudioSessionConfiguration } from './callPolicies'
import type { CallTelemetrySession } from './callTelemetry'

type MutableRef<T> = { current: T }

export type AudioSessionWaiter = {
  promise: Promise<AudioSessionConfiguration>
  cancel: () => void
}

type NativeAudioSessionRuntimeOptions = {
  audioSessionWaitersRef: MutableRef<Map<string, AudioSessionWaiter>>
  telemetrySessionRef: MutableRef<CallTelemetrySession | null>
  assertCallSetupCurrent: (setupToken: number, callId: string) => void
  isCallSetupCurrent: (setupToken: number, callId: string) => boolean
}

const debugCall = (...args: Parameters<typeof console.warn>) => {
  if (__DEV__) console.warn(...args)
}

export const useNativeAudioSessionRuntime = ({
  audioSessionWaitersRef,
  telemetrySessionRef,
  assertCallSetupCurrent,
  isCallSetupCurrent,
}: NativeAudioSessionRuntimeOptions) => {
  const waitForConfiguredAudioSession = useCallback(
    async (
      setupToken: number,
      callId: string,
      timeoutMs = IOS_AUDIO_SESSION_READY_TIMEOUT_MS,
    ): Promise<AudioSessionConfiguration | undefined> => {
      if (Platform.OS !== 'ios') return

      assertCallSetupCurrent(setupToken, callId)
      const existingWaiter = audioSessionWaitersRef.current.get(callId)
      if (existingWaiter) return existingWaiter.promise

      let cancelWaiter: () => void = () => undefined
      const promise = new Promise<AudioSessionConfiguration>((resolve, reject) => {
        let settled = false
        let configuredSubscription: { remove: () => void } | null = null
        let activatedSubscription: { remove: () => void } | null = null
        let appStateSubscription: { remove: () => void } | null = null
        let timeout: ReturnType<typeof setTimeout> | null = null
        let snapshotPoll: ReturnType<typeof setInterval> | null = null
        let snapshotRequestInFlight = false

        const settle = (configuration?: AudioSessionConfiguration, error?: Error) => {
          if (settled) return
          settled = true
          if (timeout) clearTimeout(timeout)
          if (snapshotPoll) clearInterval(snapshotPoll)
          configuredSubscription?.remove()
          activatedSubscription?.remove()
          appStateSubscription?.remove()

          if (error) {
            reject(error)
            return
          }
          if (!isCallSetupCurrent(setupToken, callId)) {
            reject(new Error(CALL_SETUP_CANCELLED_ERROR))
            return
          }
          resolve(configuration ?? { configured: true })
        }
        cancelWaiter = () => settle(undefined, new Error(CALL_SETUP_CANCELLED_ERROR))

        const loadSnapshot = (source: string) => {
          if (settled || snapshotRequestInFlight) return

          snapshotRequestInFlight = true
          void veloraSystemCalls
            .getNativeAudioSessionState()
            .then((state) => {
              if (settled) return
              debugCall('[Call] audio_snapshot_loaded', JSON.stringify({ callId, source, state }))
              telemetrySessionRef.current?.record('audio_snapshot_loaded', {
                outcome: 'succeeded',
              })
              if (state.errorCode) {
                settle(state, new Error(state.errorCode))
                return
              }
              if (state.isActivated && state.isAudioEnabled) {
                debugCall('[Call] audio_already_active', JSON.stringify({ callId, source }))
                telemetrySessionRef.current?.record('audio_already_active', {
                  outcome: 'succeeded',
                })
                settle(state)
              }
            })
            .catch((error) => {
              if (settled) return
              // PushKit cold starts can expose CallKit audio before the Expo bridge is ready.
              debugCall(
                '[Call] audio_snapshot_load_failed',
                JSON.stringify({ callId, source, error: String(error) }),
              )
              telemetrySessionRef.current?.record('audio_snapshot_loaded', {
                outcome: 'failed',
                error,
              })
            })
            .finally(() => {
              snapshotRequestInFlight = false
            })
        }

        timeout = setTimeout(() => {
          console.warn('[Call] Audio session activation wait timed out')
          settle(undefined, new Error('Audio session activation timed out'))
        }, timeoutMs)

        configuredSubscription = veloraSystemCalls.addAudioSessionConfiguredListener((event) => {
          settle(event, event.errorCode ? new Error(event.errorCode) : undefined)
        })
        activatedSubscription = veloraSystemCalls.addAudioSessionActivatedListener(() => {
          debugCall('[Call] audio_activation_event_received', JSON.stringify({ callId }))
          telemetrySessionRef.current?.record('audio_activation_event_received', {
            outcome: 'succeeded',
          })
          loadSnapshot('activation_event')
        })
        appStateSubscription = AppState.addEventListener('change', (nextState) => {
          if (nextState === 'active') loadSnapshot('app_resume')
        })
        debugCall(
          '[Call] waiting_for_audio_activation',
          JSON.stringify({ callId, timeoutMs, snapshotPollMs: IOS_AUDIO_SESSION_SNAPSHOT_POLL_MS }),
        )
        telemetrySessionRef.current?.record('waiting_for_audio_activation', {
          outcome: 'started',
        })
        loadSnapshot('wait_started')
        snapshotPoll = setInterval(() => loadSnapshot('poll'), IOS_AUDIO_SESSION_SNAPSHOT_POLL_MS)
      })

      const waiter: AudioSessionWaiter = { promise, cancel: cancelWaiter }
      audioSessionWaitersRef.current.set(callId, waiter)
      const removeCurrentWaiter = () => {
        if (audioSessionWaitersRef.current.get(callId) === waiter) {
          audioSessionWaitersRef.current.delete(callId)
        }
      }
      void promise.then(
        () => removeCurrentWaiter(),
        () => removeCurrentWaiter(),
      )
      return promise
    },
    [assertCallSetupCurrent, audioSessionWaitersRef, isCallSetupCurrent, telemetrySessionRef],
  )

  const cancelAudioSessionWait = useCallback(
    (callId: string) => {
      const waiter = audioSessionWaitersRef.current.get(callId)
      if (!waiter) return
      audioSessionWaitersRef.current.delete(callId)
      waiter.cancel()
    },
    [audioSessionWaitersRef],
  )

  const cancelAllAudioSessionWaits = useCallback(() => {
    const waiters = [...audioSessionWaitersRef.current.values()]
    audioSessionWaitersRef.current.clear()
    waiters.forEach((waiter) => waiter.cancel())
  }, [audioSessionWaitersRef])

  const enableDefaultVideoSpeaker = useCallback((configuration?: AudioSessionConfiguration) => {
    if (!shouldDefaultVideoToSpeaker(configuration)) return
    if (veloraSystemCalls.setSpeakerEnabled(true)) {
      useCallStore.getState().patch({ speakerEnabled: true })
    }
  }, [])

  const toggleSpeaker = useCallback(() => {
    const state = useCallStore.getState()
    if (state.phase !== 'active') return
    const nextSpeakerEnabled = !state.speakerEnabled
    if (!veloraSystemCalls.setSpeakerEnabled(nextSpeakerEnabled)) {
      console.warn('[Call] Failed to change speaker route')
      return
    }
    state.patch({ speakerEnabled: nextSpeakerEnabled })
  }, [])

  return {
    waitForConfiguredAudioSession,
    cancelAudioSessionWait,
    cancelAllAudioSessionWaits,
    enableDefaultVideoSpeaker,
    toggleSpeaker,
  }
}
