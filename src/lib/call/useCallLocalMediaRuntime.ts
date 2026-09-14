import { Camera } from 'expo-camera'
import { useCallback, useRef } from 'react'
import { AppState } from 'react-native'
import { MediaStream, mediaDevices } from 'react-native-webrtc'

import { useCallStore } from '../../stores/callStore'

import {
  VIDEO_STATE_MAX_ATTEMPTS,
  VIDEO_STATE_RETRY_DELAY_MAX_MS,
  VIDEO_STATE_RETRY_DELAY_MS,
  VIDEO_STATE_UPDATED_TIMEOUT_MS,
} from './callConstants'
import { safeCallErrorCode, shortCallId } from './callDebug'
import {
  cameraConstraints,
  isCallSetupCancelledError,
  isTerminalRemoteMediaError,
} from './callPolicies'
import { createCallRequestId, emitAndWaitForEvent, isCallWaitCancelledError } from './callSocket'
import {
  applyLocalVideoAck,
  boundedRetryDelay,
  resolveLocalVideoToggleIntent,
} from './callVideoState'

import type { CallWaitRegistry } from './callSocket'
import type {
  CallSocket,
  CameraFacing,
  LocalVideoSyncState,
  LocalVideoActivationSource,
  NewProducerPayload,
  VideoStateUpdatedPayload,
} from '../../types/call.types'
import type { Device as MediasoupDevice } from 'mediasoup-client'
import type * as MediasoupTypes from 'mediasoup-client/types'
import type { MediaStreamTrack } from 'react-native-webrtc'

type MutableRef<T> = { current: T }

const debugCall = (...args: Parameters<typeof console.warn>) => {
  if (__DEV__) console.warn(...args)
}

type LocalMediaRuntimeOptions = {
  socketRef: MutableRef<CallSocket | null>
  socketGenerationRef: MutableRef<number>
  waitRegistryRef: MutableRef<CallWaitRegistry>
  deviceRef: MutableRef<MediasoupDevice | null>
  sendTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  localStreamRef: MutableRef<MediaStream | null>
  ringingPreviewStreamRef: MutableRef<MediaStream | null>
  remoteStreamRef: MutableRef<MediaStream | null>
  videoProducerRef: MutableRef<MediasoupTypes.Producer<Record<string, unknown>> | null>
  localVideoStateRef: MutableRef<LocalVideoSyncState>
  consumerMapRef: MutableRef<Map<string, MediasoupTypes.Consumer<Record<string, unknown>>>>
  handledRemoteProducerIdsRef: MutableRef<Set<string>>
  queuedRemoteProducerMapRef: MutableRef<Map<string, NewProducerPayload>>
  remoteVideoEnabledByProducerRef: MutableRef<Map<string, boolean>>
  remoteVideoRevisionByProducerRef: MutableRef<Map<string, number>>
  remoteVideoSnapshotReadyRef: MutableRef<boolean>
  cameraPausedByBackgroundRef: MutableRef<boolean>
  callSetupGenerationRef: MutableRef<number>
  isCallSetupCurrent: (setupToken: number, callId: string) => boolean
  closeLocalVideoProducer: (callId: string, producerId: string) => void
  presentError: (message: string) => void
}

export const useCallLocalMediaRuntime = ({
  socketRef,
  socketGenerationRef,
  waitRegistryRef,
  deviceRef,
  sendTransportRef,
  localStreamRef,
  ringingPreviewStreamRef,
  remoteStreamRef,
  videoProducerRef,
  localVideoStateRef,
  consumerMapRef,
  handledRemoteProducerIdsRef,
  queuedRemoteProducerMapRef,
  remoteVideoEnabledByProducerRef,
  remoteVideoRevisionByProducerRef,
  remoteVideoSnapshotReadyRef,
  cameraPausedByBackgroundRef,
  callSetupGenerationRef,
  isCallSetupCurrent,
  closeLocalVideoProducer,
  presentError,
}: LocalMediaRuntimeOptions) => {
  const videoActivationGenerationRef = useRef(0)
  const videoActivationRef = useRef<{
    callId: string
    setupToken: number
    generation: number
    promise: Promise<boolean>
  } | null>(null)
  const ensureMicPermission = useCallback(async () => {
    if (typeof Camera.requestMicrophonePermissionsAsync !== 'function') {
      throw new Error('Microphone permission API is unavailable in this build')
    }

    const permission = await Camera.requestMicrophonePermissionsAsync()
    const granted = permission.granted === true
    useCallStore.getState().patch({ hasMicPermission: granted })
    return granted
  }, [])

  const ensureCameraPermission = useCallback(async () => {
    if (typeof Camera.requestCameraPermissionsAsync !== 'function') {
      throw new Error('Camera permission API is unavailable in this build')
    }

    const permission = await Camera.requestCameraPermissionsAsync()
    const granted = permission.granted === true
    useCallStore.getState().patch({ hasCameraPermission: granted })
    return granted
  }, [])

  const stopRingingPreview = useCallback(() => {
    const preview = ringingPreviewStreamRef.current
    preview?.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        // Best-effort preview cleanup.
      }
    })
    ringingPreviewStreamRef.current = null
    if (!localStreamRef.current) useCallStore.getState().patch({ localStreamUrl: null })
  }, [localStreamRef, ringingPreviewStreamRef])

  const emitLocalVideoState = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      const state = useCallStore.getState()
      const localVideoState = localVideoStateRef.current
      localVideoState.desiredEnabled = enabled
      const socket = socketRef.current
      const producerId = videoProducerRef.current?.id
      if (
        state.phase !== 'active' ||
        state.callType !== 'VIDEO' ||
        !state.callId ||
        !producerId ||
        !socket?.connected
      ) {
        return false
      }
      const callId = state.callId

      const actionId = createCallRequestId('camera')
      const revision = Math.max(localVideoState.revision + 1, 1)
      localVideoState.revision = revision
      localVideoState.pendingActionId = actionId

      const setupToken = callSetupGenerationRef.current
      const isActionCurrent = () => {
        const currentState = useCallStore.getState()
        return (
          localVideoState.pendingActionId === actionId &&
          socketRef.current === socket &&
          socket.connected &&
          videoProducerRef.current?.id === producerId &&
          isCallSetupCurrent(setupToken, callId) &&
          currentState.phase === 'active' &&
          currentState.callId === callId &&
          currentState.callType === 'VIDEO'
        )
      }

      for (let attempt = 0; attempt < VIDEO_STATE_MAX_ATTEMPTS; attempt += 1) {
        try {
          debugCall(
            '[Call] camera_state_command',
            JSON.stringify({
              callId: shortCallId(callId),
              producerId: shortCallId(producerId),
              socketGeneration: socketGenerationRef.current,
              actionId: shortCallId(actionId),
              revision,
              enabled,
              attempt: attempt + 1,
            }),
          )
          const acknowledgement = await emitAndWaitForEvent<
            'set_video_enabled',
            'video_state_updated'
          >(
            socket,
            'set_video_enabled',
            {
              callId,
              producerId,
              enabled,
              revision,
              actionId,
              requestId: actionId,
            },
            {
              event: 'video_state_updated',
              timeoutMs: VIDEO_STATE_UPDATED_TIMEOUT_MS,
              registry: waitRegistryRef.current,
              requestId: actionId,
              filter: (payload: VideoStateUpdatedPayload) =>
                payload.callId === callId &&
                payload.producerId === producerId &&
                payload.requestId === actionId,
            },
          )

          // A late ACK from an invalidated setup or a closed producer must not
          // resurrect confirmed camera state after teardown/rebuild.
          if (
            !isCallSetupCurrent(setupToken, callId) ||
            videoProducerRef.current?.id !== producerId
          ) {
            return false
          }

          const appliedAck = applyLocalVideoAck(
            localVideoState,
            acknowledgement,
            actionId,
            revision,
          )
          Object.assign(localVideoState, appliedAck.state)

          // Keep the capture track aligned with the authoritative server bit
          // even when the command was sent during reconnect reconciliation.
          // `cameraEnabled` remains ACK-driven below; the native track can be
          // prepared before the UI flips back to on.
          const localVideoTrack = localStreamRef.current?.getVideoTracks()[0]
          if (localVideoTrack) localVideoTrack.enabled = acknowledgement.enabled

          debugCall(
            '[Call] camera_state_ack',
            JSON.stringify({
              callId: shortCallId(callId),
              producerId: shortCallId(producerId),
              socketGeneration: socketGenerationRef.current,
              actionId: shortCallId(actionId),
              revision: acknowledgement.revision,
              enabled: acknowledgement.enabled,
              status: acknowledgement.status,
            }),
          )

          if (appliedAck.staleAuthoritativeEnabled !== undefined) {
            useCallStore.getState().patch({
              cameraEnabled: appliedAck.staleAuthoritativeEnabled,
            })
          } else if (appliedAck.isLatestAction) {
            // Recovery reconciliation also uses this path, without going
            // through activateLocalVideo's optimistic UI update. Keep the
            // visible bit tied to the ACKed state in both cases.
            useCallStore.getState().patch({
              cameraEnabled: appliedAck.state.confirmedEnabled,
            })
          }
          return appliedAck.accepted
        } catch (error) {
          if (
            !isActionCurrent() ||
            isCallWaitCancelledError(error) ||
            isCallSetupCancelledError(error) ||
            isTerminalRemoteMediaError(error) ||
            attempt === VIDEO_STATE_MAX_ATTEMPTS - 1
          ) {
            debugCall(
              '[Call] camera_state_command_failed',
              JSON.stringify({
                callId: shortCallId(callId),
                producerId: shortCallId(producerId),
                socketGeneration: socketGenerationRef.current,
                actionId: shortCallId(actionId),
                revision,
                attempt: attempt + 1,
                errorCode: safeCallErrorCode(error),
              }),
            )
            break
          }

          const retryDelay = boundedRetryDelay(
            attempt,
            VIDEO_STATE_RETRY_DELAY_MS,
            VIDEO_STATE_RETRY_DELAY_MAX_MS,
          )
          await new Promise<void>((resolve) => setTimeout(resolve, retryDelay))
          if (!isActionCurrent()) break
        }
      }

      if (localVideoState.pendingActionId === actionId) {
        localVideoState.pendingActionId = null
      }
      return false
    },
    [
      callSetupGenerationRef,
      isCallSetupCurrent,
      localVideoStateRef,
      localStreamRef,
      socketRef,
      socketGenerationRef,
      videoProducerRef,
      waitRegistryRef,
    ],
  )

  const synchronizeLocalVideoState = useCallback(async () => {
    if (!videoProducerRef.current) return false
    return emitLocalVideoState(localVideoStateRef.current.desiredEnabled)
  }, [emitLocalVideoState, localVideoStateRef, videoProducerRef])

  const deactivateLocalVideo = useCallback(() => {
    videoActivationGenerationRef.current += 1
    const callId = useCallStore.getState().callId
    const currentVideoProducer = videoProducerRef.current
    if (callId && currentVideoProducer) {
      // mediasoup-client Producer.close() only tears down the local sender.
      // Signal the server before dropping the reference so a cancelled
      // activation cannot leave an unowned producer in the call room.
      closeLocalVideoProducer(callId, currentVideoProducer.id)
    }
    try {
      currentVideoProducer?.close()
    } catch {
      // The server may already have closed the producer during a downgrade.
    }
    videoProducerRef.current = null

    const localStream = localStreamRef.current
    localStream?.getVideoTracks().forEach((track) => {
      try {
        localStream.removeTrack(track)
      } catch {
        // Best-effort media cleanup; the native resource may already be closed.
      }
      try {
        track.stop()
      } catch {
        // Best-effort media cleanup; the native resource may already be closed.
      }
    })

    cameraPausedByBackgroundRef.current = false
    localVideoStateRef.current.desiredEnabled = false
    localVideoStateRef.current.confirmedEnabled = false
    localVideoStateRef.current.revision = 0
    localVideoStateRef.current.pendingActionId = null
    useCallStore.getState().patch({
      cameraEnabled: false,
      localStreamUrl: localStream?.toURL() ?? null,
    })
  }, [
    cameraPausedByBackgroundRef,
    closeLocalVideoProducer,
    localStreamRef,
    localVideoStateRef,
    videoProducerRef,
  ])

  const activateLocalVideo = useCallback(
    async (options?: { requestPermission?: boolean; source?: LocalVideoActivationSource }) => {
      const state = useCallStore.getState()
      if (state.phase !== 'active' || state.callType !== 'VIDEO' || !state.callId) return false
      const source = options?.source ?? 'user'
      const shouldRequestPermission = options?.requestPermission ?? source === 'user'
      localVideoStateRef.current.desiredEnabled = true
      const callId = state.callId
      const setupToken = callSetupGenerationRef.current
      const activationGeneration = videoActivationGenerationRef.current
      const existingActivation = videoActivationRef.current
      if (
        existingActivation?.callId === callId &&
        existingActivation.setupToken === setupToken &&
        existingActivation.generation === activationGeneration
      ) {
        return existingActivation.promise
      }

      // A disconnected control plane cannot acknowledge a newly created
      // producer. Preserve the user's desired state and let rejoin/recovery
      // reconcile it instead of capturing camera media that cannot be
      // published yet.
      if (!socketRef.current?.connected && !videoProducerRef.current) {
        return false
      }

      const resetUserIntentAfterFailure = () => {
        if (
          source === 'user' &&
          socketRef.current?.connected &&
          activationGeneration === videoActivationGenerationRef.current &&
          isCallSetupCurrent(setupToken, callId)
        ) {
          localVideoStateRef.current.desiredEnabled = false
        }
      }

      const activationPromise = (async () => {
        const isActivationCurrent = () => {
          const currentState = useCallStore.getState()
          return (
            activationGeneration === videoActivationGenerationRef.current &&
            isCallSetupCurrent(setupToken, callId) &&
            currentState.phase === 'active' &&
            currentState.callId === callId &&
            currentState.callType === 'VIDEO' &&
            AppState.currentState === 'active'
          )
        }

        if (shouldRequestPermission && state.hasCameraPermission !== true) {
          const granted = await ensureCameraPermission()
          if (!isActivationCurrent()) return false
          if (!granted) {
            presentError('Velora needs camera access for video calls')
            return false
          }
        }

        const existingTrack = localStreamRef.current?.getVideoTracks()[0]
        if (existingTrack && existingTrack.readyState === 'live') {
          if (!isActivationCurrent()) return false
          existingTrack.enabled = true
          const stateApplied = await emitLocalVideoState(true)
          if (!isActivationCurrent()) return false
          if (!stateApplied) {
            if (!socketRef.current?.connected) {
              // Keep the capture ready for recovery. The UI remains off until
              // the reconnect ACK arrives, but the desired intent is not lost.
              existingTrack.enabled = true
              return false
            }
            existingTrack.enabled = false
            // The command did not become authoritative. Leave the producer
            // reusable, but reset the desired bit so the next user tap is an
            // explicit activation retry instead of being interpreted as an
            // implicit camera-off action.
            localVideoStateRef.current.desiredEnabled = false
            return false
          }
          useCallStore.getState().patch({
            cameraEnabled: true,
            localStreamUrl: localStreamRef.current?.toURL() ?? null,
          })
          return true
        }

        const sendTransport = sendTransportRef.current
        const device = deviceRef.current
        if (!sendTransport || !device?.loaded || !device.canProduce('video')) {
          presentError('Video is unavailable on this call')
          return false
        }

        let stream: MediaStream
        try {
          stream = await mediaDevices.getUserMedia({
            audio: false,
            video: cameraConstraints(state.cameraFacing),
          })
        } catch (error) {
          if (!isActivationCurrent()) return false
          throw error
        }
        const track = stream.getVideoTracks()[0]
        if (!track) {
          stream.getTracks().forEach((candidate) => candidate.stop())
          throw new Error('No local video track available')
        }
        if (!isActivationCurrent() || sendTransportRef.current !== sendTransport) {
          stream.getTracks().forEach((candidate) => candidate.stop())
          return false
        }

        if (!localStreamRef.current) localStreamRef.current = new MediaStream()
        const targetStream = localStreamRef.current
        targetStream.addTrack(track as unknown as MediaStreamTrack)

        try {
          const producer = await sendTransport.produce({ track: track as never, stopTracks: false })
          if (
            !isActivationCurrent() ||
            sendTransportRef.current !== sendTransport ||
            localStreamRef.current !== targetStream
          ) {
            closeLocalVideoProducer(callId, producer.id)
            producer.close()
            targetStream.removeTrack(track as unknown as MediaStreamTrack)
            track.stop()
            return false
          }

          videoProducerRef.current = producer
          const stateApplied = await emitLocalVideoState(true)
          if (!isActivationCurrent()) {
            videoProducerRef.current = null
            closeLocalVideoProducer(callId, producer.id)
            producer.close()
            targetStream.removeTrack(track as unknown as MediaStreamTrack)
            track.stop()
            return false
          }
          if (!stateApplied) {
            if (!socketRef.current?.connected) {
              // The producer was accepted, but the camera command could not
              // be acknowledged while the socket was down. Keep both refs so
              // reconnect reconciliation can send the retained desired bit.
              track.enabled = true
              useCallStore.getState().patch({
                cameraEnabled: false,
                localStreamUrl: targetStream.toURL(),
              })
              return false
            }
            track.enabled = false
            localVideoStateRef.current.desiredEnabled = false
            useCallStore.getState().patch({
              cameraEnabled: false,
              localStreamUrl: targetStream.toURL(),
            })
            return false
          }
          useCallStore.getState().patch({
            cameraEnabled: true,
            localStreamUrl: targetStream.toURL(),
          })
          return true
        } catch (error) {
          const currentProducer = videoProducerRef.current
          if (currentProducer) {
            videoProducerRef.current = null
            closeLocalVideoProducer(callId, currentProducer.id)
            try {
              currentProducer.close()
            } catch {
              // Best-effort cleanup after a failed producer command.
            }
          }
          try {
            targetStream.removeTrack(track as unknown as MediaStreamTrack)
          } catch {
            // The call teardown may already have removed the track.
          }
          track.stop()
          if (!isActivationCurrent()) return false
          throw error
        }
      })().then(
        (activated) => {
          if (!activated) resetUserIntentAfterFailure()
          return activated
        },
        (error) => {
          resetUserIntentAfterFailure()
          throw error
        },
      )

      const activation = {
        callId,
        setupToken,
        generation: activationGeneration,
        promise: activationPromise,
      }
      videoActivationRef.current = activation
      try {
        return await activationPromise
      } finally {
        if (videoActivationRef.current === activation) {
          videoActivationRef.current = null
        }
      }
    },
    [
      callSetupGenerationRef,
      closeLocalVideoProducer,
      deviceRef,
      emitLocalVideoState,
      ensureCameraPermission,
      localVideoStateRef,
      isCallSetupCurrent,
      localStreamRef,
      presentError,
      sendTransportRef,
      socketRef,
      videoProducerRef,
    ],
  )

  const clearRemoteVideoRuntime = useCallback(
    (state: 'idle' | 'off' = 'off') => {
      const remoteStream = remoteStreamRef.current
      for (const [consumerId, consumer] of consumerMapRef.current.entries()) {
        if (consumer.kind !== 'video') continue
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
        handledRemoteProducerIdsRef.current.delete(consumer.producerId)
        remoteVideoEnabledByProducerRef.current.delete(consumer.producerId)
        remoteVideoRevisionByProducerRef.current.delete(consumer.producerId)
      }
      remoteVideoEnabledByProducerRef.current.clear()
      remoteVideoRevisionByProducerRef.current.clear()
      for (const [producerId, payload] of queuedRemoteProducerMapRef.current) {
        if (payload.kind === 'video') queuedRemoteProducerMapRef.current.delete(producerId)
      }
      remoteVideoSnapshotReadyRef.current = false
      useCallStore.getState().patch({
        remoteVideoState: state,
        remoteStreamUrl: remoteStream?.toURL() ?? null,
      })
    },
    [
      consumerMapRef,
      handledRemoteProducerIdsRef,
      queuedRemoteProducerMapRef,
      remoteStreamRef,
      remoteVideoEnabledByProducerRef,
      remoteVideoRevisionByProducerRef,
      remoteVideoSnapshotReadyRef,
    ],
  )

  const toggleMute = useCallback(() => {
    const localAudioTrack = localStreamRef.current?.getAudioTracks()[0]
    if (!localAudioTrack) return
    const nextMuted = !useCallStore.getState().muted
    localAudioTrack.enabled = !nextMuted
    useCallStore.getState().patch({ muted: nextMuted })
  }, [localStreamRef])

  const toggleCamera = useCallback(async () => {
    const state = useCallStore.getState()
    if (state.phase !== 'active' || state.callType !== 'VIDEO') return
    const activation = videoActivationRef.current
    const intent = resolveLocalVideoToggleIntent({
      phase: state.phase,
      callType: state.callType,
      cameraEnabled: state.cameraEnabled,
      desiredEnabled: localVideoStateRef.current.desiredEnabled,
      confirmedEnabled: localVideoStateRef.current.confirmedEnabled,
      hasProducer: Boolean(videoProducerRef.current),
      activationInFlight: Boolean(
        activation &&
        activation.callId === state.callId &&
        activation.setupToken === callSetupGenerationRef.current &&
        activation.generation === videoActivationGenerationRef.current,
      ),
      socketConnected: Boolean(socketRef.current?.connected),
    })

    if (intent === 'noop') return
    if (intent === 'activate') {
      try {
        await activateLocalVideo({ source: 'user' })
      } catch {
        const currentState = useCallStore.getState()
        if (
          currentState.phase === 'active' &&
          currentState.callId === state.callId &&
          currentState.callType === 'VIDEO'
        ) {
          if (socketRef.current?.connected) presentError('Unable to enable video')
        }
      }
      return
    }

    // A second tap while camera activation is still awaiting permission or a
    // producer ACK must cancel that in-flight activation instead of starting a
    // second capture attempt. Once a producer exists, keep it stable and only
    // publish the versioned enabled=false state below.
    if (intent === 'cancel_activation' || !videoProducerRef.current) {
      deactivateLocalVideo()
      return
    }

    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) track.enabled = false
    localVideoStateRef.current.desiredEnabled = false
    void emitLocalVideoState(false)
    useCallStore.getState().patch({ cameraEnabled: false })
  }, [
    activateLocalVideo,
    deactivateLocalVideo,
    emitLocalVideoState,
    callSetupGenerationRef,
    localStreamRef,
    localVideoStateRef,
    presentError,
    socketRef,
    videoActivationGenerationRef,
    videoActivationRef,
    videoProducerRef,
  ])

  const switchCamera = useCallback(async () => {
    const state = useCallStore.getState()
    if (
      state.phase !== 'active' ||
      state.callType !== 'VIDEO' ||
      !state.callId ||
      !state.cameraEnabled
    )
      return
    const callId = state.callId
    const setupToken = callSetupGenerationRef.current
    const nextFacing: CameraFacing = state.cameraFacing === 'user' ? 'environment' : 'user'
    const track = localStreamRef.current?.getVideoTracks()[0] as
      | (MediaStreamTrack & {
          applyConstraints?: (constraints: { facingMode?: CameraFacing }) => Promise<void>
          _switchCamera?: () => void
        })
      | undefined
    if (!track) return
    const isCameraSwitchCurrent = () => {
      const currentState = useCallStore.getState()
      return (
        isCallSetupCurrent(setupToken, callId) &&
        currentState.phase === 'active' &&
        currentState.callId === callId &&
        currentState.callType === 'VIDEO' &&
        localStreamRef.current?.getVideoTracks()[0] === track
      )
    }

    if (track.applyConstraints) {
      try {
        await track.applyConstraints({ facingMode: nextFacing })
        if (!isCameraSwitchCurrent()) return
        useCallStore.getState().patch({ cameraFacing: nextFacing })
        return
      } catch {
        // Fall back to the legacy react-native-webrtc camera switch when constraints fail.
      }
    }

    if (!isCameraSwitchCurrent()) return
    if (!track._switchCamera) return
    try {
      track._switchCamera()
      useCallStore.getState().patch({ cameraFacing: nextFacing })
    } catch {
      if (isCameraSwitchCurrent()) presentError('Unable to switch camera')
    }
  }, [callSetupGenerationRef, isCallSetupCurrent, localStreamRef, presentError])

  return {
    ensureMicPermission,
    ensureCameraPermission,
    stopRingingPreview,
    emitLocalVideoState,
    synchronizeLocalVideoState,
    deactivateLocalVideo,
    activateLocalVideo,
    clearRemoteVideoRuntime,
    toggleMute,
    toggleCamera,
    switchCamera,
  }
}
