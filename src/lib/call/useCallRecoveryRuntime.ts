import { useCallback } from 'react'

import { useCallStore } from '../../stores/callStore'

import {
  CALL_JOINED_TIMEOUT_MS,
  MEDIA_TRANSPORT_DISCONNECT_GRACE_MS,
  RECONNECT_RECOVERY_TIMEOUT_MS,
  TRANSPORT_CONNECTED_TIMEOUT_MS,
} from './callConstants'
import { safeCallErrorCode, shortCallId } from './callDebug'
import {
  isCallSetupCancelledError,
  isConnectedTransportState,
  isTerminalRemoteMediaError,
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
  LocalVideoSyncState,
  LocalVideoActivationSource,
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
  socketGenerationRef: MutableRef<number>
  waitRegistryRef: MutableRef<CallWaitRegistry>
  sendTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  recvTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  videoProducerRef: MutableRef<MediasoupTypes.Producer<Record<string, unknown>> | null>
  localVideoStateRef: MutableRef<LocalVideoSyncState>
  remoteVideoEnabledByProducerRef: MutableRef<Map<string, boolean>>
  remoteVideoRevisionByProducerRef: MutableRef<Map<string, number>>
  remoteVideoSnapshotReadyRef: MutableRef<boolean>
  markRemoteVideoSnapshotReady: (ready: boolean) => void
  reconcileRemoteVideoSnapshot: (activeProducerIds: Set<string>) => void
  connectedTransportIdsRef: MutableRef<Set<string>>
  activeCallIdRef: MutableRef<string | null>
  callAnsweredRef: MutableRef<boolean>
  incomingAnswerActionRef: MutableRef<{ callId: string; actionId: string } | null>
  telemetrySessionRef: MutableRef<CallTelemetrySession | null>
  reconnectRecoveryInFlightRef: MutableRef<boolean>
  controlPlaneRecoveringRef: MutableRef<boolean>
  reconnectModeRef: MutableRef<'local' | 'peer' | null>
  teardownInProgressRef: MutableRef<boolean>
  mediaTransportDisconnectTimeoutsRef: MutableRef<Map<string, ReturnType<typeof setTimeout>>>
  activateLocalVideo: (options?: {
    requestPermission?: boolean
    source?: LocalVideoActivationSource
  }) => Promise<boolean>
  synchronizeLocalVideoState?: () => Promise<boolean>
  deactivateLocalVideo: () => void
  clearRemoteVideoRuntime: (state?: 'idle' | 'off') => void
  consumeRemoteProducer: (
    payload: NewProducerPayload,
    options?: {
      propagateFailure?: boolean
      retryOnFailure?: boolean
      retryAttempt?: number
      setupToken?: number
    },
  ) => Promise<void>
  invalidateCallSetup: () => void
  disposeMediaRuntime: (options?: { preserveActiveCall?: boolean }) => void
  beginCallSetup: () => number
  postAnswerSetup: (
    payload: CallRejoinedPayload,
    options: { resumeDurationSec?: number; recovery?: boolean; setupToken: number },
  ) => Promise<void>
  assertCallSetupCurrent: (setupToken: number, callId: string) => void
  clearReconnectTimeout: () => void
  startTimer: (initialDurationSec?: number) => void
  markNativeCallActive: (callId: string) => boolean
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
  socketGenerationRef,
  waitRegistryRef,
  sendTransportRef,
  recvTransportRef,
  videoProducerRef,
  localVideoStateRef,
  remoteVideoEnabledByProducerRef,
  remoteVideoRevisionByProducerRef,
  remoteVideoSnapshotReadyRef,
  markRemoteVideoSnapshotReady,
  reconcileRemoteVideoSnapshot,
  connectedTransportIdsRef,
  activeCallIdRef,
  callAnsweredRef,
  incomingAnswerActionRef,
  telemetrySessionRef,
  reconnectRecoveryInFlightRef,
  controlPlaneRecoveringRef,
  reconnectModeRef,
  teardownInProgressRef,
  mediaTransportDisconnectTimeoutsRef,
  activateLocalVideo,
  synchronizeLocalVideoState,
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
  markNativeCallActive,
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
      const skipHealthyTransports = controlPlaneRecoveringRef.current
      const transports = [sendTransportRef.current, recvTransportRef.current].filter(
        (transport): transport is MediasoupTypes.Transport<Record<string, unknown>> =>
          Boolean(
            transport &&
            connectedTransportIdsRef.current.has(transport.id) &&
            (!skipHealthyTransports || !isConnectedTransportState(transport.connectionState)),
          ),
      )
      if (transports.length === 0) {
        if (skipHealthyTransports) return
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
    [
      connectedTransportIdsRef,
      controlPlaneRecoveringRef,
      recvTransportRef,
      sendTransportRef,
      waitRegistryRef,
    ],
  )

  const recoverActiveCall = useCallback(async () => {
    const socket = socketRef.current
    const state = useCallStore.getState()
    const controlPlaneRecovery = controlPlaneRecoveringRef.current
    if (
      reconnectRecoveryInFlightRef.current ||
      !socket?.connected ||
      (state.phase !== 'reconnecting' && !controlPlaneRecovery) ||
      !state.callId
    ) {
      return
    }

    reconnectRecoveryInFlightRef.current = true
    if (controlPlaneRecovery) {
      reconnectModeRef.current = 'local'
    }
    const restartSetupToken = beginCallSetup()
    remoteVideoSnapshotReadyRef.current = false
    markRemoteVideoSnapshotReady(false)
    remoteVideoEnabledByProducerRef.current.clear()
    remoteVideoRevisionByProducerRef.current.clear()
    try {
      const groupGuest = state.isGroupCall && state.direction === 'incoming'
      const answerAction = incomingAnswerActionRef.current
      if (groupGuest && answerAction?.callId !== state.callId) {
        throw new Error('group_answer_action_unavailable')
      }
      const rejoined = await emitAndWaitForEvent<'rejoin_call', 'call_rejoined'>(
        socket,
        'rejoin_call',
        {
          callId: state.callId,
          ...(groupGuest ? { actionId: answerAction?.actionId ?? '' } : {}),
        },
        {
          event: 'call_rejoined',
          timeoutMs: CALL_JOINED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload) => payload.callId === state.callId,
        },
      )
      assertCallSetupCurrent(restartSetupToken, rejoined.callId)

      activeCallIdRef.current = rejoined.callId
      callAnsweredRef.current = true
      telemetrySessionRef.current?.attachCall(rejoined.telemetryToken)
      const recoveredCallType = rejoined.session.callType
      useCallStore.getState().patch({
        callType: recoveredCallType,
        groupParticipantIds: rejoined.session.isGroupCall ? rejoined.session.participantIds : [],
        remoteVideoState: recoveredCallType === 'VIDEO' ? 'waiting' : 'idle',
      })
      if (recoveredCallType === 'VOICE') {
        deactivateLocalVideo()
        clearRemoteVideoRuntime('idle')
      }
      try {
        await restartConnectedTransports(socket, rejoined.callId)
        assertCallSetupCurrent(restartSetupToken, rejoined.callId)
        reconnectModeRef.current = null
        reconcileRemoteVideoSnapshot(
          new Set(
            (rejoined.activeProducers ?? [])
              .filter((producer) => producer.kind === 'video' && producer.userId !== currentUserId)
              .map((producer) => producer.producerId),
          ),
        )
        // Restore the control/audio path before optional remote video. A
        // snapshot is authoritative, but its array order must not let a slow
        // video consumer postpone audible recovery.
        const recoveredProducers = [...(rejoined.activeProducers ?? [])].sort(
          (left, right) => Number(right.kind === 'audio') - Number(left.kind === 'audio'),
        )
        for (const producer of recoveredProducers) {
          await consumeRemoteProducer(
            {
              callId: rejoined.callId,
              userId: producer.userId,
              producerId: producer.producerId,
              kind: producer.kind,
              ...(producer.paused !== undefined ? { paused: producer.paused } : {}),
              ...(producer.revision !== undefined ? { revision: producer.revision } : {}),
            },
            {
              propagateFailure: producer.kind === 'audio',
              retryOnFailure: true,
              setupToken: restartSetupToken,
            },
          )
          assertCallSetupCurrent(restartSetupToken, rejoined.callId)
        }
        markRemoteVideoSnapshotReady(recoveredCallType === 'VIDEO')
        useCallStore.getState().patch({ phase: 'active' })
        if (
          recoveredCallType === 'VIDEO' &&
          useCallStore.getState().hasCameraPermission === true &&
          !videoProducerRef.current &&
          localVideoStateRef.current.desiredEnabled
        ) {
          await activateLocalVideo({ requestPermission: false, source: 'recovery' })
          assertCallSetupCurrent(restartSetupToken, rejoined.callId)
        }
        if (
          recoveredCallType === 'VIDEO' &&
          videoProducerRef.current &&
          synchronizeLocalVideoState
        ) {
          await synchronizeLocalVideoState()
          assertCallSetupCurrent(restartSetupToken, rejoined.callId)
        }
        controlPlaneRecoveringRef.current = false
        clearReconnectTimeout()
        useCallStore.getState().patch({ reconnectDeadlineMs: null })
        startTimer(useCallStore.getState().durationSec)
        if (!markNativeCallActive(rejoined.callId)) {
          throw new Error('Native call is no longer active')
        }
        telemetrySessionRef.current?.record('reconnect_transport_connected', {
          outcome: 'succeeded',
        })
        telemetrySessionRef.current?.record('reconnect', { outcome: 'succeeded' })
        return
      } catch (error) {
        assertCallSetupCurrent(restartSetupToken, rejoined.callId)
        if (isTerminalRemoteMediaError(error)) {
          // A terminal room/producer response is not an ICE failure. Do not
          // rebuild media or retry it; the outer recovery handler performs one
          // deterministic terminal teardown for the stale call.
          throw error
        }
        console.warn(
          '[Call] ICE restart failed; rebuilding media runtime',
          JSON.stringify({
            callId: shortCallId(rejoined.callId),
            socketGeneration: socketGenerationRef.current,
            errorCode: safeCallErrorCode(error),
          }),
        )
      }

      invalidateCallSetup()
      controlPlaneRecoveringRef.current = false
      disposeMediaRuntime({ preserveActiveCall: true })
      useCallStore.getState().patch({
        phase: 'reconnecting',
        reconnectDeadlineMs: Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS,
      })
      armReconnectTimeout('recover_rebuild_timeout')
      const setupToken = beginCallSetup()
      await postAnswerSetup(rejoined, {
        recovery: true,
        resumeDurationSec: useCallStore.getState().durationSec,
        setupToken,
      })
      assertCallSetupCurrent(setupToken, rejoined.callId)
      if (
        rejoined.session.callType === 'VIDEO' &&
        !videoProducerRef.current &&
        useCallStore.getState().hasCameraPermission === true &&
        localVideoStateRef.current.desiredEnabled
      ) {
        await activateLocalVideo({ requestPermission: false, source: 'recovery' })
        assertCallSetupCurrent(setupToken, rejoined.callId)
      } else if (
        rejoined.session.callType === 'VIDEO' &&
        videoProducerRef.current &&
        synchronizeLocalVideoState
      ) {
        await synchronizeLocalVideoState()
        assertCallSetupCurrent(setupToken, rejoined.callId)
      }
      if (!markNativeCallActive(rejoined.callId)) {
        throw new Error('Native call is no longer active')
      }
      clearReconnectTimeout()
      controlPlaneRecoveringRef.current = false
      telemetrySessionRef.current?.record('reconnect', { outcome: 'succeeded' })

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
            callId: shortCallId(state.callId),
            socketGeneration: socketGenerationRef.current,
            errorCode: safeCallErrorCode(error),
          }),
        )
        // The socket may be authenticated even though the rejoin ACK was
        // lost. The socket-disconnect grace timer is cleared as soon as the
        // connection returns, so keep a bounded watchdog for this recovery
        // attempt instead of silently leaving an active call with stale media.
        // A later authenticated connect/recovery can still clear this timer
        // after it succeeds.
        useCallStore.getState().patch({
          reconnectDeadlineMs: Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS,
        })
        armReconnectTimeout('recover_rejoin_timeout')
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
    incomingAnswerActionRef,
    controlPlaneRecoveringRef,
    clearReconnectTimeout,
    clearRemoteVideoRuntime,
    consumeRemoteProducer,
    currentUserId,
    deactivateLocalVideo,
    disposeMediaRuntime,
    invalidateCallSetup,
    localVideoStateRef,
    markRemoteVideoSnapshotReady,
    reconcileRemoteVideoSnapshot,
    remoteVideoEnabledByProducerRef,
    remoteVideoRevisionByProducerRef,
    remoteVideoSnapshotReadyRef,
    postAnswerSetup,
    reconnectModeRef,
    reconnectRecoveryInFlightRef,
    restartConnectedTransports,
    markNativeCallActive,
    socketRef,
    socketGenerationRef,
    startTimer,
    synchronizeLocalVideoState,
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
      controlPlaneRecoveringRef.current ||
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
    controlPlaneRecoveringRef,
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
      if (state.isGroupCall) return
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
      if (useCallStore.getState().isGroupCall) return
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
