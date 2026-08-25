import { useCallback } from 'react'

import { useCallStore } from '../../stores/callStore'

import {
  CALL_JOINED_TIMEOUT_MS,
  MEDIA_TRANSPORT_DISCONNECT_GRACE_MS,
  RECONNECT_RECOVERY_TIMEOUT_MS,
  TRANSPORT_CONNECTED_TIMEOUT_MS,
} from './callConstants'
import {
  isCallSetupCancelledError,
  isConnectedTransportState,
  isWaitTimeoutError,
  waitForTransportConnection,
} from './callPolicies'
import { emitAndWaitForEvent } from './callSocket'

import type { CallWaitRegistry } from './callSocket'
import type { CallTelemetrySession } from './callTelemetry'
import type {
  CallRejoinedPayload,
  CallSocket,
  IceRestartedPayload,
  NewProducerPayload,
  PeerReconnectedPayload,
  PeerReconnectingPayload,
} from '../../types/call.types'
import type * as MediasoupTypes from 'mediasoup-client/types'

type MutableRef<T> = { current: T }

type RecoveryRuntimeOptions = {
  isAuthenticated: boolean
  currentUserId: string | null
  socketRef: MutableRef<CallSocket | null>
  waitRegistryRef: MutableRef<CallWaitRegistry>
  sendTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  recvTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  videoProducerRef: MutableRef<MediasoupTypes.Producer<Record<string, unknown>> | null>
  connectedTransportIdsRef: MutableRef<Set<string>>
  activeCallIdRef: MutableRef<string | null>
  callAnsweredRef: MutableRef<boolean>
  telemetrySessionRef: MutableRef<CallTelemetrySession | null>
  reconnectRecoveryInFlightRef: MutableRef<boolean>
  reconnectModeRef: MutableRef<'local' | 'peer' | null>
  teardownInProgressRef: MutableRef<boolean>
  mediaTransportDisconnectTimeoutsRef: MutableRef<Map<string, ReturnType<typeof setTimeout>>>
  activateLocalVideo: (options?: { requestPermission?: boolean }) => Promise<boolean>
  deactivateLocalVideo: () => void
  clearRemoteVideoRuntime: (state?: 'idle' | 'off') => void
  consumeRemoteProducer: (payload: NewProducerPayload) => Promise<void>
  invalidateCallSetup: () => void
  disposeMediaRuntime: (options?: { preserveActiveCall?: boolean }) => void
  beginCallSetup: () => number
  postAnswerSetup: (
    payload: CallRejoinedPayload,
    options: { resumeDurationSec?: number; setupToken: number },
  ) => Promise<void>
  assertCallSetupCurrent: (setupToken: number, callId: string) => void
  clearReconnectTimeout: () => void
  startTimer: (initialDurationSec?: number) => void
  armReconnectTimeout: (reason: string, timeoutMs?: number) => void
  teardownRecoveryFailure: (reason: string) => Promise<void>
  stopTimer: (options?: { resetDuration?: boolean }) => void
  isCurrentCall: (callId: string) => boolean
  clearMediaTransportDisconnectTimeout: (transportId: string) => void
  clearRemoteAudioFallback: () => void
  resetRemoteConsumerRuntime: () => void
}

export const useCallRecoveryRuntime = ({
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
}: RecoveryRuntimeOptions) => {
  const restartConnectedTransports = useCallback(
    async (socket: CallSocket, callId: string) => {
      const transports = [sendTransportRef.current, recvTransportRef.current].filter(
        (transport): transport is MediasoupTypes.Transport<Record<string, unknown>> =>
          Boolean(transport && connectedTransportIdsRef.current.has(transport.id)),
      )
      if (transports.length === 0) {
        throw new Error('No connected media transport is available for ICE restart')
      }

      await Promise.all(
        transports.map(async (transport) => {
          const restarted = await emitAndWaitForEvent<'restart_ice', 'ice_restarted'>(
            socket,
            'restart_ice',
            { callId, transportId: transport.id },
            {
              event: 'ice_restarted',
              timeoutMs: TRANSPORT_CONNECTED_TIMEOUT_MS,
              registry: waitRegistryRef.current,
              filter: (payload: IceRestartedPayload) =>
                payload.callId === callId && payload.transportId === transport.id,
            },
          )
          await transport.restartIce({
            iceParameters: restarted.iceParameters as MediasoupTypes.IceParameters,
          })
        }),
      )
      await Promise.all(transports.map((transport) => waitForTransportConnection(transport)))
    },
    [connectedTransportIdsRef, recvTransportRef, sendTransportRef, waitRegistryRef],
  )

  const recoverActiveCall = useCallback(async () => {
    const socket = socketRef.current
    const state = useCallStore.getState()
    if (
      reconnectRecoveryInFlightRef.current ||
      !socket?.connected ||
      state.phase !== 'reconnecting' ||
      !state.callId
    ) {
      return
    }

    reconnectRecoveryInFlightRef.current = true
    try {
      const rejoined = await emitAndWaitForEvent<'rejoin_call', 'call_rejoined'>(
        socket,
        'rejoin_call',
        { callId: state.callId },
        {
          event: 'call_rejoined',
          timeoutMs: CALL_JOINED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload) => payload.callId === state.callId,
        },
      )

      activeCallIdRef.current = rejoined.callId
      callAnsweredRef.current = true
      telemetrySessionRef.current?.attachCall(rejoined.telemetryToken)
      const recoveredCallType = rejoined.session.callType
      useCallStore.getState().patch({
        callType: recoveredCallType,
        remoteVideoState: recoveredCallType === 'VIDEO' ? 'waiting' : 'idle',
      })
      if (recoveredCallType === 'VOICE') {
        deactivateLocalVideo()
        clearRemoteVideoRuntime('idle')
      }
      try {
        await restartConnectedTransports(socket, rejoined.callId)
        reconnectModeRef.current = null
        clearReconnectTimeout()
        useCallStore.getState().patch({ phase: 'active', reconnectDeadlineMs: null })
        startTimer(useCallStore.getState().durationSec)
        for (const producer of rejoined.activeProducers ?? []) {
          await consumeRemoteProducer({
            callId: rejoined.callId,
            userId: producer.userId,
            producerId: producer.producerId,
            kind: producer.kind,
            ...(producer.paused !== undefined ? { paused: producer.paused } : {}),
          })
        }
        if (
          recoveredCallType === 'VIDEO' &&
          useCallStore.getState().hasCameraPermission === true &&
          !videoProducerRef.current
        ) {
          await activateLocalVideo({ requestPermission: false })
        }
        telemetrySessionRef.current?.record('reconnect_transport_connected', {
          outcome: 'succeeded',
        })
        telemetrySessionRef.current?.record('reconnect', { outcome: 'succeeded' })
        return
      } catch (error) {
        console.warn(
          '[Call] ICE restart failed; rebuilding media runtime',
          JSON.stringify({
            callId: rejoined.callId,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )
      }

      invalidateCallSetup()
      disposeMediaRuntime({ preserveActiveCall: true })
      const setupToken = beginCallSetup()
      await postAnswerSetup(rejoined, {
        resumeDurationSec: useCallStore.getState().durationSec,
        setupToken,
      })
      telemetrySessionRef.current?.record('reconnect', { outcome: 'succeeded' })
      assertCallSetupCurrent(setupToken, rejoined.callId)

      if (useCallStore.getState().remoteAudioState !== 'connected') {
        useCallStore.getState().patch({
          reconnectDeadlineMs: Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS,
        })
        armReconnectTimeout('recover_audio_timeout')
      }
    } catch (error) {
      if (isCallSetupCancelledError(error)) return
      if (isWaitTimeoutError(error)) {
        console.warn(
          '[Call] Recovery helper timed out before reconnect grace window expired',
          JSON.stringify({
            callId: state.callId,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )
        return
      }
      await teardownRecoveryFailure('recover_active_call_failed')
    } finally {
      reconnectRecoveryInFlightRef.current = false
    }
  }, [
    activateLocalVideo,
    activeCallIdRef,
    armReconnectTimeout,
    assertCallSetupCurrent,
    beginCallSetup,
    callAnsweredRef,
    clearReconnectTimeout,
    clearRemoteVideoRuntime,
    consumeRemoteProducer,
    deactivateLocalVideo,
    disposeMediaRuntime,
    invalidateCallSetup,
    postAnswerSetup,
    reconnectModeRef,
    reconnectRecoveryInFlightRef,
    restartConnectedTransports,
    socketRef,
    startTimer,
    teardownRecoveryFailure,
    telemetrySessionRef,
    waitRegistryRef,
    videoProducerRef,
  ])

  const beginReconnectRecovery = useCallback(() => {
    const state = useCallStore.getState()
    if (
      !['active', 'reconnecting'].includes(state.phase) ||
      !state.callId ||
      !isAuthenticated ||
      !currentUserId ||
      reconnectRecoveryInFlightRef.current ||
      (state.phase === 'reconnecting' && reconnectModeRef.current !== 'peer')
    ) {
      return
    }

    telemetrySessionRef.current?.record('reconnect', { outcome: 'started' })
    stopTimer({ resetDuration: false })
    reconnectModeRef.current = 'local'
    useCallStore.getState().patch({
      phase: 'reconnecting',
      reconnectDeadlineMs: Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS,
    })
    armReconnectTimeout('reconnect_timeout')
  }, [
    armReconnectTimeout,
    currentUserId,
    isAuthenticated,
    reconnectModeRef,
    reconnectRecoveryInFlightRef,
    stopTimer,
    telemetrySessionRef,
  ])

  const handleMediaTransportStateChange = useCallback(
    ({ callId, transportId, state }: { callId: string; transportId: string; state: string }) => {
      if (isConnectedTransportState(state)) {
        clearMediaTransportDisconnectTimeout(transportId)
        return
      }

      const callState = useCallStore.getState()
      if (
        teardownInProgressRef.current ||
        callState.phase !== 'active' ||
        !isCurrentCall(callId) ||
        state === 'closed'
      ) {
        return
      }

      const startRecovery = (reason: 'media_transport_failed' | 'media_transport_disconnected') => {
        if (
          teardownInProgressRef.current ||
          useCallStore.getState().phase !== 'active' ||
          !isCurrentCall(callId)
        ) {
          return
        }
        telemetrySessionRef.current?.record(reason, { outcome: 'failed', errorCode: reason })
        beginReconnectRecovery()
        void recoverActiveCall()
      }

      if (state === 'failed') {
        clearMediaTransportDisconnectTimeout(transportId)
        startRecovery('media_transport_failed')
        return
      }
      if (
        state !== 'disconnected' ||
        mediaTransportDisconnectTimeoutsRef.current.has(transportId)
      ) {
        return
      }

      telemetrySessionRef.current?.record('media_transport_disconnected', { outcome: 'started' })
      const timeout = setTimeout(() => {
        mediaTransportDisconnectTimeoutsRef.current.delete(transportId)
        const transport = [sendTransportRef.current, recvTransportRef.current].find(
          (candidate) => candidate?.id === transportId,
        )
        if (!transport || isConnectedTransportState(transport.connectionState)) return
        startRecovery('media_transport_disconnected')
      }, MEDIA_TRANSPORT_DISCONNECT_GRACE_MS)
      mediaTransportDisconnectTimeoutsRef.current.set(transportId, timeout)
    },
    [
      beginReconnectRecovery,
      clearMediaTransportDisconnectTimeout,
      isCurrentCall,
      mediaTransportDisconnectTimeoutsRef,
      recoverActiveCall,
      recvTransportRef,
      sendTransportRef,
      teardownInProgressRef,
      telemetrySessionRef,
    ],
  )

  const handlePeerReconnecting = useCallback(
    (payload: PeerReconnectingPayload) => {
      if (!isCurrentCall(payload.callId) || payload.userId === currentUserId) return
      const state = useCallStore.getState()
      if (state.phase !== 'active') return

      reconnectModeRef.current = 'peer'
      stopTimer({ resetDuration: false })
      clearRemoteAudioFallback()
      resetRemoteConsumerRuntime()
      useCallStore.getState().patch({
        phase: 'reconnecting',
        remoteAudioState: 'waiting',
        remoteStreamUrl: null,
        reconnectDeadlineMs: Date.parse(payload.reconnectDeadlineAt) || null,
      })

      const timeoutMs = Math.max(
        0,
        Date.parse(payload.reconnectDeadlineAt) - Date.now() || RECONNECT_RECOVERY_TIMEOUT_MS,
      )
      armReconnectTimeout('peer_reconnect_timeout', timeoutMs)
    },
    [
      armReconnectTimeout,
      clearRemoteAudioFallback,
      currentUserId,
      isCurrentCall,
      reconnectModeRef,
      resetRemoteConsumerRuntime,
      stopTimer,
    ],
  )

  const handlePeerReconnected = useCallback(
    (payload: PeerReconnectedPayload) => {
      if (!isCurrentCall(payload.callId) || payload.userId === currentUserId) return
      if (reconnectModeRef.current !== 'peer') return
      const state = useCallStore.getState()
      if (state.phase !== 'reconnecting') return

      useCallStore.getState().patch({
        remoteAudioState: 'waiting',
        reconnectDeadlineMs: Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS,
      })
      armReconnectTimeout('peer_audio_reconnect_timeout')
    },
    [armReconnectTimeout, currentUserId, isCurrentCall, reconnectModeRef],
  )

  return {
    recoverActiveCall,
    beginReconnectRecovery,
    handleMediaTransportStateChange,
    handlePeerReconnecting,
    handlePeerReconnected,
  }
}
