import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { AppState, Platform } from 'react-native'
import { mediaDevices } from 'react-native-webrtc'

import {
  CALL_JOINED_TIMEOUT_MS,
  CALL_SETUP_CANCELLED_ERROR,
  getOutgoingRingWaitTimeoutMs,
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
} from '../lib/systemCalls/veloraSystemCalls'
import { useAuthStore } from '../stores/authStore'
import { useCallStore } from '../stores/callStore'

import type { CallStateResponse } from '../api/call.api'
// VIDEO_CALL_1TO1_PROVIDER_PATCH
import type {
  AudioBitrateProfile,
  CallAnsweredPayload,
  CallEndedPayload,
  CallSocketReadyPayload,
  CallRejectedPayload,
  CallSocket,
  CallType,
  CallTypeChangedPayload,
  IncomingCallPayload,
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
  dismissCallError: () => {},
})

export const useCall = () => useContext(CallContext)

export function CallProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { isAuthenticated, isLoading, user } = useAuthStore()
  const currentUserId = user?.id ?? null
  const username = user?.username ?? null
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
  const incomingAudioBitrateProfileRef = useRef<AudioBitrateProfile>('normal')
  const incomingAudioBitrateUpdateInFlightRef = useRef(false)
  const incomingAudioBitrateRetryAfterMsRef = useRef(0)
  const audioFlowingRef = useRef(false)
  const audioFlowConfirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callSetupGenerationRef = useRef(0)
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
      if (endingCallId) {
        cancelAudioSessionWait(endingCallId)
      }
      stopTimer()
      if (endingCallId) {
        veloraSystemCalls.endCall(endingCallId)
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
    let socket = socketRef.current

    if (!socket?.connected && state.callId) {
      try {
        socket = await ensureCallSocketConnected(state.callId)
      } catch {
        socket = null
      }
    }

    if (socket?.connected && state.callId) {
      socket.emit('reject_call', {
        callId: state.callId,
      })
    }

    if (state.callId) {
      veloraSystemCalls.dismissIncomingCall(state.callId)
    }
    await teardownOnce('reject_incoming_call')
  }, [ensureCallSocketConnected, teardownOnce])

  const endCall = useCallback(
    async (reason?: string) => {
      const socket = socketRef.current
      const state = useCallStore.getState()

      if (!state.callId) {
        return
      }

      useCallStore.getState().patch({ phase: 'ending' })

      if (socket?.connected) {
        socket.emit('leave_call', {
          callId: state.callId,
          ...(reason ? { reason } : {}),
        })
      }

      await teardownOnce('end_call')
    },
    [teardownOnce],
  )

  const handleIncomingCall = useCallback(
    async (payload: IncomingCallPayload) => {
      if (!currentUserId) {
        return
      }

      const currentState = useCallStore.getState()

      if (currentState.callId === payload.callId) {
        return
      }

      if (isBusyPhase(currentState.phase)) {
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
      if (veloraSystemCalls.isIosSimulator) {
        router.push(`/call/${payload.callId}` as never)
      } else {
        veloraSystemCalls.presentIncomingCall(nativePayload)
      }
    },
    [currentUserId, queryClient, router],
  )

  const prepareIncomingCallFromState = useCallback(
    (callState: CallStateResponse) => {
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

  const acceptIncomingCall = useCallback(
    async (source: 'native' | 'ui' = 'ui') => {
      const state = useCallStore.getState()
      let socket = socketRef.current
      const callId = state.callId

      if (!callId) {
        return
      }

      if (acceptingIncomingCallIdRef.current === callId) {
        return
      }
      acceptingIncomingCallIdRef.current = callId

      const telemetry = new CallTelemetrySession('incoming')
      telemetrySessionRef.current = telemetry
      telemetry.record('call_attempt', { outcome: 'started' })
      if (source === 'native') {
        telemetry.record('native_answer_received', { outcome: 'succeeded' })
      }

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
        socket = await ensureCallSocketConnected(callId)
        telemetry.record('socket_connected', { outcome: 'succeeded' })
      } catch (error) {
        const errorCode = getAcceptIncomingCallFailureCode(error)
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
      } catch (error) {
        const errorCode = getAcceptIncomingCallFailureCode(error)
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
        } catch (error) {
          telemetry.record('camera_permission', { outcome: 'failed', error })
        }
        if (!cameraGranted) {
          socket.emit('reject_call', { callId, reason: 'camera_permission_denied' })
          await teardownOnce('accept_video_call_camera_permission_denied', {
            errorMessage: 'Velora needs camera access for video calls',
          })
          return
        }
        telemetry.record('camera_permission', { outcome: 'succeeded' })
      }

      let joinedCall = false

      try {
        const joined = await emitAndWaitForEvent<'join_call', 'call_joined'>(
          socket,
          'join_call',
          { callId },
          {
            event: 'call_joined',
            timeoutMs: CALL_JOINED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload) => payload.callId === callId,
          },
        )

        joinedCall = true
        telemetry.attachCall(joined.telemetryToken)
        telemetry.record('call_joined', { outcome: 'succeeded' })
        telemetry.record('accept_call_started', { outcome: 'started' })
        debugCall('[Call] accept_call_started', JSON.stringify({ callId, source }))

        await emitAndWaitForEvent<'answer_call', 'call_answered'>(
          socket,
          'answer_call',
          { callId },
          {
            event: 'call_answered',
            timeoutMs: CALL_JOINED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload) => payload.callId === callId,
          },
        )
        callAnsweredRef.current = true
        telemetry.record('accept_call_succeeded', { outcome: 'succeeded' })
        debugCall('[Call] accept_call_succeeded', JSON.stringify({ callId, source }))

        const setupToken = beginCallSetup()
        useCallStore.getState().patch({
          phase: 'connecting',
          remoteAudioState: 'idle',
          remoteVideoState: state.callType === 'VIDEO' ? 'waiting' : 'idle',
          localStreamUrl: null,
          remoteStreamUrl: null,
          reconnectDeadlineMs: null,
        })
        router.push(`/call/${callId}` as never)

        debugCall('[Call] Waiting for configured native audio session...')
        if (
          veloraSystemCalls.isIosSimulator &&
          !veloraSystemCalls.activateSimulatorAudioSession(callId)
        ) {
          throw new Error('simulator_audio_session_activation_failed')
        }
        const audioSessionConfiguration = await waitForConfiguredAudioSession(setupToken, callId)
        assertCallSetupCurrent(setupToken, callId)
        const audioRoute = toAudioRouteTelemetry(audioSessionConfiguration)
        telemetry.record('native_audio_configured', {
          outcome: 'succeeded',
          ...(audioRoute ? { details: { audioRoute } } : {}),
        })

        telemetry.record('media_setup_started', { outcome: 'started' })
        await postAnswerSetup(joined, { setupToken })
        assertCallSetupCurrent(setupToken, callId)
        if (state.callType === 'VIDEO') {
          enableDefaultVideoSpeaker(audioSessionConfiguration)
        }
        if (!veloraSystemCalls.setCallActive(callId)) {
          throw new Error('Native call is no longer active')
        }
        telemetry.record('control_plane_active', { outcome: 'succeeded' })
      } catch (error) {
        if (isCallSetupCancelledError(error)) {
          return
        }

        const errorCode = getAcceptIncomingCallFailureCode(error)
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
      ensureMicPermission,
      ensureCameraPermission,
      ensureCallSocketConnected,
      enableDefaultVideoSpeaker,
      postAnswerSetup,
      router,
      teardownOnce,
      waitForConfiguredAudioSession,
    ],
  )

  const startCall = useCallback(
    async (input: StartCallInput, callType: CallType) => {
      if (!currentUserId || isBusyPhase(useCallStore.getState().phase)) return

      const telemetry = new CallTelemetrySession('outgoing')
      telemetrySessionRef.current = telemetry
      telemetry.record('call_attempt', { outcome: 'started' })

      try {
        const micGranted = await ensureMicPermission()
        if (!micGranted) throw new Error('microphone permission denied')
        telemetry.record('microphone_permission', { outcome: 'succeeded' })

        if (callType === 'VIDEO') {
          const cameraGranted = await ensureCameraPermission()
          if (!cameraGranted) throw new Error('camera permission denied')
          telemetry.record('camera_permission', { outcome: 'succeeded' })

          const preview = await mediaDevices.getUserMedia({
            audio: false,
            video: cameraConstraints('user'),
          })
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
        telemetry.record('socket_connected', { outcome: 'succeeded' })
        const joined = await emitAndWaitForEvent<'initiate_call', 'call_joined'>(
          socket,
          'initiate_call',
          { conversationId: input.conversationId, targetUserId: input.peerUserId, callType },
          {
            event: 'call_joined',
            timeoutMs: CALL_JOINED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload) => payload.session.conversationId === input.conversationId,
          },
        )

        activeCallIdRef.current = joined.callId
        telemetry.attachCall(joined.telemetryToken)
        telemetry.record('call_joined', { outcome: 'succeeded' })
        callAnsweredRef.current = false
        void veloraSystemCalls.registerOutgoingCall({
          callId: joined.callId,
          conversationId: input.conversationId,
          peerName: input.peerName ?? 'Unknown',
          callType,
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
          clearWaitRegistry(answerWaitRegistry)
        }
        if (answerOutcome !== 'answered') return

        callAnsweredRef.current = true
        const setupToken = beginCallSetup()
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
        if (isCallSetupCancelledError(error)) return
        stopRingingPreview()
        const activeCallId = activeCallIdRef.current
        if (socketRef.current?.connected && activeCallId) {
          socketRef.current.emit('leave_call', { callId: activeCallId, reason: 'timeout' })
        }
        telemetry.record('setup_failed', { outcome: 'failed', error })
        if (!activeCallId) {
          telemetry.terminal('start_call_failed', error)
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
    username,
    processingNativeActionIdsRef,
    completedNativeActionIdsRef,
    acceptingIncomingCallIdRef,
    nativeActionRetryTimeoutRef,
    clearNativeActionRetryTimeout,
    isCurrentCall,
    teardownOnce,
    prepareIncomingCallFromState,
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

      if (nextCallType === 'VIDEO') {
        const granted = await ensureCameraPermission()
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
        if (isCallWaitCancelledError(error)) return
        throw error
      }

      useCallStore.getState().patch({
        callType: nextCallType,
        remoteVideoState: nextCallType === 'VIDEO' ? 'waiting' : 'idle',
      })
      if (nextCallType === 'VIDEO') {
        await activateLocalVideo({ requestPermission: false })
        const nativeAudioSessionState = await veloraSystemCalls
          .getNativeAudioSessionState()
          .catch(() => undefined)
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
        callState.callType === 'VIDEO' &&
        callState.cameraEnabled
      ) {
        if (localVideoTrack) {
          localVideoTrack.enabled = true
          emitLocalVideoState(true)
          cameraPausedByBackgroundRef.current = false
        } else {
          void activateLocalVideo({ requestPermission: false }).then((activated) => {
            if (activated) cameraPausedByBackgroundRef.current = false
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
  }, [activateLocalVideo, emitLocalVideoState, processPendingNativeCallAction])

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
    if (isLoading || !isAuthenticated || !currentUserId || !username?.trim()) {
      return
    }

    processPendingNativeCallAction('auth_ready')
  }, [currentUserId, isAuthenticated, isLoading, processPendingNativeCallAction, username])

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!isAuthenticated || !currentUserId) {
      const pendingNativeAnswer = veloraSystemCalls.getPendingCallAction()?.action === 'answer'
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
      const hasVideoConsumer = [...consumerMapRef.current.values()].some(
        (consumer) => consumer.producerId === payload.producerId && consumer.kind === 'video',
      )
      useCallStore.getState().patch({
        remoteVideoState: payload.enabled ? (hasVideoConsumer ? 'connected' : 'waiting') : 'off',
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
      if (isCurrentCall(payload.callId)) callAnsweredRef.current = true
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
    ],
  )

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}
