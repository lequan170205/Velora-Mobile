import { Camera } from 'expo-camera'
import { useCallback, useRef } from 'react'
import { AppState } from 'react-native'
import { MediaStream, mediaDevices } from 'react-native-webrtc'

import { useCallStore } from '../../stores/callStore'

import { cameraConstraints } from './callPolicies'

import type { CallSocket, CameraFacing } from '../../types/call.types'
import type { Device as MediasoupDevice } from 'mediasoup-client'
import type * as MediasoupTypes from 'mediasoup-client/types'
import type { MediaStreamTrack } from 'react-native-webrtc'

type MutableRef<T> = { current: T }

type LocalMediaRuntimeOptions = {
  socketRef: MutableRef<CallSocket | null>
  deviceRef: MutableRef<MediasoupDevice | null>
  sendTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  localStreamRef: MutableRef<MediaStream | null>
  ringingPreviewStreamRef: MutableRef<MediaStream | null>
  remoteStreamRef: MutableRef<MediaStream | null>
  videoProducerRef: MutableRef<MediasoupTypes.Producer<Record<string, unknown>> | null>
  consumerMapRef: MutableRef<Map<string, MediasoupTypes.Consumer<Record<string, unknown>>>>
  handledRemoteProducerIdsRef: MutableRef<Set<string>>
  cameraPausedByBackgroundRef: MutableRef<boolean>
  callSetupGenerationRef: MutableRef<number>
  isCallSetupCurrent: (setupToken: number, callId: string) => boolean
  presentError: (message: string) => void
}

export const useCallLocalMediaRuntime = ({
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
    (enabled: boolean) => {
      const state = useCallStore.getState()
      const socket = socketRef.current
      const producerId = videoProducerRef.current?.id
      if (
        state.phase !== 'active' ||
        state.callType !== 'VIDEO' ||
        !state.callId ||
        !producerId ||
        !socket?.connected
      ) {
        return
      }

      socket.emit('set_video_enabled', {
        callId: state.callId,
        producerId,
        enabled,
      })
    },
    [socketRef, videoProducerRef],
  )

  const deactivateLocalVideo = useCallback(() => {
    videoActivationGenerationRef.current += 1
    try {
      videoProducerRef.current?.close()
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
    useCallStore.getState().patch({
      cameraEnabled: false,
      localStreamUrl: localStream?.toURL() ?? null,
    })
  }, [cameraPausedByBackgroundRef, localStreamRef, videoProducerRef])

  const activateLocalVideo = useCallback(
    async (options?: { requestPermission?: boolean }) => {
      const state = useCallStore.getState()
      if (state.phase !== 'active' || state.callType !== 'VIDEO' || !state.callId) return false
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

        if (options?.requestPermission !== false && state.hasCameraPermission !== true) {
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
          emitLocalVideoState(true)
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
            producer.close()
            targetStream.removeTrack(track as unknown as MediaStreamTrack)
            track.stop()
            return false
          }

          videoProducerRef.current = producer
          useCallStore.getState().patch({
            cameraEnabled: true,
            localStreamUrl: targetStream.toURL(),
          })
          return true
        } catch (error) {
          try {
            targetStream.removeTrack(track as unknown as MediaStreamTrack)
          } catch {
            // The call teardown may already have removed the track.
          }
          track.stop()
          if (!isActivationCurrent()) return false
          throw error
        }
      })()

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
      deviceRef,
      emitLocalVideoState,
      ensureCameraPermission,
      isCallSetupCurrent,
      localStreamRef,
      presentError,
      sendTransportRef,
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
      }
      useCallStore.getState().patch({
        remoteVideoState: state,
        remoteStreamUrl: remoteStream?.toURL() ?? null,
      })
    },
    [consumerMapRef, handledRemoteProducerIdsRef, remoteStreamRef],
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
    if (!state.cameraEnabled) {
      try {
        await activateLocalVideo()
      } catch {
        const currentState = useCallStore.getState()
        if (
          currentState.phase === 'active' &&
          currentState.callId === state.callId &&
          currentState.callType === 'VIDEO'
        ) {
          presentError('Unable to enable video')
        }
      }
      return
    }
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) track.enabled = false
    emitLocalVideoState(false)
    useCallStore.getState().patch({ cameraEnabled: false })
  }, [activateLocalVideo, emitLocalVideoState, localStreamRef, presentError])

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
    deactivateLocalVideo,
    activateLocalVideo,
    clearRemoteVideoRuntime,
    toggleMute,
    toggleCamera,
    switchCamera,
  }
}
