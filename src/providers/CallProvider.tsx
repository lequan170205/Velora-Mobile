import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { AppState, Platform } from 'react-native'
import { mediaDevices } from 'react-native-webrtc'

import {
  ATOMIC_INCOMING_CALL_ACCEPT_ENABLED,
  CALL_JOINED_TIMEOUT_MS,
  CALL_SETUP_CANCELLED_ERROR,
  getOutgoingRingWaitTimeoutMs,
  INCOMING_ACCEPT_ACK_TIMEOUT_MS,
  INCOMING_ACCEPT_MAX_ATTEMPTS,
  INCOMING_ACCEPT_RETRY_DELAY_MS,
  PEER_LEFT_GRACE_MS,
  RECONNECT_RECOVERY_TIMEOUT_MS,
  REMOTE_AUDIO_WAIT_FALLBACK_MS,
  RTC_QUALITY_SAMPLE_INTERVAL_MS,
  SOCKET_DISCONNECT_GRACE_MS,
} from '../lib/call/callConstants'
import {
  cameraConstraints,
  getAcceptIncomingCallFailureCode,
  getCallEndedMessage,
  getCallRejectedMessage,
  getPeerInfoFromConversation,
  getRemoteSetupFailureReason,
  isBusyPhase,
  isCallSetupCancelledError,
  toAudioRouteTelemetry,
  toNativeIncomingCallPayload,
} from '../lib/call/callPolicies'
import {
  clearTimeoutMap,
  clearTimeoutMapEntry,
  clearTimeoutRef,
} from '../lib/call/callRuntimeCleanup'
import {
  clearPrewarmedCallSocketCredentials,
  clearWaitRegistry,
  createCallSocket,
  emitAndWaitForEvent,
  isCallWaitCancelledError,
  type CallWaitRegistry,
  waitForEventWhere,
} from '../lib/call/callSocket'
import { CallTelemetrySession, flushCallTelemetry } from '../lib/call/callTelemetry'
import { type RtcQualityCounters, type RtcQualityStreak } from '../lib/call/rtcStats'
import { useCallLocalMediaRuntime } from '../lib/call/useCallLocalMediaRuntime'
import { useCallMediaTransportRuntime } from '../lib/call/useCallMediaTransportRuntime'
import { useCallQualityRuntime } from '../lib/call/useCallQualityRuntime'
import { useCallRecoveryRuntime } from '../lib/call/useCallRecoveryRuntime'
import { useCallSocketRuntime } from '../lib/call/useCallSocketRuntime'
import {
  useNativeAudioSessionRuntime,
  type AudioSessionWaiter,
} from '../lib/call/useNativeAudioSessionRuntime'
import { useNativeCallActions } from '../lib/call/useNativeCallActions'
import {
  veloraSystemCalls,
  type AudioSessionActivatedEvent,
  type AudioSessionConfiguredEvent,
  type NativeCallPayload,
} from '../lib/systemCalls/veloraSystemCalls'
import { useAuthStore } from '../stores/authStore'
import { useCallStore } from '../stores/callStore'

import type { CallStateResponse } from '../api/call.api'
import type { CallLifecycleTerminalState } from '../lib/call/callLifecycle'
// VIDEO_CALL_1TO1_PROVIDER_PATCH
import type {
  AudioBitrateProfile,
  CallAnsweredPayload,
  CallEndedPayload,
  CallJoinedPayload,
  CallSocketReadyPayload,
  CallRejectedPayload,
  CallSocket,
  CallType,
  CallTypeChangedPayload,
  IncomingCallPayload,
  IncomingCallAcceptancePayload,
  NewProducerPayload,
  PeerLeftPayload,
  ProducerClosedPayload,
  StartCallInput,
  UseCallValue,
  VideoStateChangedPayload,
} from '../types/call.types'
import type { Device as MediasoupDevice } from 'mediasoup-client'
import type * as MediasoupTypes from 'mediasoup-client/types'
import type { MediaStreamTrack, MediaStream } from 'react-native-webrtc'

type CachedMediasoupDevice = {
  device: MediasoupDevice
  rtpCapabilitiesKey: string
}

const debugCall = (...args: Parameters<typeof console.warn>) => {
  if (__DEV__) {
    console.warn(...args)
  }
}

const CALL_ACCOUNT_CHANGED_ERROR = 'call_account_changed'

const terminalLifecycleStateFor = (
  reason: string,
  options?: { telemetryError?: unknown; telemetryErrorCode?: string },
): CallLifecycleTerminalState => {
  const signal = `${reason} ${options?.telemetryErrorCode ?? ''}`.toLowerCase()

  if (signal.includes('answered_elsewhere')) return 'answered_elsewhere'
  if (signal.includes('cancel')) return 'cancelled'
  if (
    signal.includes('reject') ||
    signal.includes('declin') ||
    signal.includes('busy') ||
    signal.includes('permission_denied')
  ) {
    return 'rejected'
  }
  if (signal.includes('expire') || signal.includes('no_answer') || signal.includes('timeout')) {
    return 'expired'
  }
  if (
    options?.telemetryError ||
    signal.includes('fail') ||
    signal.includes('error') ||
    signal.includes('disconnect') ||
    signal.includes('media_unavailable') ||
    signal.includes('unauthorized') ||
    signal.includes('auth_lost')
  ) {
    return 'failed'
  }

  return 'ended'
}

const CallContext = createContext<UseCallValue>({
  startVoiceCall: async () => {},
  startVideoCall: async () => {},
  acceptIncomingCall: async () => {},
  rejectIncomingCall: async () => {},
  endCall: async () => {},
  toggleMute: () => {},
  toggleSpeaker: () => {},
  toggleCamera: async () => {},
  switchCamera: async () => {},
  switchCallType: async () => {},
  recordCallScreenVisible: () => {},
  dismissCallError: () => {},
})

export const useCall = () => useContext(CallContext)

export function CallProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { isAuthenticated, isLoading, user } = useAuthStore()
  const currentUserId = user?.id ?? null
  const callPhase = useCallStore((state) => state.phase)
  const callId = useCallStore((state) => state.callId)

  const socketRef = useRef<CallSocket | null>(null)
  const waitRegistryRef = useRef<CallWaitRegistry>(new Set())
  const deviceRef = useRef<MediasoupDevice | null>(null)
  const sendTransportRef = useRef<MediasoupTypes.Transport<Record<string, unknown>> | null>(null)
  const recvTransportRef = useRef<MediasoupTypes.Transport<Record<string, unknown>> | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const ringingPreviewStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const audioProducerRef = useRef<MediasoupTypes.Producer<Record<string, unknown>> | null>(null)
  const videoProducerRef = useRef<MediasoupTypes.Producer<Record<string, unknown>> | null>(null)
  const cachedDeviceRef = useRef<CachedMediasoupDevice | null>(null)
  const consumerMapRef = useRef<Map<string, MediasoupTypes.Consumer<Record<string, unknown>>>>(
    new Map(),
  )
  const connectedTransportIdsRef = useRef<Set<string>>(new Set())
  const queuedRemoteProducerMapRef = useRef<Map<string, NewProducerPayload>>(new Map())
  const handledRemoteProducerIdsRef = useRef<Set<string>>(new Set())
  const remoteVideoEnabledByProducerRef = useRef<Map<string, boolean>>(new Map())
  const consumingProducerIdsRef = useRef<Set<string>>(new Set())
  const retryingProducerIdsRef = useRef<Set<string>>(new Set())
  const activeCallIdRef = useRef<string | null>(null)
  const telemetrySessionRef = useRef<CallTelemetrySession | null>(null)
  const rtcQualityCountersRef = useRef<RtcQualityCounters | null>(null)
  const rtcQualityStreakRef = useRef<RtcQualityStreak>({ degraded: 0, healthy: 0 })
  const callScreenTelemetryCallIdsRef = useRef<Set<string>>(new Set())
  const prewarmCredentialOwnerRef = useRef<string | null>(currentUserId)
  const incomingAudioBitrateProfileRef = useRef<AudioBitrateProfile>('normal')
  const incomingAudioBitrateUpdateInFlightRef = useRef(false)
  const incomingAudioBitrateRetryAfterMsRef = useRef(0)
  const audioFlowingRef = useRef(false)
  const audioFlowConfirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callSetupGenerationRef = useRef(0)
  const incomingAnswerActionRef = useRef<{ callId: string; actionId: string } | null>(null)
  const outgoingStartInFlightRef = useRef(false)
  const teardownInProgressRef = useRef(false)
  const callAnsweredRef = useRef(false)
  const routerRtpCapabilitiesRef = useRef<Record<string, unknown> | null>(null)
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeAtMsRef = useRef<number | null>(null)
  const remoteAudioFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const peerLeftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectRecoveryInFlightRef = useRef(false)
  const reconnectModeRef = useRef<'local' | 'peer' | null>(null)
  const nativeActionRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const socketDisconnectGraceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mediaTransportDisconnectTimeoutsRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  )
  const mediaTransportStateHandlerRef = useRef<
    ((payload: { callId: string; transportId: string; state: string }) => void) | null
  >(null)
  const processingNativeActionIdsRef = useRef(new Set<string>())
  const completedNativeActionIdsRef = useRef(new Set<string>())
  const audioSessionWaitersRef = useRef(new Map<string, AudioSessionWaiter>())
  const acceptingIncomingCallIdRef = useRef<string | null>(null)
  const authRestorePromiseRef = useRef<Promise<void> | null>(null)
  const socketConnectPromiseRef = useRef<Promise<CallSocket> | null>(null)
  const callSocketPromisesRef = useRef(new Map<string, Promise<CallSocket>>())
  const callSocketAuthenticatedRef = useRef(false)
  const cameraPausedByBackgroundRef = useRef(false)
  const lastAppStateRef = useRef(AppState.currentState)

  const clearNativeActionRetryTimeout = useCallback(() => {
    clearTimeoutRef(nativeActionRetryTimeoutRef)
  }, [])

  const clearSocketDisconnectGraceTimeout = useCallback(() => {
    clearTimeoutRef(socketDisconnectGraceTimeoutRef)
  }, [])

  const clearMediaTransportDisconnectTimeout = useCallback((transportId: string) => {
    clearTimeoutMapEntry(mediaTransportDisconnectTimeoutsRef.current, transportId)
  }, [])

  const clearMediaTransportDisconnectTimeouts = useCallback(() => {
    clearTimeoutMap(mediaTransportDisconnectTimeoutsRef.current)
  }, [])

  const beginCallSetup = useCallback(() => {
    callSetupGenerationRef.current += 1
    return callSetupGenerationRef.current
  }, [])

  const invalidateCallSetup = useCallback(() => {
    callSetupGenerationRef.current += 1
  }, [])

  const isCallSetupCurrent = useCallback((setupToken: number, expectedCallId: string) => {
    const currentCallId = activeCallIdRef.current ?? useCallStore.getState().callId

    return (
      setupToken === callSetupGenerationRef.current &&
      currentCallId === expectedCallId &&
      useCallStore.getState().callId === expectedCallId
    )
  }, [])

  const assertCallSetupCurrent = useCallback(
    (setupToken: number, expectedCallId: string) => {
      if (!isCallSetupCurrent(setupToken, expectedCallId)) {
        throw new Error(CALL_SETUP_CANCELLED_ERROR)
      }
    },
    [isCallSetupCurrent],
  )

  const isCurrentCallAccount = useCallback(() => {
    const auth = useAuthStore.getState()

    return Boolean(currentUserId && auth.isAuthenticated && auth.user?.id === currentUserId)
  }, [currentUserId])

  const {
    waitForConfiguredAudioSession,
    cancelAudioSessionWait,
    cancelAllAudioSessionWaits,
    enableDefaultVideoSpeaker,
    toggleSpeaker,
  } = useNativeAudioSessionRuntime({
    audioSessionWaitersRef,
    telemetrySessionRef,
    assertCallSetupCurrent,
    isCallSetupCurrent,
  })

  const getCurrentCallId = useCallback(
    () => activeCallIdRef.current ?? useCallStore.getState().callId,
    [],
  )

  const isCurrentCall = useCallback(
    (payloadCallId: string) => payloadCallId === getCurrentCallId(),
    [getCurrentCallId],
  )

  const stopTimer = useCallback((options?: { resetDuration?: boolean }) => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current)
      timerIntervalRef.current = null
    }

    activeAtMsRef.current = null
    if (options?.resetDuration !== false) {
      useCallStore.getState().setDurationSec(0)
    }
  }, [])

  const startTimer = useCallback(
    (initialDurationSec = 0) => {
      stopTimer()
      activeAtMsRef.current = Date.now() - initialDurationSec * 1000
      useCallStore.getState().setDurationSec(initialDurationSec)

      timerIntervalRef.current = setInterval(() => {
        const startedAtMs = activeAtMsRef.current
        if (!startedAtMs) {
          return
        }

        useCallStore
          .getState()
          .setDurationSec(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)))
      }, 1000)
    },
    [stopTimer],
  )

  const clearRemoteAudioFallback = useCallback(() => {
    clearTimeoutRef(remoteAudioFallbackTimeoutRef)
  }, [])

  const clearAudioFlowConfirmation = useCallback(() => {
    clearTimeoutRef(audioFlowConfirmationTimeoutRef)
  }, [])

  const { scheduleRtcStatsLog, sampleRtcQuality, confirmAudioFlow } = useCallQualityRuntime({
    socketRef,
    recvTransportRef,
    connectedTransportIdsRef,
    waitRegistryRef,
    telemetrySessionRef,
    consumerMapRef,
    rtcQualityCountersRef,
    rtcQualityStreakRef,
    incomingAudioBitrateProfileRef,
    incomingAudioBitrateUpdateInFlightRef,
    incomingAudioBitrateRetryAfterMsRef,
    audioFlowingRef,
    audioFlowConfirmationTimeoutRef,
    activeCallIdRef,
    clearAudioFlowConfirmation,
  })

  const clearPeerLeftFallback = useCallback(() => {
    clearTimeoutRef(peerLeftTimeoutRef)
  }, [])

  const clearReconnectTimeout = useCallback(() => {
    clearTimeoutRef(reconnectTimeoutRef)
  }, [])

  const armRemoteAudioFallback = useCallback(() => {
    clearRemoteAudioFallback()
    remoteAudioFallbackTimeoutRef.current = setTimeout(() => {
      const state = useCallStore.getState()
      if (state.phase === 'active' && state.remoteAudioState !== 'connected') {
        useCallStore.getState().patch({ remoteAudioState: 'waiting' })
      }
    }, REMOTE_AUDIO_WAIT_FALLBACK_MS)
  }, [clearRemoteAudioFallback])

  const presentError = useCallback((message: string) => {
    useCallStore.getState().patch({ error: message })
  }, [])

  const resetRuntimeRefs = useCallback(
    (options?: { preserveActiveCall?: boolean }) => {
      clearAudioFlowConfirmation()
      clearRemoteAudioFallback()
      clearPeerLeftFallback()
      clearReconnectTimeout()
      clearMediaTransportDisconnectTimeouts()
      clearWaitRegistry(waitRegistryRef.current)
      connectedTransportIdsRef.current.clear()
      queuedRemoteProducerMapRef.current.clear()
      handledRemoteProducerIdsRef.current.clear()
      remoteVideoEnabledByProducerRef.current.clear()
      consumingProducerIdsRef.current.clear()
      retryingProducerIdsRef.current.clear()
      audioFlowingRef.current = false
      rtcQualityCountersRef.current = null
      rtcQualityStreakRef.current = { degraded: 0, healthy: 0 }
      incomingAudioBitrateProfileRef.current = 'normal'
      incomingAudioBitrateUpdateInFlightRef.current = false
      incomingAudioBitrateRetryAfterMsRef.current = 0
      consumerMapRef.current.clear()
      deviceRef.current = null
      sendTransportRef.current = null
      recvTransportRef.current = null
      localStreamRef.current = null
      ringingPreviewStreamRef.current = null
      remoteStreamRef.current = null
      audioProducerRef.current = null
      videoProducerRef.current = null
      cameraPausedByBackgroundRef.current = false
      routerRtpCapabilitiesRef.current = null
      reconnectRecoveryInFlightRef.current = false
      reconnectModeRef.current = null

      if (!options?.preserveActiveCall) {
        activeCallIdRef.current = null
        callAnsweredRef.current = false
        incomingAnswerActionRef.current = null
      }
    },
    [
      clearAudioFlowConfirmation,
      clearMediaTransportDisconnectTimeouts,
      clearPeerLeftFallback,
      clearReconnectTimeout,
      clearRemoteAudioFallback,
    ],
  )

  const disposeMediaRuntime = useCallback(
    (options?: { preserveActiveCall?: boolean }) => {
      const currentConsumers = [...consumerMapRef.current.values()]
      const currentAudioProducer = audioProducerRef.current
      const currentVideoProducer = videoProducerRef.current
      const currentPreviewStream = ringingPreviewStreamRef.current
      const currentSendTransport = sendTransportRef.current
      const currentRecvTransport = recvTransportRef.current
      const localStream = localStreamRef.current
      const remoteStream = remoteStreamRef.current

      currentConsumers.forEach((consumer) => {
        try {
          consumer.close()
        } catch {
          console.warn('[Call] Failed to close consumer during teardown')
        }
      })

      for (const producer of [currentAudioProducer, currentVideoProducer]) {
        if (!producer) continue
        try {
          producer.close()
        } catch {
          console.warn('[Call] Failed to close producer during teardown')
        }
      }

      if (currentSendTransport) {
        try {
          currentSendTransport.close()
        } catch {
          console.warn('[Call] Failed to close send transport during teardown')
        }
      }

      if (currentRecvTransport) {
        try {
          currentRecvTransport.close()
        } catch {
          console.warn('[Call] Failed to close recv transport during teardown')
        }
      }

      localStream?.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          console.warn('[Call] Failed to stop local track during teardown')
        }
      })
      currentPreviewStream?.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          console.warn('[Call] Failed to stop camera preview during teardown')
        }
      })

      remoteStream?.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          console.warn('[Call] Failed to stop remote track during teardown')
        }
      })

      resetRuntimeRefs(options)
    },
    [resetRuntimeRefs],
  )

  const resetRemoteConsumerRuntime = useCallback(() => {
    const currentConsumers = [...consumerMapRef.current.values()]
    const remoteStream = remoteStreamRef.current

    currentConsumers.forEach((consumer) => {
      try {
        consumer.close()
      } catch {
        console.warn('[Call] Failed to close remote consumer during peer reconnect cleanup')
      }
    })

    remoteStream?.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        console.warn('[Call] Failed to stop remote track during peer reconnect cleanup')
      }
    })

    consumerMapRef.current.clear()
    handledRemoteProducerIdsRef.current.clear()
    consumingProducerIdsRef.current.clear()
    retryingProducerIdsRef.current.clear()
    queuedRemoteProducerMapRef.current.clear()
    remoteStreamRef.current = null
    useCallStore.getState().patch({
      remoteStreamUrl: null,
      remoteVideoState: useCallStore.getState().callType === 'VIDEO' ? 'waiting' : 'idle',
    })
  }, [])

  const teardownOnce = useCallback(
    async (
      reason: string,
      options?: {
        errorMessage?: string | null
        telemetryError?: unknown
        telemetryErrorCode?: string
      },
    ) => {
      if (teardownInProgressRef.current) {
        return
      }

      teardownInProgressRef.current = true
      invalidateCallSetup()
      clearSocketDisconnectGraceTimeout()
      const endingCallId = activeCallIdRef.current ?? useCallStore.getState().callId
      debugCall(
        '[Call] teardown_requested',
        JSON.stringify({
          callId: endingCallId,
          source: reason,
          reason: options?.telemetryErrorCode ?? reason,
        }),
      )
      telemetrySessionRef.current?.record('teardown_requested', {
        outcome: 'started',
        ...(options?.telemetryErrorCode ? { errorCode: options.telemetryErrorCode } : {}),
      })
      const terminalLifecycleState = terminalLifecycleStateFor(reason, options)
      telemetrySessionRef.current?.recordLifecycle(terminalLifecycleState, {
        eventType: 'terminal',
        outcome: terminalLifecycleState === 'failed' ? 'failed' : 'ended',
        ...(options?.telemetryErrorCode ? { errorCode: options.telemetryErrorCode } : {}),
      })
      telemetrySessionRef.current?.terminal(
        reason,
        options?.telemetryError ??
          (options?.errorMessage ? new Error(options.errorMessage) : undefined),
        options?.telemetryErrorCode,
      )
      telemetrySessionRef.current = null
      rtcQualityCountersRef.current = null
      if (acceptingIncomingCallIdRef.current === endingCallId) {
        acceptingIncomingCallIdRef.current = null
      }
      if (incomingAnswerActionRef.current?.callId === endingCallId) {
        incomingAnswerActionRef.current = null
      }
      if (endingCallId) {
        cancelAudioSessionWait(endingCallId)
        callScreenTelemetryCallIdsRef.current.delete(endingCallId)
      }
      stopTimer()
      if (endingCallId) {
        if (terminalLifecycleState === 'failed') {
          void veloraSystemCalls.reportCallFailed(endingCallId)
        } else {
          void veloraSystemCalls.endCall(endingCallId)
        }
      }
      disposeMediaRuntime()
      useCallStore.getState().reset()

      if (options?.errorMessage) {
        useCallStore.getState().patch({ error: options.errorMessage })
      }

      teardownInProgressRef.current = false
      debugCall(`[Call] Teardown completed (${reason})`)
    },
    [
      cancelAudioSessionWait,
      callScreenTelemetryCallIdsRef,
      clearSocketDisconnectGraceTimeout,
      disposeMediaRuntime,
      invalidateCallSetup,
      stopTimer,
    ],
  )

  const teardownRecoveryFailure = useCallback(
    async (reason: string) => {
      const socket = socketRef.current
      const callId = activeCallIdRef.current ?? useCallStore.getState().callId

      if (socket?.connected && callId) {
        socket.emit('leave_call', {
          callId,
          reason: 'disconnected',
        })
      }

      await teardownOnce(reason, {
        errorMessage: 'Call connection was lost',
      })
    },
    [teardownOnce],
  )

  const leaveCallFromLifecycle = useCallback(
    async (reason: string) => {
      const state = useCallStore.getState()
      if (!['active', 'reconnecting'].includes(state.phase) || !state.callId) {
        return
      }

      const socket = socketRef.current
      if (socket?.connected) {
        socket.emit('leave_call', {
          callId: state.callId,
          reason,
        })
      }

      await teardownOnce(`lifecycle_${reason}`)
    },
    [teardownOnce],
  )

  const armReconnectTimeout = useCallback(
    (reason: string, timeoutMs = RECONNECT_RECOVERY_TIMEOUT_MS) => {
      clearReconnectTimeout()
      reconnectTimeoutRef.current = setTimeout(() => {
        void teardownRecoveryFailure(reason)
      }, timeoutMs)
    },
    [clearReconnectTimeout, teardownRecoveryFailure],
  )

  const {
    ensureMicPermission,
    ensureCameraPermission,
    stopRingingPreview,
    emitLocalVideoState,
    deactivateLocalVideo,
    activateLocalVideo,
    clearRemoteVideoRuntime,
    toggleMute,
    toggleCamera,
    switchCamera,
  } = useCallLocalMediaRuntime({
    socketRef,
    deviceRef,
    sendTransportRef,
    localStreamRef,
    ringingPreviewStreamRef,
    remoteStreamRef,
    videoProducerRef,
    consumerMapRef,
    handledRemoteProducerIdsRef,
    cameraPausedByBackgroundRef,
    callSetupGenerationRef,
    isCallSetupCurrent,
    presentError,
  })

  const handleTerminalCall = useCallback(
    (payload: CallEndedPayload, source: 'live' | 'socket_ready_replay') => {
      // A PushKit cold launch can have a native CallKit call even while the JS call store
      // is still idle. Always end the native system call by callId before checking JS state.
      veloraSystemCalls.dismissIncomingCall(payload.callId)

      if (!isCurrentCall(payload.callId)) {
        debugCall(
          '[Call] terminal_call_dismissed_without_js_state',
          JSON.stringify({ callId: payload.callId, reason: payload.reason, source }),
        )
        return
      }

      clearPeerLeftFallback()
      const state = useCallStore.getState()
      void teardownOnce(source === 'live' ? 'call_ended' : 'call_ended_replayed', {
        errorMessage: getCallEndedMessage(payload, state),
        telemetryErrorCode: payload.reason,
      })
    },
    [clearPeerLeftFallback, isCurrentCall, teardownOnce],
  )

  const { ensureCallSocketConnected, ensureSocketConnected, restorePreActiveCallMembership } =
    useCallSocketRuntime({
      socketRef,
      waitRegistryRef,
      activeCallIdRef,
      telemetrySessionRef,
      acceptingIncomingCallIdRef,
      authRestorePromiseRef,
      socketConnectPromiseRef,
      callSocketPromisesRef,
      callSocketAuthenticatedRef,
      handleTerminalCall,
    })

  const { consumeRemoteProducer, postAnswerSetup } = useCallMediaTransportRuntime({
    currentUserId,
    socketRef,
    waitRegistryRef,
    deviceRef,
    sendTransportRef,
    recvTransportRef,
    localStreamRef,
    remoteStreamRef,
    audioProducerRef,
    videoProducerRef,
    cachedDeviceRef,
    consumerMapRef,
    connectedTransportIdsRef,
    queuedRemoteProducerMapRef,
    handledRemoteProducerIdsRef,
    remoteVideoEnabledByProducerRef,
    consumingProducerIdsRef,
    retryingProducerIdsRef,
    routerRtpCapabilitiesRef,
    reconnectModeRef,
    cameraPausedByBackgroundRef,
    telemetrySessionRef,
    callAnsweredRef,
    callSetupGenerationRef,
    mediaTransportStateHandlerRef,
    getCurrentCallId,
    assertCallSetupCurrent,
    isCallSetupCurrent,
    clearReconnectTimeout,
    clearRemoteAudioFallback,
    confirmAudioFlow,
    scheduleRtcStatsLog,
    startTimer,
    teardownOnce,
    stopRingingPreview,
    armRemoteAudioFallback,
  })

  const {
    recoverActiveCall,
    beginReconnectRecovery,
    handleMediaTransportStateChange,
    handlePeerReconnecting,
    handlePeerReconnected,
  } = useCallRecoveryRuntime({
    isAuthenticated,
    currentUserId,
    socketRef,
    waitRegistryRef,
    sendTransportRef,
    recvTransportRef,
    videoProducerRef,
    connectedTransportIdsRef,
    activeCallIdRef,
    callAnsweredRef,
    telemetrySessionRef,
    reconnectRecoveryInFlightRef,
    reconnectModeRef,
    teardownInProgressRef,
    mediaTransportDisconnectTimeoutsRef,
    activateLocalVideo,
    deactivateLocalVideo,
    clearRemoteVideoRuntime,
    consumeRemoteProducer,
    invalidateCallSetup,
    disposeMediaRuntime,
    beginCallSetup,
    postAnswerSetup,
    assertCallSetupCurrent,
    clearReconnectTimeout,
    startTimer,
    markNativeCallActive: (callId) => veloraSystemCalls.setCallActive(callId),
    armReconnectTimeout,
    teardownRecoveryFailure,
    stopTimer,
    isCurrentCall,
    clearMediaTransportDisconnectTimeout,
    clearRemoteAudioFallback,
    resetRemoteConsumerRuntime,
  })

  useEffect(() => {
    mediaTransportStateHandlerRef.current = handleMediaTransportStateChange

    return () => {
      if (mediaTransportStateHandlerRef.current === handleMediaTransportStateChange) {
        mediaTransportStateHandlerRef.current = null
      }
    }
  }, [handleMediaTransportStateChange])

  const rejectIncomingCall = useCallback(async () => {
    const state = useCallStore.getState()
    const callId = state.callId
    let socket = socketRef.current

    if (!socket?.connected && callId) {
      try {
        socket = await ensureCallSocketConnected(callId)
      } catch {
        socket = null
      }
    }

    if (socket?.connected && callId) {
      socket.emit('reject_call', {
        callId,
      })
    }

    if (callId) {
      veloraSystemCalls.dismissIncomingCall(callId)
    }
    if (!callId || !isCurrentCall(callId)) return
    await teardownOnce('reject_incoming_call')
  }, [ensureCallSocketConnected, isCurrentCall, teardownOnce])

  const emitIncomingAcceptTerminalIntent = useCallback(
    (socket: CallSocket, callId: string, reason?: string) => {
      // `leave_call` is only authorized once the accepting transition has
      // added this callee to the session. Send the terminal reject as well so
      // the request wins when it races before that mutation; if activation won
      // first, the leave command ends the now-active call.
      socket.emit('reject_call', {
        callId,
        reason: reason ?? 'cancelled',
      })
      socket.emit('leave_call', {
        callId,
        ...(reason ? { reason } : {}),
      })
    },
    [],
  )

  const endCall = useCallback(
    async (reason?: string) => {
      const socket = socketRef.current
      const state = useCallStore.getState()
      const callId = state.callId

      if (!callId) {
        return
      }

      useCallStore.getState().patch({ phase: 'ending' })
      const wasAcceptingIncomingCall = acceptingIncomingCallIdRef.current === callId
      const emitServerEndIntent = (connectedSocket: CallSocket) => {
        if (wasAcceptingIncomingCall) {
          emitIncomingAcceptTerminalIntent(connectedSocket, callId, reason)
          return
        }
        connectedSocket.emit('leave_call', {
          callId,
          ...(reason ? { reason } : {}),
        })
      }

      if (socket?.connected) {
        emitServerEndIntent(socket)
      } else if (wasAcceptingIncomingCall) {
        // A local End must still win if it happens while the cold-path socket
        // connection is pending. Capture the accepting state before teardown,
        // then send both terminal intents once the authenticated socket exists.
        void ensureCallSocketConnected(callId)
          .then((connectedSocket) => {
            if (useAuthStore.getState().user?.id !== currentUserId) return
            emitServerEndIntent(connectedSocket)
          })
          .catch(() => undefined)
      }

      await teardownOnce('end_call')
    },
    [currentUserId, emitIncomingAcceptTerminalIntent, ensureCallSocketConnected, teardownOnce],
  )

  const recordCallScreenVisible = useCallback((visibleCallId: string) => {
    const activeCallId = activeCallIdRef.current ?? useCallStore.getState().callId
    if (
      activeCallId !== visibleCallId ||
      callScreenTelemetryCallIdsRef.current.has(visibleCallId)
    ) {
      return
    }

    callScreenTelemetryCallIdsRef.current.add(visibleCallId)
    telemetrySessionRef.current?.record('call_screen_visible', { outcome: 'succeeded' })
  }, [])

  const handleIncomingCall = useCallback(
    async (payload: IncomingCallPayload) => {
      if (!currentUserId) {
        return
      }

      const currentState = useCallStore.getState()

      if (currentState.callId === payload.callId) {
        return
      }

      if (outgoingStartInFlightRef.current || isBusyPhase(currentState.phase)) {
        socketRef.current?.emit('reject_call', {
          callId: payload.callId,
          reason: 'busy',
        })
        return
      }

      const peerInfo = getPeerInfoFromConversation({
        conversationId: payload.conversationId,
        currentUserId,
        fallbackPeerUserId: payload.initiatorId,
        queryClient,
      })
      const nativePayload = toNativeIncomingCallPayload(payload)

      activeCallIdRef.current = payload.callId
      callAnsweredRef.current = false
      routerRtpCapabilitiesRef.current = null
      useCallStore.getState().patch({
        phase: 'incoming_ringing',
        direction: 'incoming',
        callId: payload.callId,
        conversationId: payload.conversationId,
        peerUserId: peerInfo.peerUserId,
        peerName: payload.initiatorDisplayName || peerInfo.peerName || 'Unknown',
        peerAvatarUrl: payload.initiatorAvatarUrl ?? peerInfo.peerAvatarUrl,
        callType: payload.callType,
        muted: false,
        cameraEnabled: false,
        cameraFacing: 'user',
        remoteAudioState: 'idle',
        remoteVideoState: payload.callType === 'VIDEO' ? 'waiting' : 'idle',
        localStreamUrl: null,
        remoteStreamUrl: null,
        reconnectDeadlineMs: null,
        error: null,
        durationSec: 0,
      })
      void veloraSystemCalls.presentIncomingCall(nativePayload)
    },
    [currentUserId, queryClient],
  )

  const prepareIncomingCallFromPayload = useCallback(
    (callState: CallStateResponse | IncomingCallPayload | NativeCallPayload) => {
      if (!currentUserId) {
        return false
      }

      const peerInfo = getPeerInfoFromConversation({
        conversationId: callState.conversationId,
        currentUserId,
        fallbackPeerUserId: callState.initiatorId,
        queryClient,
      })

      activeCallIdRef.current = callState.callId
      callAnsweredRef.current = false
      routerRtpCapabilitiesRef.current = null
      useCallStore.getState().patch({
        phase: 'incoming_ringing',
        direction: 'incoming',
        callId: callState.callId,
        conversationId: callState.conversationId,
        peerUserId: peerInfo.peerUserId,
        peerName: callState.initiatorDisplayName || peerInfo.peerName || 'Unknown',
        peerAvatarUrl: callState.initiatorAvatarUrl ?? peerInfo.peerAvatarUrl,
        callType: callState.callType,
        muted: false,
        cameraEnabled: false,
        cameraFacing: 'user',
        remoteAudioState: 'idle',
        remoteVideoState: callState.callType === 'VIDEO' ? 'waiting' : 'idle',
        localStreamUrl: null,
        remoteStreamUrl: null,
        reconnectDeadlineMs: null,
        error: null,
        durationSec: 0,
      })

      return true
    },
    [currentUserId, queryClient],
  )

  const prepareIncomingCallFromState = useCallback(
    (callState: CallStateResponse) => prepareIncomingCallFromPayload(callState),
    [prepareIncomingCallFromPayload],
  )

  const resumeAcceptedCall = useCallback(
    async (callState: CallStateResponse) => {
      if (callState.status !== 'active' || !prepareIncomingCallFromState(callState)) {
        return false
      }

      const resumedCallId = callState.callId
      const telemetry = new CallTelemetrySession('incoming')
      telemetrySessionRef.current = telemetry
      telemetry.record('call_recovery_started', { outcome: 'started' })
      telemetry.recordLifecycle('active', { outcome: 'succeeded' })

      useCallStore.getState().patch({
        phase: 'reconnecting',
        reconnectDeadlineMs: Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS,
      })
      // A cold-start resume has no prior socket lifecycle to arm recovery for
      // us. Mark it as a local recovery and give it the same bounded window as
      // a live reconnect so a lost rejoin acknowledgement cannot leave CallKit
      // active indefinitely.
      reconnectModeRef.current = 'local'
      armReconnectTimeout('native_resume_timeout')
      router.replace(`/call/${resumedCallId}` as never)

      try {
        const setupToken = beginCallSetup()
        await ensureCallSocketConnected(resumedCallId)
        assertCallSetupCurrent(setupToken, resumedCallId)
        await waitForConfiguredAudioSession(setupToken, resumedCallId)
        assertCallSetupCurrent(setupToken, resumedCallId)
        await recoverActiveCall()

        const resumedState = useCallStore.getState()
        return resumedState.callId === resumedCallId && resumedState.phase === 'active'
      } catch (error) {
        if (isCurrentCall(resumedCallId)) {
          await teardownRecoveryFailure('native_resume_failed')
        }
        return false
      }
    },
    [
      assertCallSetupCurrent,
      armReconnectTimeout,
      beginCallSetup,
      ensureCallSocketConnected,
      isCurrentCall,
      prepareIncomingCallFromState,
      reconnectModeRef,
      recoverActiveCall,
      router,
      teardownRecoveryFailure,
      waitForConfiguredAudioSession,
    ],
  )

  const acceptIncomingCall = useCallback(
    async (source: 'native' | 'ui' = 'ui', actionId?: string) => {
      const state = useCallStore.getState()
      let socket = socketRef.current
      const callId = state.callId

      if (!callId) {
        return
      }

      if (acceptingIncomingCallIdRef.current === callId) {
        return
      }

      const existingAction = incomingAnswerActionRef.current
      const incomingActionId =
        actionId ??
        (existingAction?.callId === callId
          ? existingAction.actionId
          : `ui:${Date.now()}:${Math.random().toString(36).slice(2)}`)
      incomingAnswerActionRef.current = { callId, actionId: incomingActionId }
      let nativeAnswerCompleted = false
      const completeNativeAnswer = (success: boolean, reason?: string) => {
        if (source !== 'native' || nativeAnswerCompleted) return true
        nativeAnswerCompleted = true
        return veloraSystemCalls.completePendingAnswer(incomingActionId, success, reason)
      }
      const abandonForAccountChange = async () => {
        completeNativeAnswer(false, 'account_changed')
        if (isCurrentCall(callId)) {
          await teardownOnce('accept_incoming_call_account_changed')
        } else {
          void veloraSystemCalls.dismissIncomingCall(callId)
        }
      }
      const assertCurrentCallAccount = () => {
        if (!isCurrentCallAccount()) {
          throw new Error(CALL_ACCOUNT_CHANGED_ERROR)
        }
      }

      if (!isCurrentCallAccount()) {
        await abandonForAccountChange()
        return
      }

      acceptingIncomingCallIdRef.current = callId
      const setupToken = beginCallSetup()

      const telemetry = new CallTelemetrySession('incoming')
      telemetrySessionRef.current = telemetry
      telemetry.record('call_attempt', { outcome: 'started' })
      telemetry.recordLifecycle('ringing', { outcome: 'started' })
      telemetry.record('auth_ready', { outcome: 'succeeded' })
      if (source === 'native') {
        telemetry.record('native_answer_received', { outcome: 'succeeded' })
      }
      telemetry.recordLifecycle('answer_requested', { outcome: 'started' })

      try {
        const nativeAudioState = await veloraSystemCalls.getNativeAudioSessionState()
        debugCall(
          '[Call] audio_snapshot_loaded',
          JSON.stringify({ callId, source, nativeAudioState }),
        )
        telemetry.record('audio_snapshot_loaded', { outcome: 'succeeded' })
        if (nativeAudioState.isActivated && nativeAudioState.isAudioEnabled) {
          debugCall('[Call] audio_already_active', JSON.stringify({ callId, source }))
          telemetry.record('audio_already_active', { outcome: 'succeeded' })
        } else {
          telemetry.record('waiting_for_audio_activation', { outcome: 'started' })
        }
      } catch (error) {
        telemetry.record('audio_snapshot_loaded', { outcome: 'failed', error })
      }

      try {
        assertCurrentCallAccount()
      } catch {
        await abandonForAccountChange()
        return
      }

      if (!isCallSetupCurrent(setupToken, callId)) {
        completeNativeAnswer(false, 'setup_cancelled')
        return
      }

      try {
        socket = await ensureCallSocketConnected(callId)
        assertCallSetupCurrent(setupToken, callId)
        assertCurrentCallAccount()
        telemetry.record('socket_connected', { outcome: 'succeeded' })
      } catch (error) {
        if (error instanceof Error && error.message === CALL_ACCOUNT_CHANGED_ERROR) {
          await abandonForAccountChange()
          return
        }
        if (!isCallSetupCurrent(setupToken, callId)) {
          completeNativeAnswer(false, 'setup_cancelled')
          return
        }
        const errorCode = getAcceptIncomingCallFailureCode(error)
        completeNativeAnswer(false, errorCode)
        telemetry.record('socket_connected', { outcome: 'failed', error })
        telemetry.record('accept_call_failed', { outcome: 'failed', error, errorCode })
        debugCall('[Call] accept_call_failed', JSON.stringify({ callId, errorCode }))
        await teardownOnce('accept_incoming_call_socket_failed', {
          errorMessage: 'Unable to set up the call',
          telemetryError: error,
          telemetryErrorCode: errorCode,
        })
        return
      }

      let hasPermission: boolean
      try {
        hasPermission = await ensureMicPermission()
        assertCallSetupCurrent(setupToken, callId)
        assertCurrentCallAccount()
      } catch (error) {
        if (error instanceof Error && error.message === CALL_ACCOUNT_CHANGED_ERROR) {
          await abandonForAccountChange()
          return
        }
        if (!isCallSetupCurrent(setupToken, callId)) {
          completeNativeAnswer(false, 'setup_cancelled')
          return
        }
        const errorCode = getAcceptIncomingCallFailureCode(error)
        completeNativeAnswer(false, errorCode)
        telemetry.record('microphone_permission', { outcome: 'failed', error })
        telemetry.record('accept_call_failed', { outcome: 'failed', error, errorCode })
        await teardownOnce('accept_incoming_call_permission_failed', {
          errorMessage: 'Velora needs microphone access to place calls',
          telemetryError: error,
          telemetryErrorCode: errorCode,
        })
        return
      }
      if (!hasPermission) {
        completeNativeAnswer(false, 'microphone_permission_denied')
        telemetry.record('microphone_permission', {
          outcome: 'failed',
          error: new Error('microphone permission denied'),
        })
        telemetry.record('accept_call_failed', {
          outcome: 'failed',
          error: new Error('microphone permission denied'),
          errorCode: 'server_rejected',
        })
        socket.emit('reject_call', {
          callId,
          reason: 'mic_permission_denied',
        })
        await teardownOnce('accept_incoming_call_permission_denied', {
          errorMessage: 'Velora needs microphone access to place calls',
          telemetryError: new Error('microphone permission denied'),
          telemetryErrorCode: 'server_rejected',
        })
        return
      }
      telemetry.record('microphone_permission', { outcome: 'succeeded' })

      if (state.callType === 'VIDEO') {
        let cameraGranted = false
        try {
          cameraGranted = await ensureCameraPermission()
          assertCallSetupCurrent(setupToken, callId)
          assertCurrentCallAccount()
        } catch (error) {
          if (error instanceof Error && error.message === CALL_ACCOUNT_CHANGED_ERROR) {
            await abandonForAccountChange()
            return
          }
          if (!isCallSetupCurrent(setupToken, callId)) {
            completeNativeAnswer(false, 'setup_cancelled')
            return
          }
          telemetry.record('camera_permission', { outcome: 'failed', error })
        }
        if (!cameraGranted) {
          completeNativeAnswer(false, 'camera_permission_denied')
          socket.emit('reject_call', { callId, reason: 'camera_permission_denied' })
          await teardownOnce('accept_video_call_camera_permission_denied', {
            errorMessage: 'Velora needs camera access for video calls',
          })
          return
        }
        telemetry.record('camera_permission', { outcome: 'succeeded' })
      }

      let joinedCall = false
      let acceptRequestSent = false

      try {
        telemetry.recordLifecycle('server_accepting', { outcome: 'started' })
        let acceptance: IncomingCallAcceptancePayload | null = null
        if (ATOMIC_INCOMING_CALL_ACCEPT_ENABLED) {
          for (let attempt = 1; attempt <= INCOMING_ACCEPT_MAX_ATTEMPTS; attempt += 1) {
            try {
              acceptRequestSent = true
              acceptance = await emitAndWaitForEvent<
                'accept_incoming_call',
                'incoming_call_acceptance'
              >(
                socket,
                'accept_incoming_call',
                { callId, actionId: incomingActionId },
                {
                  event: 'incoming_call_acceptance',
                  timeoutMs: INCOMING_ACCEPT_ACK_TIMEOUT_MS,
                  registry: waitRegistryRef.current,
                  filter: (payload) => payload.callId === callId,
                },
              )
              assertCallSetupCurrent(setupToken, callId)
              assertCurrentCallAccount()
              break
            } catch (error) {
              if (isCallSetupCancelledError(error)) throw error

              const errorCode = getAcceptIncomingCallFailureCode(error)
              const canRetryAck =
                attempt < INCOMING_ACCEPT_MAX_ATTEMPTS &&
                (errorCode === 'accept_timeout' || errorCode === 'network_unavailable')
              telemetry.record('server_accept_ack_attempt_failed', {
                outcome: 'failed',
                error,
                errorCode,
              })
              if (!canRetryAck) throw error

              telemetry.record('server_accept_ack_retry', {
                outcome: 'started',
                errorCode,
              })
              await new Promise<void>((resolve) => {
                setTimeout(resolve, INCOMING_ACCEPT_RETRY_DELAY_MS)
              })
              assertCallSetupCurrent(setupToken, callId)
              assertCurrentCallAccount()
            }
          }
        } else {
          // Compatibility rollback is deliberately selected before any atomic
          // request is sent. Never fall back after an uncertain atomic ACK:
          // doing so would create a second answer contender for one tap.
          telemetry.record('legacy_accept_rollback_mode', { outcome: 'started' })
          acceptRequestSent = true
          const legacyJoined = await emitAndWaitForEvent<'join_call', 'call_joined'>(
            socket,
            'join_call',
            { callId },
            {
              event: 'call_joined',
              timeoutMs: CALL_JOINED_TIMEOUT_MS,
              registry: waitRegistryRef.current,
              filter: (payload) => payload.callId === callId && payload.role === 'guest',
            },
          )
          assertCallSetupCurrent(setupToken, callId)
          assertCurrentCallAccount()
          await emitAndWaitForEvent<'answer_call', 'call_answered'>(
            socket,
            'answer_call',
            { callId, actionId: incomingActionId },
            {
              event: 'call_answered',
              timeoutMs: CALL_JOINED_TIMEOUT_MS,
              registry: waitRegistryRef.current,
              filter: (payload) => payload.callId === callId,
            },
          )
          assertCallSetupCurrent(setupToken, callId)
          assertCurrentCallAccount()
          acceptance = {
            callId: legacyJoined.callId,
            outcome: 'accepted',
            role: 'guest',
            session: legacyJoined.session,
            rtpCapabilities: legacyJoined.rtpCapabilities,
            ...(legacyJoined.activeProducers
              ? { activeProducers: legacyJoined.activeProducers }
              : {}),
            ...(legacyJoined.noAnswerTimeoutMs !== undefined
              ? { noAnswerTimeoutMs: legacyJoined.noAnswerTimeoutMs }
              : {}),
            telemetryToken: legacyJoined.telemetryToken,
          }
        }

        if (!acceptance) {
          throw new Error('incoming_call_acceptance_ack_missing')
        }

        if (
          acceptance.outcome === 'answered_elsewhere' ||
          acceptance.outcome === 'terminal' ||
          acceptance.outcome === 'expired' ||
          acceptance.outcome === 'unauthorized' ||
          acceptance.outcome === 'busy' ||
          acceptance.outcome === 'media_unavailable'
        ) {
          completeNativeAnswer(false, acceptance.outcome)
          await teardownOnce('accept_incoming_call_not_available', {
            telemetryErrorCode: acceptance.outcome,
          })
          return
        }

        if (
          !acceptance.session ||
          !acceptance.role ||
          !acceptance.rtpCapabilities ||
          !acceptance.telemetryToken
        ) {
          throw new Error('incoming_call_acceptance_payload_incomplete')
        }

        const joined: CallJoinedPayload = {
          callId: acceptance.callId,
          role: acceptance.role,
          session: acceptance.session,
          rtpCapabilities: acceptance.rtpCapabilities,
          telemetryToken: acceptance.telemetryToken,
          ...(acceptance.activeProducers ? { activeProducers: acceptance.activeProducers } : {}),
          ...(acceptance.noAnswerTimeoutMs !== undefined
            ? { noAnswerTimeoutMs: acceptance.noAnswerTimeoutMs }
            : {}),
        }

        joinedCall = true
        telemetry.attachCall(joined.telemetryToken)
        telemetry.record('server_accept_ack', { outcome: 'succeeded' })
        telemetry.record('call_joined', { outcome: 'succeeded' })
        telemetry.record('accept_call_started', { outcome: 'started' })
        debugCall('[Call] accept_call_started', JSON.stringify({ callId, source }))

        callAnsweredRef.current = true
        telemetry.record('accept_call_succeeded', { outcome: 'succeeded' })
        telemetry.recordLifecycle('active', { outcome: 'succeeded' })
        debugCall('[Call] accept_call_succeeded', JSON.stringify({ callId, source }))

        useCallStore.getState().patch({
          phase: 'connecting',
          remoteAudioState: 'idle',
          remoteVideoState: state.callType === 'VIDEO' ? 'waiting' : 'idle',
          localStreamUrl: null,
          remoteStreamUrl: null,
          reconnectDeadlineMs: null,
        })
        router.push(`/call/${callId}` as never)

        if (!completeNativeAnswer(true)) {
          throw new Error('native_answer_action_unavailable')
        }
        if (source === 'native') {
          telemetry.record('callkit_fulfilled', { outcome: 'succeeded' })
        }

        debugCall('[Call] Waiting for configured native audio session...')
        if (
          veloraSystemCalls.isIosSimulator &&
          !veloraSystemCalls.activateSimulatorAudioSession(callId)
        ) {
          throw new Error('simulator_audio_session_activation_failed')
        }
        const audioSessionConfiguration = await waitForConfiguredAudioSession(setupToken, callId)
        assertCallSetupCurrent(setupToken, callId)
        assertCurrentCallAccount()
        const audioRoute = toAudioRouteTelemetry(audioSessionConfiguration)
        telemetry.record('native_audio_configured', {
          outcome: 'succeeded',
          ...(audioRoute ? { details: { audioRoute } } : {}),
        })

        telemetry.record('media_setup_started', { outcome: 'started' })
        await postAnswerSetup(joined, { setupToken })
        assertCallSetupCurrent(setupToken, callId)
        assertCurrentCallAccount()
        if (state.callType === 'VIDEO') {
          enableDefaultVideoSpeaker(audioSessionConfiguration)
        }
        if (!veloraSystemCalls.setCallActive(callId)) {
          throw new Error('Native call is no longer active')
        }
        telemetry.record('control_plane_active', { outcome: 'succeeded' })
      } catch (error) {
        if (error instanceof Error && error.message === CALL_ACCOUNT_CHANGED_ERROR) {
          await abandonForAccountChange()
          return
        }
        if (isCallSetupCancelledError(error)) {
          completeNativeAnswer(false, 'setup_cancelled')
          return
        }

        const errorCode = getAcceptIncomingCallFailureCode(error)
        completeNativeAnswer(false, errorCode)
        debugCall(
          '[Call] accept_call_failed',
          JSON.stringify({
            callId,
            errorCode,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )
        if (joinedCall && socket?.connected) {
          socket.emit('leave_call', {
            callId,
            reason: getRemoteSetupFailureReason(errorCode),
          })
        } else if (acceptRequestSent) {
          // A timeout says only that this client did not observe the ACK; the
          // server may already have activated the exact action id. End both
          // possible server states rather than leaving a connected ghost call.
          const endReason = getRemoteSetupFailureReason(errorCode)
          const abortUncertainAccept = (connectedSocket: CallSocket) => {
            emitIncomingAcceptTerminalIntent(connectedSocket, callId, endReason)
          }
          if (socket?.connected) {
            abortUncertainAccept(socket)
          } else {
            void ensureCallSocketConnected(callId)
              .then((connectedSocket) => {
                if (useAuthStore.getState().user?.id !== currentUserId) return
                abortUncertainAccept(connectedSocket)
              })
              .catch(() => undefined)
          }
        }
        telemetry.record('setup_failed', { outcome: 'failed', error, errorCode })
        telemetry.record('accept_call_failed', { outcome: 'failed', error, errorCode })
        await teardownOnce('accept_incoming_call_failed', {
          errorMessage: 'Unable to set up the call',
          telemetryError: error,
          telemetryErrorCode: errorCode,
        })
      }
    },
    [
      assertCallSetupCurrent,
      beginCallSetup,
      currentUserId,
      ensureMicPermission,
      ensureCameraPermission,
      ensureCallSocketConnected,
      enableDefaultVideoSpeaker,
      emitIncomingAcceptTerminalIntent,
      postAnswerSetup,
      router,
      teardownOnce,
      waitForConfiguredAudioSession,
      isCallSetupCurrent,
      isCurrentCall,
      isCurrentCallAccount,
    ],
  )

  const startCall = useCallback(
    async (input: StartCallInput, callType: CallType) => {
      if (
        !currentUserId ||
        outgoingStartInFlightRef.current ||
        isBusyPhase(useCallStore.getState().phase)
      ) {
        return
      }
      outgoingStartInFlightRef.current = true
      const setupToken = beginCallSetup()
      const assertOutgoingAttemptCurrent = () => {
        if (
          setupToken !== callSetupGenerationRef.current ||
          !outgoingStartInFlightRef.current ||
          useCallStore.getState().phase !== 'idle'
        ) {
          throw new Error(CALL_SETUP_CANCELLED_ERROR)
        }
      }

      const telemetry = new CallTelemetrySession('outgoing')
      telemetrySessionRef.current = telemetry
      telemetry.record('call_attempt', { outcome: 'started' })
      telemetry.recordLifecycle('ringing', { outcome: 'started' })

      try {
        const micGranted = await ensureMicPermission()
        assertOutgoingAttemptCurrent()
        if (!micGranted) throw new Error('microphone permission denied')
        telemetry.record('microphone_permission', { outcome: 'succeeded' })

        if (callType === 'VIDEO') {
          const cameraGranted = await ensureCameraPermission()
          assertOutgoingAttemptCurrent()
          if (!cameraGranted) throw new Error('camera permission denied')
          telemetry.record('camera_permission', { outcome: 'succeeded' })

          const preview = await mediaDevices.getUserMedia({
            audio: false,
            video: cameraConstraints('user'),
          })
          try {
            assertOutgoingAttemptCurrent()
          } catch (error) {
            preview.getTracks().forEach((track) => track.stop())
            throw error
          }
          const previewTrack = preview.getVideoTracks()[0]
          if (!previewTrack) {
            preview.getTracks().forEach((track) => track.stop())
            throw new Error('camera preview unavailable')
          }
          ringingPreviewStreamRef.current = preview
          useCallStore.getState().patch({
            cameraEnabled: true,
            cameraFacing: 'user',
            hasCameraPermission: true,
            localStreamUrl: preview.toURL(),
          })
        }

        const socket = await ensureSocketConnected()
        assertOutgoingAttemptCurrent()
        telemetry.record('socket_connected', { outcome: 'succeeded' })
        const joined = await emitAndWaitForEvent<'initiate_call', 'call_joined'>(
          socket,
          'initiate_call',
          { conversationId: input.conversationId, targetUserId: input.peerUserId, callType },
          {
            event: 'call_joined',
            timeoutMs: CALL_JOINED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload) =>
              payload.role === 'host' &&
              payload.session.conversationId === input.conversationId &&
              payload.session.initiatorId === currentUserId &&
              payload.session.targetUserId === input.peerUserId &&
              payload.session.callType === callType,
          },
        )
        assertOutgoingAttemptCurrent()

        activeCallIdRef.current = joined.callId
        telemetry.attachCall(joined.telemetryToken)
        telemetry.record('call_joined', { outcome: 'succeeded' })
        callAnsweredRef.current = false
        void veloraSystemCalls.registerOutgoingCall({
          callId: joined.callId,
          conversationId: input.conversationId,
          peerName: input.peerName ?? 'Unknown',
          callType,
          accountId: currentUserId,
        })
        useCallStore.getState().patch({
          phase: 'outgoing_ringing',
          direction: 'outgoing',
          callId: joined.callId,
          conversationId: input.conversationId,
          peerUserId: input.peerUserId,
          peerName: input.peerName ?? 'Unknown',
          peerAvatarUrl: input.peerAvatarUrl ?? null,
          callType,
          muted: false,
          cameraEnabled: callType === 'VIDEO',
          remoteAudioState: 'idle',
          remoteVideoState: callType === 'VIDEO' ? 'waiting' : 'idle',
          localStreamUrl:
            callType === 'VIDEO' ? (ringingPreviewStreamRef.current?.toURL() ?? null) : null,
          remoteStreamUrl: null,
          reconnectDeadlineMs: null,
          error: null,
          durationSec: 0,
        })
        router.push(`/call/${joined.callId}` as never)

        const answerWaitRegistry: CallWaitRegistry = new Set()
        const cancelAnswerWaits = () => clearWaitRegistry(answerWaitRegistry)
        waitRegistryRef.current.add(cancelAnswerWaits)
        const answerWaitTimeoutMs = getOutgoingRingWaitTimeoutMs(joined.noAnswerTimeoutMs)
        let answerOutcome: 'answered' | 'ended' | 'rejected'
        try {
          answerOutcome = await Promise.race([
            waitForEventWhere(socket, 'call_answered', {
              timeoutMs: answerWaitTimeoutMs,
              registry: answerWaitRegistry,
              filter: (payload: CallAnsweredPayload) => payload.callId === joined.callId,
            }).then(() => 'answered' as const),
            waitForEventWhere(socket, 'call_ended', {
              timeoutMs: answerWaitTimeoutMs,
              registry: answerWaitRegistry,
              filter: (payload) => payload.callId === joined.callId,
            }).then(() => 'ended' as const),
            waitForEventWhere(socket, 'call_rejected', {
              timeoutMs: answerWaitTimeoutMs,
              registry: answerWaitRegistry,
              filter: (payload) => payload.callId === joined.callId,
            }).then(() => 'rejected' as const),
          ])
        } finally {
          waitRegistryRef.current.delete(cancelAnswerWaits)
          clearWaitRegistry(answerWaitRegistry)
        }
        if (answerOutcome !== 'answered') return

        callAnsweredRef.current = true
        telemetry.record('call_answered_ack', { outcome: 'succeeded' })
        telemetry.recordLifecycle('answer_requested', { outcome: 'succeeded' })
        telemetry.recordLifecycle('server_accepting', { outcome: 'succeeded' })
        telemetry.recordLifecycle('active', { outcome: 'succeeded' })
        useCallStore.getState().patch({ phase: 'connecting', reconnectDeadlineMs: null })
        stopRingingPreview()

        if (
          veloraSystemCalls.isIosSimulator &&
          !veloraSystemCalls.activateSimulatorAudioSession(joined.callId)
        ) {
          throw new Error('simulator_audio_session_activation_failed')
        }
        const audioSessionConfiguration = await waitForConfiguredAudioSession(
          setupToken,
          joined.callId,
        )
        assertCallSetupCurrent(setupToken, joined.callId)
        const audioRoute = toAudioRouteTelemetry(audioSessionConfiguration)
        telemetry.record('native_audio_configured', {
          outcome: 'succeeded',
          ...(audioRoute ? { details: { audioRoute } } : {}),
        })

        await postAnswerSetup(joined, { setupToken })
        assertCallSetupCurrent(setupToken, joined.callId)
        if (callType === 'VIDEO') {
          enableDefaultVideoSpeaker(audioSessionConfiguration)
        }
        if (!veloraSystemCalls.setCallActive(joined.callId)) {
          throw new Error('Native call is no longer active')
        }
        telemetry.record('control_plane_active', { outcome: 'succeeded' })
      } catch (error) {
        if (isCallSetupCancelledError(error)) {
          stopRingingPreview()
          return
        }
        stopRingingPreview()
        const activeCallId = activeCallIdRef.current
        if (socketRef.current?.connected && activeCallId) {
          socketRef.current.emit('leave_call', { callId: activeCallId, reason: 'timeout' })
        }
        telemetry.record('setup_failed', { outcome: 'failed', error })
        if (!activeCallId) {
          const errorCode = getAcceptIncomingCallFailureCode(error)
          telemetry.recordLifecycle('failed', {
            eventType: 'terminal',
            outcome: 'failed',
            error,
            errorCode,
          })
          telemetry.terminal('start_call_failed', error, errorCode)
          telemetrySessionRef.current = null
          useCallStore.getState().patch({ phase: 'idle' })
          presentError(
            error instanceof Error && /camera/i.test(error.message)
              ? 'Velora needs camera access for video calls'
              : 'Velora needs microphone access to place calls',
          )
          return
        }
        await teardownOnce('start_call_failed', { errorMessage: 'Unable to set up the call' })
      } finally {
        outgoingStartInFlightRef.current = false
      }
    },
    [
      assertCallSetupCurrent,
      beginCallSetup,
      currentUserId,
      ensureCameraPermission,
      ensureMicPermission,
      ensureSocketConnected,
      enableDefaultVideoSpeaker,
      postAnswerSetup,
      presentError,
      router,
      stopRingingPreview,
      teardownOnce,
      waitForConfiguredAudioSession,
    ],
  )

  const startVoiceCall = useCallback(
    (input: StartCallInput) => startCall(input, 'VOICE'),
    [startCall],
  )
  const startVideoCall = useCallback(
    (input: StartCallInput) => startCall(input, 'VIDEO'),
    [startCall],
  )

  const { processNativeCallAction, processPendingNativeCallAction } = useNativeCallActions({
    isLoading,
    isAuthenticated,
    currentUserId,
    processingNativeActionIdsRef,
    completedNativeActionIdsRef,
    acceptingIncomingCallIdRef,
    outgoingStartInFlightRef,
    nativeActionRetryTimeoutRef,
    clearNativeActionRetryTimeout,
    isCurrentCall,
    teardownOnce,
    prepareIncomingCallFromState,
    prepareIncomingCallFromPayload,
    resumeAcceptedCall,
    acceptIncomingCall,
    endCall,
    ensureCallSocketConnected,
    rejectIncomingCall,
  })

  const switchCallType = useCallback(
    async (nextCallType: CallType) => {
      const state = useCallStore.getState()
      const socket = socketRef.current
      if (state.phase !== 'active' || !state.callId || !socket?.connected) return
      if (state.callType === nextCallType) return
      const callId = state.callId
      const setupToken = callSetupGenerationRef.current
      const isCallTypeSwitchCurrent = () => {
        const currentState = useCallStore.getState()
        return (
          isCallSetupCurrent(setupToken, callId) &&
          currentState.phase === 'active' &&
          currentState.callId === callId
        )
      }

      if (nextCallType === 'VIDEO') {
        let granted = false
        try {
          granted = await ensureCameraPermission()
        } catch {
          if (isCallTypeSwitchCurrent()) {
            presentError('Velora needs camera access for video calls')
          }
          return
        }
        if (!isCallTypeSwitchCurrent()) return
        if (!granted) {
          presentError('Velora needs camera access for video calls')
          return
        }
      }

      try {
        await emitAndWaitForEvent(
          socket,
          'set_call_type',
          { callId: state.callId, callType: nextCallType },
          {
            event: 'call_type_changed',
            timeoutMs: CALL_JOINED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload: CallTypeChangedPayload) =>
              payload.callId === state.callId && payload.callType === nextCallType,
          },
        )
      } catch (error) {
        if (isCallWaitCancelledError(error) || !isCallTypeSwitchCurrent()) return
        presentError('Unable to change call type')
        return
      }

      if (!isCallTypeSwitchCurrent()) return
      useCallStore.getState().patch({
        callType: nextCallType,
        remoteVideoState: nextCallType === 'VIDEO' ? 'waiting' : 'idle',
      })
      if (nextCallType === 'VIDEO') {
        try {
          await activateLocalVideo({ requestPermission: false })
        } catch {
          if (isCallTypeSwitchCurrent()) presentError('Unable to enable video')
          return
        }
        if (!isCallTypeSwitchCurrent()) return
        const nativeAudioSessionState = await veloraSystemCalls
          .getNativeAudioSessionState()
          .catch(() => undefined)
        if (!isCallTypeSwitchCurrent()) return
        enableDefaultVideoSpeaker(nativeAudioSessionState)
      } else {
        deactivateLocalVideo()
        clearRemoteVideoRuntime('idle')
      }
    },
    [
      activateLocalVideo,
      clearRemoteVideoRuntime,
      deactivateLocalVideo,
      enableDefaultVideoSpeaker,
      ensureCameraPermission,
      isCallSetupCurrent,
      presentError,
    ],
  )

  const dismissCallError = useCallback(() => {
    useCallStore.getState().patch({ error: null })
  }, [])

  useEffect(() => {
    if ((callPhase !== 'active' && callPhase !== 'reconnecting') || !callId) {
      return
    }

    const handlePageExit = () => {
      void leaveCallFromLifecycle('app_closed')
    }

    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return
    }

    window.addEventListener('pagehide', handlePageExit)
    window.addEventListener('beforeunload', handlePageExit)

    return () => {
      window.removeEventListener('pagehide', handlePageExit)
      window.removeEventListener('beforeunload', handlePageExit)
    }
  }, [callId, callPhase, leaveCallFromLifecycle])

  useEffect(() => {
    const subscription = veloraSystemCalls.addCallActionListener((action) => {
      void processNativeCallAction(action)
    })

    return () => {
      subscription.remove()
    }
  }, [processNativeCallAction])

  useEffect(() => {
    const subscription = veloraSystemCalls.addAudioSessionActivatedListener(
      (event: AudioSessionActivatedEvent) => {
        debugCall('[Call] Native audio session activated', JSON.stringify(event))
      },
    )

    return () => {
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    const subscription = veloraSystemCalls.addAudioSessionConfiguredListener(
      (event: AudioSessionConfiguredEvent) => {
        debugCall('[Call] Native audio session configured', JSON.stringify(event))
      },
    )

    return () => {
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = lastAppStateRef.current
      lastAppStateRef.current = nextState
      const callState = useCallStore.getState()
      const localVideoTrack =
        localStreamRef.current?.getVideoTracks()[0] ??
        ringingPreviewStreamRef.current?.getVideoTracks()[0]

      if (nextState !== 'active') {
        if (
          (nextState === 'background' || nextState === 'inactive') &&
          callState.callType === 'VIDEO' &&
          callState.cameraEnabled &&
          localVideoTrack
        ) {
          localVideoTrack.enabled = false
          emitLocalVideoState(false)
          cameraPausedByBackgroundRef.current = true
        }
        return
      }

      if (
        previousState !== 'active' &&
        cameraPausedByBackgroundRef.current &&
        callState.callType === 'VIDEO'
      ) {
        if (localVideoTrack) {
          localVideoTrack.enabled = true
          emitLocalVideoState(true)
          cameraPausedByBackgroundRef.current = false
        } else {
          void activateLocalVideo({ requestPermission: false })
            .then((activated) => {
              if (activated) cameraPausedByBackgroundRef.current = false
            })
            .catch(() => {
              const currentState = useCallStore.getState()
              if (currentState.phase === 'active' && currentState.callType === 'VIDEO') {
                presentError('Unable to restore video')
              }
            })
        }
      }

      // Notification/full-screen actions are persisted by the Android receiver before
      // MainActivity is brought forward. The live native event may be missed while JS is
      // suspended, so always replay the persisted action when the app becomes active.
      processPendingNativeCallAction('app_resume')

      const resumedCallId = activeCallIdRef.current ?? useCallStore.getState().callId
      if (!resumedCallId) {
        return
      }

      void veloraSystemCalls
        .getNativeAudioSessionState()
        .then((state) => {
          debugCall(
            '[Call] audio_snapshot_loaded',
            JSON.stringify({ callId: resumedCallId, source: 'app_resume', state }),
          )
          telemetrySessionRef.current?.record('audio_snapshot_loaded', { outcome: 'succeeded' })
        })
        .catch(() => undefined)
    })

    return () => {
      subscription.remove()
    }
  }, [activateLocalVideo, emitLocalVideoState, presentError, processPendingNativeCallAction])

  useEffect(() => {
    void flushCallTelemetry()
    const interval = setInterval(() => {
      void flushCallTelemetry()
    }, 15_000)
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void flushCallTelemetry()
      }
    })

    return () => {
      clearInterval(interval)
      appStateSubscription.remove()
    }
  }, [])

  useEffect(() => {
    if (callPhase !== 'active' || !callId) {
      return
    }

    rtcQualityCountersRef.current = null
    rtcQualityStreakRef.current = { degraded: 0, healthy: 0 }
    void sampleRtcQuality()
    const interval = setInterval(() => {
      void sampleRtcQuality()
    }, RTC_QUALITY_SAMPLE_INTERVAL_MS)

    return () => {
      clearInterval(interval)
    }
  }, [callId, callPhase, sampleRtcQuality])

  useEffect(() => {
    if (isLoading || !isAuthenticated || !currentUserId) {
      return
    }

    processPendingNativeCallAction('auth_ready')
  }, [currentUserId, isAuthenticated, isLoading, processPendingNativeCallAction])

  useEffect(() => {
    const previousUserId = prewarmCredentialOwnerRef.current
    if (previousUserId && previousUserId !== currentUserId) {
      clearPrewarmedCallSocketCredentials(previousUserId)
      // An authenticated account switch does not pass through the signed-out
      // branch below. Tear down every old-account resource before a new
      // socket can be authenticated, otherwise a stale CallKit/media action
      // could continue using account A after account B is visible.
      invalidateCallSetup()
      clearWaitRegistry(waitRegistryRef.current)
      socketRef.current?.removeAllListeners()
      socketRef.current?.disconnect()
      socketRef.current = null
      callSocketPromisesRef.current.clear()
      socketConnectPromiseRef.current = null
      authRestorePromiseRef.current = null
      callSocketAuthenticatedRef.current = false
      void teardownOnce('auth_account_changed')
    }
    prewarmCredentialOwnerRef.current = currentUserId
  }, [currentUserId, invalidateCallSetup, teardownOnce])

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!isAuthenticated || !currentUserId) {
      clearPrewarmedCallSocketCredentials()
      const pendingNativeAction = veloraSystemCalls.getPendingCallAction()?.action
      const pendingNativeAnswer =
        pendingNativeAction === 'answer' || pendingNativeAction === 'resume'
      const authHydrationError = useAuthStore.getState().authHydrationError
      if (pendingNativeAnswer && authHydrationError === 'network') {
        return
      }

      socketRef.current?.removeAllListeners()
      socketRef.current?.disconnect()
      socketRef.current = null
      void teardownOnce('auth_lost')
      return
    }

    let socket: CallSocket

    try {
      socket = socketRef.current ?? createCallSocket()
    } catch (error) {
      presentError('Unable to set up the call')
      return
    }

    socketRef.current = socket

    const handleSocketReady = (payload?: CallSocketReadyPayload) => {
      callSocketAuthenticatedRef.current = true
      ;(payload?.recentTerminalCalls ?? []).forEach((terminalCall) => {
        handleTerminalCall(terminalCall, 'socket_ready_replay')
      })
    }

    const handleConnect = () => {
      if (
        useCallStore.getState().phase === 'reconnecting' &&
        reconnectModeRef.current === 'local'
      ) {
        void recoverActiveCall()
      }
    }

    const handleDisconnect = (reason: string) => {
      const state = useCallStore.getState()
      const { callId: disconnectedCallId, phase } = state
      callSocketAuthenticatedRef.current = false
      debugCall(
        '[Call] socket_disconnected',
        JSON.stringify({ callId: disconnectedCallId, reason }),
      )
      telemetrySessionRef.current?.record('socket_disconnected', {
        outcome: 'failed',
        errorCode: reason === 'io server disconnect' ? 'socket_auth_failed' : 'network_unavailable',
      })

      if (phase === 'reconnecting') {
        if (reconnectModeRef.current === 'peer') {
          beginReconnectRecovery()
        }
        return
      }

      if (phase === 'active') {
        beginReconnectRecovery()
        return
      }

      if (!isBusyPhase(phase) || !disconnectedCallId) {
        return
      }

      telemetrySessionRef.current?.record('socket_reconnect_started', { outcome: 'started' })
      debugCall(
        '[Call] socket_reconnect_started',
        JSON.stringify({ callId: disconnectedCallId, reason }),
      )
      clearSocketDisconnectGraceTimeout()
      socketDisconnectGraceTimeoutRef.current = setTimeout(() => {
        if (callSocketAuthenticatedRef.current || !isCurrentCall(disconnectedCallId)) {
          return
        }

        telemetrySessionRef.current?.record('socket_reconnect_failed', {
          outcome: 'failed',
          errorCode: 'reconnect_exhausted',
        })
        void teardownOnce('socket_disconnect_grace_expired', {
          errorMessage: 'The call was interrupted',
          telemetryError: new Error('reconnect_exhausted'),
          telemetryErrorCode: 'reconnect_exhausted',
        })
      }, SOCKET_DISCONNECT_GRACE_MS)

      void ensureCallSocketConnected(disconnectedCallId)
        .then(async (connectedSocket) => {
          await restorePreActiveCallMembership(connectedSocket, disconnectedCallId)
          const restoredState = useCallStore.getState()
          if (restoredState.callId !== disconnectedCallId || !isBusyPhase(restoredState.phase)) {
            return
          }
          clearSocketDisconnectGraceTimeout()
          telemetrySessionRef.current?.record('socket_reconnect_succeeded', {
            outcome: 'succeeded',
          })
          debugCall(
            '[Call] socket_reconnect_succeeded',
            JSON.stringify({ callId: disconnectedCallId }),
          )
          if (useCallStore.getState().phase === 'reconnecting') {
            void recoverActiveCall()
          }
        })
        .catch((error) => {
          if (!isCurrentCall(disconnectedCallId)) return
          telemetrySessionRef.current?.record('socket_reconnect_failed', {
            outcome: 'failed',
            error,
            errorCode: getAcceptIncomingCallFailureCode(error),
          })
        })
    }

    const handleCallRejected = (payload: CallRejectedPayload) => {
      if (!isCurrentCall(payload.callId)) {
        return
      }

      void teardownOnce('call_rejected', {
        errorMessage: getCallRejectedMessage(payload),
        telemetryErrorCode: payload.reason,
      })
    }

    const handleCallEnded = (payload: CallEndedPayload) => {
      handleTerminalCall(payload, 'live')
    }

    const handleProducerClosed = (payload: ProducerClosedPayload) => {
      if (!isCurrentCall(payload.callId)) return
      const remoteStream = remoteStreamRef.current
      const entry = [...consumerMapRef.current.entries()].find(
        ([, consumer]) => consumer.producerId === payload.producerId,
      )
      if (!entry) {
        if (payload.kind === 'video') useCallStore.getState().patch({ remoteVideoState: 'off' })
        return
      }
      const [consumerId, consumer] = entry
      try {
        remoteStream?.removeTrack(consumer.track as unknown as MediaStreamTrack)
      } catch {
        // Best-effort media cleanup; the native resource may already be closed.
      }
      try {
        consumer.close()
      } catch {
        // Best-effort media cleanup; the native resource may already be closed.
      }
      consumerMapRef.current.delete(consumerId)
      handledRemoteProducerIdsRef.current.delete(payload.producerId)
      remoteVideoEnabledByProducerRef.current.delete(payload.producerId)
      useCallStore.getState().patch({
        remoteStreamUrl: remoteStream?.toURL() ?? null,
        ...(payload.kind === 'video' ? { remoteVideoState: 'off' as const } : {}),
      })
    }

    const handleCallTypeChanged = (payload: CallTypeChangedPayload) => {
      if (!isCurrentCall(payload.callId)) return
      veloraSystemCalls.setCallType(payload.callId, payload.callType)
      useCallStore.getState().patch({
        callType: payload.callType,
        remoteVideoState: payload.callType === 'VIDEO' ? 'waiting' : 'idle',
      })
      if (payload.callType === 'VOICE') {
        deactivateLocalVideo()
        clearRemoteVideoRuntime('idle')
      }
    }

    const handleVideoStateChanged = (payload: VideoStateChangedPayload) => {
      if (!isCurrentCall(payload.callId) || payload.userId === currentUserId) return

      remoteVideoEnabledByProducerRef.current.set(payload.producerId, payload.enabled)
      const videoConsumer = [...consumerMapRef.current.values()].find(
        (consumer) => consumer.producerId === payload.producerId && consumer.kind === 'video',
      )

      if (videoConsumer && !videoConsumer.closed) {
        if (payload.enabled) videoConsumer.resume()
        else videoConsumer.pause()
      }

      useCallStore.getState().patch({
        remoteVideoState: payload.enabled ? (videoConsumer ? 'connected' : 'waiting') : 'off',
      })
    }

    const handlePeerLeft = (payload: PeerLeftPayload) => {
      if (!isCurrentCall(payload.callId)) {
        return
      }

      clearPeerLeftFallback()
      peerLeftTimeoutRef.current = setTimeout(() => {
        void teardownOnce('peer_left', {
          errorMessage: 'The call was interrupted',
        })
      }, PEER_LEFT_GRACE_MS)
    }

    const handleIncomingCallEvent = (payload: IncomingCallPayload) => {
      void handleIncomingCall(payload)
    }

    const handleNewProducer = (payload: NewProducerPayload) => {
      void consumeRemoteProducer(payload)
    }

    const handleCallAnswered = (payload: CallAnsweredPayload) => {
      if (!isCurrentCall(payload.callId)) return

      const state = useCallStore.getState()
      const localIncomingAction = incomingAnswerActionRef.current
      const otherDeviceWon = Boolean(
        localIncomingAction &&
        acceptingIncomingCallIdRef.current === payload.callId &&
        localIncomingAction.callId === payload.callId &&
        payload.answerActionId &&
        localIncomingAction.actionId !== payload.answerActionId,
      )

      // The atomic accept ACK can be delayed or lost. If another device that
      // shares this account won, do not wait for the local retry timeout: fail
      // the pending CallKit action and cancel this setup generation now. Older
      // servers omit answerActionId, so they retain the safe ACK/retry path.
      if (otherDeviceWon && localIncomingAction) {
        veloraSystemCalls.completePendingAnswer(
          localIncomingAction.actionId,
          false,
          'answered_elsewhere',
        )
        void teardownOnce('answered_elsewhere', {
          telemetryErrorCode: 'answered_elsewhere',
        })
        return
      }

      // A second device under the same recipient account can answer before
      // this device has tapped Answer. That device is not in the call room,
      // so the gateway also sends this event to the recipient's user room.
      // Resolve this incoming UI immediately instead of waiting for APNs.
      if (state.phase === 'incoming_ringing' && !acceptingIncomingCallIdRef.current) {
        void veloraSystemCalls.dismissIncomingCall(payload.callId)
        void teardownOnce('answered_elsewhere', {
          telemetryErrorCode: 'answered_elsewhere',
        })
        return
      }

      callAnsweredRef.current = true
    }

    socket.on('connect', handleConnect)
    socket.on('call_socket_ready', handleSocketReady)
    socket.on('disconnect', handleDisconnect)
    socket.on('incoming_call', handleIncomingCallEvent)
    socket.on('new_producer', handleNewProducer)
    socket.on('producer_closed', handleProducerClosed)
    socket.on('call_type_changed', handleCallTypeChanged)
    socket.on('video_state_changed', handleVideoStateChanged)
    socket.on('call_answered', handleCallAnswered)
    socket.on('call_rejected', handleCallRejected)
    socket.on('peer_reconnecting', handlePeerReconnecting)
    socket.on('peer_reconnected', handlePeerReconnected)
    socket.on('peer_left', handlePeerLeft)
    socket.on('call_ended', handleCallEnded)

    void ensureCallSocketConnected('runtime').catch(() => undefined)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('call_socket_ready', handleSocketReady)
      socket.off('disconnect', handleDisconnect)
      socket.off('call_rejected', handleCallRejected)
      socket.off('peer_reconnecting', handlePeerReconnecting)
      socket.off('peer_reconnected', handlePeerReconnected)
      socket.off('peer_left', handlePeerLeft)
      socket.off('call_ended', handleCallEnded)
      socket.off('incoming_call', handleIncomingCallEvent)
      socket.off('new_producer', handleNewProducer)
      socket.off('producer_closed', handleProducerClosed)
      socket.off('call_type_changed', handleCallTypeChanged)
      socket.off('video_state_changed', handleVideoStateChanged)
      socket.off('call_answered', handleCallAnswered)
    }
  }, [
    consumeRemoteProducer,
    currentUserId,
    activateLocalVideo,
    clearRemoteVideoRuntime,
    deactivateLocalVideo,
    beginReconnectRecovery,
    clearSocketDisconnectGraceTimeout,
    handlePeerReconnected,
    handlePeerReconnecting,
    handleIncomingCall,
    handleTerminalCall,
    ensureCallSocketConnected,
    isAuthenticated,
    isCurrentCall,
    isLoading,
    presentError,
    recoverActiveCall,
    restorePreActiveCallMembership,
    teardownOnce,
    clearPeerLeftFallback,
  ])

  useEffect(() => {
    const waitRegistry = waitRegistryRef.current
    const callSocketPromises = callSocketPromisesRef.current

    return () => {
      invalidateCallSetup()
      outgoingStartInFlightRef.current = false
      socketRef.current?.removeAllListeners()
      socketRef.current?.disconnect()
      socketRef.current = null
      clearSocketDisconnectGraceTimeout()
      callSocketPromises.clear()
      socketConnectPromiseRef.current = null
      callSocketAuthenticatedRef.current = false
      stopTimer()
      clearNativeActionRetryTimeout()
      clearRemoteAudioFallback()
      clearPeerLeftFallback()
      clearMediaTransportDisconnectTimeouts()
      clearWaitRegistry(waitRegistry)
      cancelAllAudioSessionWaits()
    }
  }, [
    clearNativeActionRetryTimeout,
    cancelAllAudioSessionWaits,
    clearMediaTransportDisconnectTimeouts,
    clearPeerLeftFallback,
    clearRemoteAudioFallback,
    clearSocketDisconnectGraceTimeout,
    invalidateCallSetup,
    stopTimer,
  ])

  const value = useMemo<UseCallValue>(
    () => ({
      startVoiceCall,
      startVideoCall,
      acceptIncomingCall,
      rejectIncomingCall,
      endCall,
      toggleMute,
      toggleSpeaker,
      toggleCamera,
      switchCamera,
      switchCallType,
      recordCallScreenVisible,
      dismissCallError,
    }),
    [
      acceptIncomingCall,
      dismissCallError,
      endCall,
      rejectIncomingCall,
      startVoiceCall,
      startVideoCall,
      toggleMute,
      toggleSpeaker,
      toggleCamera,
      switchCamera,
      switchCallType,
      recordCallScreenVisible,
    ],
  )

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}
