import { useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { Camera } from 'expo-camera'
import { useRouter } from 'expo-router'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { AppState, Platform } from 'react-native'
import { MediaStream, mediaDevices } from 'react-native-webrtc'

import { getCallState, type CallStateResponse } from '../api/call.api'
import { queryKeys } from '../constants/queryKeys'
import {
  authenticateCallSocket,
  clearWaitRegistry,
  createCallSocket,
  emitAndWaitForEvent,
  type CallWaitRegistry,
  waitForEventWhere,
} from '../lib/call/callSocket'
import {
  createMediasoupDevice,
  ensureMediasoupGlobalsRegistered,
  toRouterRtpCapabilities,
  toTransportOptions,
} from '../lib/call/mediasoup'
import {
  veloraSystemCalls,
  type NativeCallAction,
  type NativeCallPayload,
} from '../lib/systemCalls/veloraSystemCalls'
import { useAuthStore } from '../stores/authStore'
import { useCallStore } from '../stores/callStore'

import type {
  CallAnsweredPayload,
  CallEndedPayload,
  CallJoinedPayload,
  CallRejoinedPayload,
  CallRejectedPayload,
  CallSocket,
  CallSocketReadyPayload,
  CallType,
  CameraFacing,
  IncomingCallPayload,
  NewProducerPayload,
  PeerLeftPayload,
  PeerReconnectedPayload,
  PeerReconnectingPayload,
  ProducerClosedPayload,
  StartCallInput,
  TransportCreatedPayload,
  UseCallValue,
} from '../types/call.types'
import type { Conversation } from '../types/conversation.types'
import type { Device as MediasoupDevice } from 'mediasoup-client'
import type * as MediasoupTypes from 'mediasoup-client/types'
import type { MediaStreamTrack } from 'react-native-webrtc'

const CALL_JOINED_TIMEOUT_MS = 10_000
const SOCKET_CONNECT_TIMEOUT_MS = 10_000
const TRANSPORT_TIMEOUT_MS = 10_000
const CONSUMER_TIMEOUT_MS = 10_000
const DEFAULT_NO_ANSWER_TIMEOUT_MS = 30_000
const RECONNECT_GRACE_MS = (() => {
  const configured = Number(process.env.EXPO_PUBLIC_CALL_RECONNECT_GRACE_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : 15_000
})()
const IOS_AUDIO_SESSION_TIMEOUT_MS = 15_000
const VOICE_OPUS_CODEC_OPTIONS = {
  opusFec: true,
  opusDtx: true,
  opusNack: true,
  opusMaxAverageBitrate: 48_000,
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

const isBusyPhase = (phase: ReturnType<typeof useCallStore.getState>['phase']) => phase !== 'idle'
const isTerminalStatus = (status: CallStateResponse['status']) =>
  status === 'ended' || status === 'cancelled' || status === 'rejected'

const getConversationsFromCache = (value: unknown) => {
  if (Array.isArray(value)) return value as Conversation[]
  return ((value as { pages?: Conversation[][] } | undefined)?.pages?.flat() ?? []) as Conversation[]
}

const getPeerInfoFromConversation = ({
  conversationId,
  currentUserId,
  fallbackPeerUserId,
  queryClient,
}: {
  conversationId: string
  currentUserId: string
  fallbackPeerUserId?: string
  queryClient: ReturnType<typeof useQueryClient>
}) => {
  const conversations = getConversationsFromCache(
    queryClient.getQueryData<unknown>(queryKeys.conversations.all),
  )
  const conversation = conversations.find((entry) => entry.id === conversationId) ?? null
  const peer = conversation?.participants?.find((participant) => participant.id !== currentUserId) ?? null

  return {
    peerUserId: peer?.id ?? fallbackPeerUserId ?? null,
    peerName: peer?.name ?? peer?.fullName ?? peer?.email ?? null,
    peerAvatarUrl: peer?.picture ?? null,
  }
}

const toNativeIncomingCallPayload = (
  payload: IncomingCallPayload | CallStateResponse,
): NativeCallPayload => ({
  type: 'INCOMING_CALL',
  callId: payload.callId,
  conversationId: payload.conversationId,
  initiatorId: payload.initiatorId,
  targetUserId: payload.targetUserId,
  recipientUserId: payload.recipientUserId,
  callType: payload.callType,
  initiatorDisplayName: payload.initiatorDisplayName,
  ...(payload.initiatorAvatarUrl ? { initiatorAvatarUrl: payload.initiatorAvatarUrl } : {}),
  ringTimeoutMs: payload.ringTimeoutMs,
  expiresAt: payload.expiresAt,
})

const callEndedMessage = (payload: CallEndedPayload) => {
  if (payload.reason === 'no_answer') return 'No one answered'
  if (payload.reason === 'cancelled') return 'The caller canceled the call'
  if (payload.reason === 'disconnected') return 'The call was interrupted'
  if (payload.reason === 'remote_audio_not_ready') return 'The other person could not activate call audio'
  if (payload.reason === 'remote_accept_failed') return 'The other person could not answer the call'
  return null
}

const callRejectedMessage = (payload: CallRejectedPayload) => {
  if (payload.reason === 'busy') return 'The other person is on another call'
  if (payload.reason === 'mic_permission_denied') return 'The other person needs microphone access'
  if (payload.reason === 'camera_permission_denied') return 'The other person needs camera access'
  return 'The call was rejected'
}

const cameraConstraints = (facing: CameraFacing) => ({
  facingMode: facing,
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
})

const stopStream = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop()
    } catch {
      // Best-effort native media cleanup.
    }
  })
}

export const useCall = () => useContext(CallContext)

export function CallProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { isAuthenticated, isLoading, user } = useAuthStore()
  const currentUserId = user?.id ?? null

  const socketRef = useRef<CallSocket | null>(null)
  const socketReadyRef = useRef(false)
  const socketPromiseRef = useRef<Promise<CallSocket> | null>(null)
  const waitRegistryRef = useRef<CallWaitRegistry>(new Set())
  const activeCallIdRef = useRef<string | null>(null)

  const deviceRef = useRef<MediasoupDevice | null>(null)
  const sendTransportRef = useRef<MediasoupTypes.Transport<Record<string, unknown>> | null>(null)
  const recvTransportRef = useRef<MediasoupTypes.Transport<Record<string, unknown>> | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const ringingPreviewStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const audioProducerRef = useRef<MediasoupTypes.Producer<Record<string, unknown>> | null>(null)
  const videoProducerRef = useRef<MediasoupTypes.Producer<Record<string, unknown>> | null>(null)
  const consumersByProducerRef = useRef<
    Map<string, MediasoupTypes.Consumer<Record<string, unknown>>>
  >(new Map())
  const queuedProducerRef = useRef<Map<string, NewProducerPayload>>(new Map())
  const consumingProducerIdsRef = useRef(new Set<string>())

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectingRef = useRef(false)
  const mediaSetupRef = useRef(false)
  const teardownRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerStartedAtRef = useRef<number | null>(null)
  const cameraPausedByBackgroundRef = useRef(false)
  const lastAppStateRef = useRef(AppState.currentState)
  const nativeActionIdsRef = useRef(new Set<string>())

  const setError = useCallback((message: string | null) => {
    useCallStore.getState().patch({ error: message })
  }, [])

  const stopDurationTimer = useCallback((reset = true) => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    timerStartedAtRef.current = null
    if (reset) useCallStore.getState().setDurationSec(0)
  }, [])

  const startDurationTimer = useCallback(
    (initialDurationSec = 0) => {
      stopDurationTimer(false)
      timerStartedAtRef.current = Date.now() - initialDurationSec * 1000
      useCallStore.getState().setDurationSec(initialDurationSec)
      timerRef.current = setInterval(() => {
        const start = timerStartedAtRef.current
        if (!start) return
        useCallStore.getState().setDurationSec(Math.max(0, Math.floor((Date.now() - start) / 1000)))
      }, 1000)
    },
    [stopDurationTimer],
  )

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = null
  }, [])

  const closeRemoteConsumers = useCallback(() => {
    for (const consumer of consumersByProducerRef.current.values()) {
      try {
        consumer.close()
      } catch {
        // Best effort.
      }
    }
    consumersByProducerRef.current.clear()
    queuedProducerRef.current.clear()
    consumingProducerIdsRef.current.clear()
    stopStream(remoteStreamRef.current)
    remoteStreamRef.current = null
    useCallStore.getState().patch({
      remoteStreamUrl: null,
      remoteAudioState: 'waiting',
      remoteVideoState: useCallStore.getState().callType === 'VIDEO' ? 'waiting' : 'idle',
    })
  }, [])

  const disposeMedia = useCallback(
    (preserveCallState = false) => {
      closeRemoteConsumers()
      try {
        audioProducerRef.current?.close()
      } catch {}
      try {
        videoProducerRef.current?.close()
      } catch {}
      try {
        sendTransportRef.current?.close()
      } catch {}
      try {
        recvTransportRef.current?.close()
      } catch {}
      stopStream(localStreamRef.current)
      stopStream(ringingPreviewStreamRef.current)
      localStreamRef.current = null
      ringingPreviewStreamRef.current = null
      audioProducerRef.current = null
      videoProducerRef.current = null
      sendTransportRef.current = null
      recvTransportRef.current = null
      deviceRef.current = null
      mediaSetupRef.current = false
      if (!preserveCallState) {
        activeCallIdRef.current = null
      }
      useCallStore.getState().patch({ localStreamUrl: null })
    },
    [closeRemoteConsumers],
  )

  const teardown = useCallback(
    async (options?: { error?: string | null; endNative?: boolean }) => {
      if (teardownRef.current) return
      teardownRef.current = true
      clearReconnectTimer()
      reconnectingRef.current = false
      stopDurationTimer()
      const callId = activeCallIdRef.current ?? useCallStore.getState().callId
      if (callId && options?.endNative !== false) {
        void veloraSystemCalls.endCall(callId)
      }
      disposeMedia(false)
      clearWaitRegistry(waitRegistryRef.current)
      useCallStore.getState().reset()
      if (options?.error) useCallStore.getState().patch({ error: options.error })
      teardownRef.current = false
    },
    [clearReconnectTimer, disposeMedia, stopDurationTimer],
  )

  const ensureMicPermission = useCallback(async () => {
    const result = await Camera.requestMicrophonePermissionsAsync()
    const granted = result.granted === true
    useCallStore.getState().patch({ hasMicPermission: granted })
    return granted
  }, [])

  const ensureCameraPermission = useCallback(async () => {
    const result = await Camera.requestCameraPermissionsAsync()
    const granted = result.granted === true
    useCallStore.getState().patch({ hasCameraPermission: granted })
    return granted
  }, [])

  const ensureAuthenticated = useCallback(async () => {
    const state = useAuthStore.getState()
    if (state.isAuthenticated && state.user?.id) return
    await state.hydrateAuth({ silent: true })
    const restored = useAuthStore.getState()
    if (!restored.isAuthenticated || !restored.user?.id) throw new Error('auth_not_restored')
  }, [])

  const waitForIosAudioSession = useCallback(async () => {
    if (Platform.OS !== 'ios') return
    const deadline = Date.now() + IOS_AUDIO_SESSION_TIMEOUT_MS
    while (Date.now() < deadline) {
      const state = await veloraSystemCalls.getNativeAudioSessionState()
      if (state.isActivated && state.isAudioEnabled) return
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error('audio_session_timeout')
  }, [])

  const ensureSocket = useCallback(async (): Promise<CallSocket> => {
    if (socketRef.current?.connected && socketReadyRef.current) return socketRef.current
    if (socketPromiseRef.current) return socketPromiseRef.current

    socketPromiseRef.current = (async () => {
      await ensureAuthenticated()
      let socket = socketRef.current
      if (!socket) {
        socket = createCallSocket()
        socketRef.current = socket
      }
      socketReadyRef.current = false
      await authenticateCallSocket(socket)

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const cleanup = () => {
          clearTimeout(timeoutId)
          socket.off('call_socket_ready', onReady)
          socket.off('connect_error', onError)
          socket.off('disconnect', onDisconnect)
        }
        const settle = (error?: Error) => {
          if (settled) return
          settled = true
          cleanup()
          error ? reject(error) : resolve()
        }
        const onReady = (payload: CallSocketReadyPayload) => {
          socketReadyRef.current = true
          for (const terminal of payload.recentTerminalCalls ?? []) {
            if (terminal.callId === activeCallIdRef.current) {
              void teardown({ error: callEndedMessage(terminal) })
            }
          }
          settle()
        }
        const onError = () => settle(new Error('network_unavailable'))
        const onDisconnect = () => settle(new Error('network_unavailable'))
        const timeoutId = setTimeout(() => settle(new Error('socket_connect_timeout')), SOCKET_CONNECT_TIMEOUT_MS)
        socket.once('call_socket_ready', onReady)
        socket.once('connect_error', onError)
        socket.once('disconnect', onDisconnect)
        if (socket.connected) socket.disconnect()
        socket.connect()
      })
      return socket
    })()

    try {
      return await socketPromiseRef.current
    } finally {
      socketPromiseRef.current = null
    }
  }, [ensureAuthenticated, teardown])

  const ensureDevice = useCallback(async (payload: CallJoinedPayload | CallRejoinedPayload) => {
    if (deviceRef.current?.loaded) return deviceRef.current
    ensureMediasoupGlobalsRegistered()
    const device = createMediasoupDevice()
    await device.load({ routerRtpCapabilities: toRouterRtpCapabilities(payload.rtpCapabilities) })
    deviceRef.current = device
    return device
  }, [])

  const createTransport = useCallback(
    async (
      socket: CallSocket,
      callId: string,
      direction: 'send' | 'recv',
      device: MediasoupDevice,
    ) => {
      const created = await emitAndWaitForEvent(socket, 'create_transport', { callId, direction }, {
        event: 'transport_created',
        timeoutMs: TRANSPORT_TIMEOUT_MS,
        registry: waitRegistryRef.current,
        filter: (payload: TransportCreatedPayload) => payload.callId === callId && payload.direction === direction,
      })
      const transport = direction === 'send'
        ? device.createSendTransport<Record<string, unknown>>(toTransportOptions(created))
        : device.createRecvTransport<Record<string, unknown>>(toTransportOptions(created))

      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        void emitAndWaitForEvent(socket, 'connect_transport', {
          callId,
          transportId: transport.id,
          dtlsParameters: dtlsParameters as unknown as Record<string, unknown>,
        }, {
          event: 'transport_connected',
          timeoutMs: TRANSPORT_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload) => payload.callId === callId && payload.transportId === transport.id,
        }).then(() => callback()).catch((error) => errback(error instanceof Error ? error : new Error('transport_connect_failed')))
      })

      if (direction === 'send') {
        transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
          const mediaKind = kind as 'audio' | 'video'
          void emitAndWaitForEvent(socket, 'produce', {
            callId,
            transportId: transport.id,
            kind: mediaKind,
            rtpParameters: rtpParameters as unknown as Record<string, unknown>,
          }, {
            event: 'new_producer',
            timeoutMs: TRANSPORT_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload) =>
              payload.callId === callId && payload.userId === currentUserId && payload.kind === mediaKind,
          }).then((payload) => callback({ id: payload.producerId }))
            .catch((error) => errback(error instanceof Error ? error : new Error('produce_failed')))
        })
      }

      transport.on('connectionstatechange', (state) => {
        const callState = useCallStore.getState()
        if (callState.phase !== 'active' || callState.callId !== callId) return
        if (state === 'failed') {
          void recoverCall('transport_failed')
        }
      })
      return transport
    },
    // recoverCall is intentionally resolved through the callback closure at event time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId],
  )

  const consumeProducer = useCallback(
    async (payload: NewProducerPayload) => {
      const state = useCallStore.getState()
      if (!state.callId || payload.callId !== state.callId || payload.userId === currentUserId) return
      if (consumersByProducerRef.current.has(payload.producerId) || consumingProducerIdsRef.current.has(payload.producerId)) return

      const socket = socketRef.current
      const device = deviceRef.current
      const recvTransport = recvTransportRef.current
      if (!socket?.connected || !device?.loaded || !recvTransport) {
        queuedProducerRef.current.set(payload.producerId, payload)
        return
      }

      consumingProducerIdsRef.current.add(payload.producerId)
      try {
        const created = await emitAndWaitForEvent(socket, 'consume', {
          callId: payload.callId,
          transportId: recvTransport.id,
          producerId: payload.producerId,
          rtpCapabilities: device.rtpCapabilities as unknown as Record<string, unknown>,
        }, {
          event: 'consumer_created',
          timeoutMs: CONSUMER_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (event) => event.callId === payload.callId && event.producerId === payload.producerId,
        })

        const consumer = await recvTransport.consume({
          id: created.consumerId,
          producerId: created.producerId,
          kind: created.kind,
          rtpParameters: created.rtpParameters as never,
        })
        consumersByProducerRef.current.set(payload.producerId, consumer)
        if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream()
        remoteStreamRef.current.addTrack(consumer.track as unknown as MediaStreamTrack)

        await emitAndWaitForEvent(socket, 'resume_consumer', {
          callId: payload.callId,
          consumerId: consumer.id,
        }, {
          event: 'consumer_resumed',
          timeoutMs: CONSUMER_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (event) => event.callId === payload.callId && event.consumerId === consumer.id,
        })

        queuedProducerRef.current.delete(payload.producerId)
        const patch = {
          remoteStreamUrl: remoteStreamRef.current.toURL(),
          ...(payload.kind === 'audio' ? { remoteAudioState: 'connected' as const } : { remoteVideoState: 'connected' as const }),
        }
        useCallStore.getState().patch(patch)

        if (payload.kind === 'audio' && reconnectingRef.current) {
          reconnectingRef.current = false
          clearReconnectTimer()
          useCallStore.getState().patch({ phase: 'active', reconnectDeadlineMs: null })
          startDurationTimer(useCallStore.getState().durationSec)
        }
      } catch (error) {
        queuedProducerRef.current.set(payload.producerId, payload)
        if (useCallStore.getState().phase !== 'reconnecting') {
          console.warn('[Call] Failed to consume producer', error)
        }
      } finally {
        consumingProducerIdsRef.current.delete(payload.producerId)
      }
    },
    [clearReconnectTimer, currentUserId, startDurationTimer],
  )

  const flushQueuedProducers = useCallback(async () => {
    for (const payload of [...queuedProducerRef.current.values()]) {
      await consumeProducer(payload)
    }
  }, [consumeProducer])

  const produceVideoTrack = useCallback(async (track: MediaStreamTrack) => {
    const device = deviceRef.current
    const sendTransport = sendTransportRef.current
    if (!device?.loaded || !device.canProduce('video') || !sendTransport) {
      throw new Error('Video transport is unavailable')
    }
    const producer = await sendTransport.produce({ track: track as never, stopTracks: false })
    videoProducerRef.current = producer
    return producer
  }, [])

  const setupMedia = useCallback(
    async (payload: CallJoinedPayload | CallRejoinedPayload, resumeDurationSec = 0) => {
      if (mediaSetupRef.current) return
      mediaSetupRef.current = true
      const callId = payload.callId
      try {
        const socket = await ensureSocket()
        const device = await ensureDevice(payload)
        const callType = payload.session.callType
        useCallStore.getState().patch({
          callType,
          remoteAudioState: 'waiting',
          remoteVideoState: callType === 'VIDEO' ? 'waiting' : 'idle',
        })

        const facing = useCallStore.getState().cameraFacing
        const [recvTransport, sendTransport, localStream] = await Promise.all([
          createTransport(socket, callId, 'recv', device),
          createTransport(socket, callId, 'send', device),
          mediaDevices.getUserMedia({
            audio: true,
            video: callType === 'VIDEO' ? cameraConstraints(facing) : false,
          }),
        ])
        recvTransportRef.current = recvTransport
        sendTransportRef.current = sendTransport
        localStreamRef.current = localStream

        stopStream(ringingPreviewStreamRef.current)
        ringingPreviewStreamRef.current = null

        const audioTrack = localStream.getAudioTracks()[0]
        if (!audioTrack || !device.canProduce('audio')) throw new Error('Audio track is unavailable')
        audioTrack.enabled = !useCallStore.getState().muted
        audioProducerRef.current = await sendTransport.produce({
          track: audioTrack as never,
          codecOptions: VOICE_OPUS_CODEC_OPTIONS,
          stopTracks: false,
        })

        if (callType === 'VIDEO') {
          const videoTrack = localStream.getVideoTracks()[0]
          if (!videoTrack) throw new Error('Camera track is unavailable')
          videoTrack.enabled = true
          await produceVideoTrack(videoTrack as unknown as MediaStreamTrack)
          useCallStore.getState().patch({ cameraEnabled: true, localStreamUrl: localStream.toURL() })
        } else {
          useCallStore.getState().patch({ cameraEnabled: false, localStreamUrl: null })
        }

        for (const producer of payload.activeProducers ?? []) {
          queuedProducerRef.current.set(producer.producerId, {
            callId,
            userId: producer.userId,
            producerId: producer.producerId,
            kind: producer.kind,
          })
        }
        await flushQueuedProducers()

        useCallStore.getState().patch({
          phase: 'active',
          callType,
          reconnectDeadlineMs: null,
          remoteStreamUrl: remoteStreamRef.current?.toURL() ?? null,
        })
        startDurationTimer(resumeDurationSec)

        if (callType === 'VIDEO' && veloraSystemCalls.setSpeakerEnabled(true)) {
          useCallStore.getState().patch({ speakerEnabled: true })
        }
      } finally {
        mediaSetupRef.current = false
      }
    },
    [createTransport, ensureDevice, ensureSocket, flushQueuedProducers, produceVideoTrack, startDurationTimer],
  )

  const prepareIncomingState = useCallback(
    (payload: IncomingCallPayload | CallStateResponse) => {
      if (!currentUserId) return false
      const peer = getPeerInfoFromConversation({
        conversationId: payload.conversationId,
        currentUserId,
        fallbackPeerUserId: payload.initiatorId,
        queryClient,
      })
      activeCallIdRef.current = payload.callId
      useCallStore.getState().patch({
        phase: 'incoming_ringing',
        direction: 'incoming',
        callId: payload.callId,
        conversationId: payload.conversationId,
        peerUserId: peer.peerUserId,
        peerName: payload.initiatorDisplayName || peer.peerName || 'Unknown',
        peerAvatarUrl: payload.initiatorAvatarUrl ?? peer.peerAvatarUrl,
        callType: payload.callType,
        muted: false,
        speakerEnabled: false,
        cameraEnabled: false,
        remoteAudioState: 'idle',
        remoteVideoState: payload.callType === 'VIDEO' ? 'waiting' : 'idle',
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
    async () => {
      const initial = useCallStore.getState()
      if (!initial.callId || initial.phase !== 'incoming_ringing') return
      const callId = initial.callId
      try {
        const socket = await ensureSocket()
        if (!(await ensureMicPermission())) {
          socket.emit('reject_call', { callId, reason: 'mic_permission_denied' })
          await teardown({ error: 'Velora needs microphone access to answer calls' })
          return
        }
        if (initial.callType === 'VIDEO' && !(await ensureCameraPermission())) {
          socket.emit('reject_call', { callId, reason: 'camera_permission_denied' })
          await teardown({ error: 'Velora needs camera access to answer video calls' })
          return
        }

        const joined = await emitAndWaitForEvent(socket, 'join_call', { callId }, {
          event: 'call_joined',
          timeoutMs: CALL_JOINED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload) => payload.callId === callId,
        })
        await emitAndWaitForEvent(socket, 'answer_call', { callId }, {
          event: 'call_answered',
          timeoutMs: CALL_JOINED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload) => payload.callId === callId,
        })

        useCallStore.getState().patch({ phase: 'connecting', callType: joined.session.callType })
        router.push(`/call/${callId}` as never)
        await waitForIosAudioSession()
        await setupMedia(joined)
        if (!veloraSystemCalls.setCallActive(callId)) throw new Error('native_call_inactive')
      } catch (error) {
        socketRef.current?.emit('leave_call', { callId, reason: 'remote_accept_failed' })
        await teardown({ error: 'Unable to set up the call' })
      }
    },
    [ensureCameraPermission, ensureMicPermission, ensureSocket, router, setupMedia, teardown, waitForIosAudioSession],
  )

  const rejectIncomingCall = useCallback(async () => {
    const state = useCallStore.getState()
    if (!state.callId) return
    try {
      const socket = await ensureSocket()
      socket.emit('reject_call', { callId: state.callId })
    } catch {
      // Native dismissal still proceeds when signaling is temporarily unavailable.
    }
    void veloraSystemCalls.dismissIncomingCall(state.callId)
    await teardown({ endNative: false })
  }, [ensureSocket, teardown])

  const startCall = useCallback(
    async (input: StartCallInput, callType: CallType) => {
      if (!currentUserId || isBusyPhase(useCallStore.getState().phase)) return
      let preview: MediaStream | null = null
      try {
        if (!(await ensureMicPermission())) {
          setError('Velora needs microphone access to place calls')
          return
        }
        if (callType === 'VIDEO') {
          if (!(await ensureCameraPermission())) {
            setError('Velora needs camera access to place video calls')
            return
          }
          preview = await mediaDevices.getUserMedia({
            audio: false,
            video: cameraConstraints(useCallStore.getState().cameraFacing),
          })
          ringingPreviewStreamRef.current = preview
        }

        const socket = await ensureSocket()
        const joined = await emitAndWaitForEvent(socket, 'initiate_call', {
          conversationId: input.conversationId,
          targetUserId: input.peerUserId,
          callType,
        }, {
          event: 'call_joined',
          timeoutMs: CALL_JOINED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload) => payload.session.conversationId === input.conversationId && payload.session.callType === callType,
        })

        activeCallIdRef.current = joined.callId
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
          speakerEnabled: false,
          cameraEnabled: callType === 'VIDEO',
          remoteAudioState: 'idle',
          remoteVideoState: callType === 'VIDEO' ? 'waiting' : 'idle',
          localStreamUrl: preview?.toURL() ?? null,
          remoteStreamUrl: null,
          reconnectDeadlineMs: null,
          error: null,
          durationSec: 0,
        })
        router.push(`/call/${joined.callId}` as never)

        const registry: CallWaitRegistry = new Set()
        const timeoutMs = (joined.noAnswerTimeoutMs ?? DEFAULT_NO_ANSWER_TIMEOUT_MS) + CALL_JOINED_TIMEOUT_MS
        let outcome: 'answered' | 'ended' | 'rejected'
        try {
          outcome = await Promise.race([
            waitForEventWhere(socket, 'call_answered', {
              timeoutMs,
              registry,
              filter: (payload: CallAnsweredPayload) => payload.callId === joined.callId,
            }).then(() => 'answered' as const),
            waitForEventWhere(socket, 'call_ended', {
              timeoutMs,
              registry,
              filter: (payload) => payload.callId === joined.callId,
            }).then(() => 'ended' as const),
            waitForEventWhere(socket, 'call_rejected', {
              timeoutMs,
              registry,
              filter: (payload) => payload.callId === joined.callId,
            }).then(() => 'rejected' as const),
          ])
        } finally {
          clearWaitRegistry(registry)
        }
        if (outcome !== 'answered') return

        useCallStore.getState().patch({ phase: 'connecting' })
        await waitForIosAudioSession()
        await setupMedia(joined)
        if (!veloraSystemCalls.setCallActive(joined.callId)) throw new Error('native_call_inactive')
      } catch (error) {
        const callId = activeCallIdRef.current
        if (callId && socketRef.current?.connected) socketRef.current.emit('leave_call', { callId, reason: 'timeout' })
        await teardown({ error: 'Unable to set up the call' })
      }
    },
    [currentUserId, ensureCameraPermission, ensureMicPermission, ensureSocket, router, setError, setupMedia, teardown, waitForIosAudioSession],
  )

  const startVoiceCall = useCallback((input: StartCallInput) => startCall(input, 'VOICE'), [startCall])
  const startVideoCall = useCallback((input: StartCallInput) => startCall(input, 'VIDEO'), [startCall])

  const endCall = useCallback(async (reason?: string) => {
    const state = useCallStore.getState()
    if (!state.callId) return
    useCallStore.getState().patch({ phase: 'ending' })
    if (socketRef.current?.connected) {
      socketRef.current.emit('leave_call', { callId: state.callId, ...(reason ? { reason } : {}) })
    }
    await teardown()
  }, [teardown])

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    const muted = !useCallStore.getState().muted
    track.enabled = !muted
    useCallStore.getState().patch({ muted })
  }, [])

  const toggleSpeaker = useCallback(() => {
    const state = useCallStore.getState()
    if (state.phase !== 'active') return
    const enabled = !state.speakerEnabled
    if (veloraSystemCalls.setSpeakerEnabled(enabled)) useCallStore.getState().patch({ speakerEnabled: enabled })
  }, [])

  const acquireAndAttachVideo = useCallback(async (facing: CameraFacing) => {
    if (!(await ensureCameraPermission())) throw new Error('camera_permission_denied')
    const temp = await mediaDevices.getUserMedia({ audio: false, video: cameraConstraints(facing) })
    const track = temp.getVideoTracks()[0]
    if (!track) {
      stopStream(temp)
      throw new Error('camera_track_unavailable')
    }
    const local = localStreamRef.current ?? new MediaStream()
    const previous = local.getVideoTracks()[0]
    if (previous) {
      local.removeTrack(previous)
      previous.stop()
    }
    local.addTrack(track)
    localStreamRef.current = local
    // Keep the track alive after the temporary stream object falls out of scope.
    return track as unknown as MediaStreamTrack
  }, [ensureCameraPermission])

  const toggleCamera = useCallback(async () => {
    const state = useCallStore.getState()
    if (state.callType !== 'VIDEO' || state.phase !== 'active') return
    let track = localStreamRef.current?.getVideoTracks()[0]
    if (!track) {
      try {
        track = (await acquireAndAttachVideo(state.cameraFacing)) as never
        await produceVideoTrack(track as unknown as MediaStreamTrack)
      } catch {
        setError('Unable to access the camera')
        return
      }
    }
    const enabled = !state.cameraEnabled
    track.enabled = enabled
    useCallStore.getState().patch({
      cameraEnabled: enabled,
      localStreamUrl: localStreamRef.current?.toURL() ?? null,
    })
  }, [acquireAndAttachVideo, produceVideoTrack, setError])

  const switchCamera = useCallback(async () => {
    const state = useCallStore.getState()
    if (state.callType !== 'VIDEO' || state.phase !== 'active') return
    const facing: CameraFacing = state.cameraFacing === 'user' ? 'environment' : 'user'
    try {
      const track = await acquireAndAttachVideo(facing)
      if (videoProducerRef.current) {
        await videoProducerRef.current.replaceTrack({ track: track as never })
      } else {
        await produceVideoTrack(track)
      }
      track.enabled = state.cameraEnabled
      useCallStore.getState().patch({
        cameraFacing: facing,
        localStreamUrl: localStreamRef.current?.toURL() ?? null,
      })
    } catch {
      setError('Unable to switch camera')
    }
  }, [acquireAndAttachVideo, produceVideoTrack, setError])

  const cleanupLocalVideo = useCallback(() => {
    try {
      videoProducerRef.current?.close()
    } catch {}
    videoProducerRef.current = null
    const stream = localStreamRef.current
    for (const track of stream?.getVideoTracks() ?? []) {
      stream?.removeTrack(track)
      track.stop()
    }
    useCallStore.getState().patch({ cameraEnabled: false, localStreamUrl: null })
  }, [])

  const switchCallType = useCallback(async (nextType: CallType) => {
    const state = useCallStore.getState()
    if (state.phase !== 'active' || !state.callId || state.callType === nextType) return
    const socket = await ensureSocket()

    if (nextType === 'VIDEO') {
      if (!(await ensureCameraPermission())) {
        setError('Velora needs camera access to turn on video')
        return
      }
      let track: MediaStreamTrack
      try {
        track = await acquireAndAttachVideo(state.cameraFacing)
      } catch {
        setError('Unable to access the camera')
        return
      }
      try {
        await emitAndWaitForEvent(socket, 'set_call_type', { callId: state.callId, callType: 'VIDEO' }, {
          event: 'call_type_changed',
          timeoutMs: CALL_JOINED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload) => payload.callId === state.callId && payload.callType === 'VIDEO',
        })
        useCallStore.getState().patch({ callType: 'VIDEO', cameraEnabled: true, remoteVideoState: 'waiting', localStreamUrl: localStreamRef.current?.toURL() ?? null })
        track.enabled = true
        await produceVideoTrack(track)
        if (veloraSystemCalls.setSpeakerEnabled(true)) useCallStore.getState().patch({ speakerEnabled: true })
      } catch {
        cleanupLocalVideo()
        socket.emit('set_call_type', { callId: state.callId, callType: 'VOICE' })
        setError('Unable to turn on video')
      }
      return
    }

    try {
      await emitAndWaitForEvent(socket, 'set_call_type', { callId: state.callId, callType: 'VOICE' }, {
        event: 'call_type_changed',
        timeoutMs: CALL_JOINED_TIMEOUT_MS,
        registry: waitRegistryRef.current,
        filter: (payload) => payload.callId === state.callId && payload.callType === 'VOICE',
      })
      cleanupLocalVideo()
      useCallStore.getState().patch({ callType: 'VOICE', remoteVideoState: 'idle' })
    } catch {
      setError('Unable to switch to voice call')
    }
  }, [acquireAndAttachVideo, cleanupLocalVideo, ensureCameraPermission, ensureSocket, produceVideoTrack, setError])

  const removeRemoteProducer = useCallback((payload: ProducerClosedPayload) => {
    if (payload.callId !== useCallStore.getState().callId) return
    const consumer = consumersByProducerRef.current.get(payload.producerId)
    if (consumer) {
      const track = consumer.track as unknown as MediaStreamTrack
      try {
        remoteStreamRef.current?.removeTrack(track)
      } catch {}
      try {
        consumer.close()
      } catch {}
      consumersByProducerRef.current.delete(payload.producerId)
    }
    if (payload.kind === 'video') {
      useCallStore.getState().patch({
        remoteVideoState: useCallStore.getState().callType === 'VIDEO' ? 'off' : 'idle',
        remoteStreamUrl: remoteStreamRef.current?.toURL() ?? null,
      })
    }
  }, [])

  const recoverCall = useCallback(async (reason = 'socket_reconnect') => {
    const state = useCallStore.getState()
    if (!state.callId || !['active', 'reconnecting'].includes(state.phase) || reconnectingRef.current) return
    reconnectingRef.current = true
    stopDurationTimer(false)
    useCallStore.getState().patch({ phase: 'reconnecting', reconnectDeadlineMs: Date.now() + RECONNECT_GRACE_MS })
    clearReconnectTimer()
    reconnectTimerRef.current = setTimeout(() => {
      void teardown({ error: 'Call connection was lost' })
    }, RECONNECT_GRACE_MS)

    try {
      const socket = await ensureSocket()
      const rejoined = await emitAndWaitForEvent(socket, 'rejoin_call', { callId: state.callId }, {
        event: 'call_rejoined',
        timeoutMs: CALL_JOINED_TIMEOUT_MS,
        registry: waitRegistryRef.current,
        filter: (payload) => payload.callId === state.callId,
      })
      disposeMedia(true)
      activeCallIdRef.current = state.callId
      useCallStore.getState().patch({
        callId: state.callId,
        phase: 'reconnecting',
        callType: rejoined.session.callType,
        durationSec: state.durationSec,
      })
      await setupMedia(rejoined, state.durationSec)
      reconnectingRef.current = false
      clearReconnectTimer()
      console.warn(`[Call] recovered (${reason})`)
    } catch {
      // Grace timer owns terminal recovery failure.
    }
  }, [clearReconnectTimer, disposeMedia, ensureSocket, setupMedia, stopDurationTimer, teardown])

  const processNativeAction = useCallback(async (action: NativeCallAction) => {
    if (nativeActionIdsRef.current.has(action.actionId)) return
    nativeActionIdsRef.current.add(action.actionId)
    try {
      if (action.action === 'remote_end') {
        if (action.callId === activeCallIdRef.current || action.callId === useCallStore.getState().callId) {
          await teardown({ endNative: false })
        } else {
          void veloraSystemCalls.dismissIncomingCall(action.callId)
        }
        return
      }

      let callState: CallStateResponse
      try {
        callState = await getCallState(action.callId)
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 404) {
          void veloraSystemCalls.dismissIncomingCall(action.callId)
        }
        return
      }
      if (isTerminalStatus(callState.status)) {
        void veloraSystemCalls.dismissIncomingCall(action.callId)
        return
      }

      if (action.action === 'answer') {
        if (!prepareIncomingState(callState)) return
        await acceptIncomingCall()
      } else if (action.action === 'reject') {
        if (prepareIncomingState(callState)) await rejectIncomingCall()
      } else if (action.action === 'end') {
        if (callState.status === 'active') {
          activeCallIdRef.current = callState.callId
          useCallStore.getState().patch({ callId: callState.callId, phase: 'active', callType: callState.callType })
          await endCall('ended')
        } else if (prepareIncomingState(callState)) {
          await rejectIncomingCall()
        }
      }
    } finally {
      veloraSystemCalls.clearPendingCallAction(action.actionId)
      if (nativeActionIdsRef.current.size > 64) nativeActionIdsRef.current.clear()
    }
  }, [acceptIncomingCall, endCall, prepareIncomingState, rejectIncomingCall, teardown])

  const replayPendingNativeAction = useCallback(() => {
    const action = veloraSystemCalls.getPendingCallAction()
    if (action) void processNativeAction(action)
  }, [processNativeAction])

  useEffect(() => {
    if (isLoading || !isAuthenticated || !currentUserId) return
    let cancelled = false
    let socket: CallSocket

    try {
      socket = socketRef.current ?? createCallSocket()
      socketRef.current = socket
    } catch {
      setError('Unable to set up the call')
      return
    }

    const onReady = (payload: CallSocketReadyPayload) => {
      socketReadyRef.current = true
      for (const terminal of payload.recentTerminalCalls ?? []) {
        if (terminal.callId === activeCallIdRef.current || terminal.callId === useCallStore.getState().callId) {
          void teardown({ error: callEndedMessage(terminal) })
        }
      }
      if (useCallStore.getState().phase === 'reconnecting') void recoverCall('socket_ready')
    }
    const onDisconnect = () => {
      socketReadyRef.current = false
      const state = useCallStore.getState()
      if (state.phase === 'active') {
        reconnectingRef.current = false
        void recoverCall('socket_disconnect')
      }
    }
    const onIncoming = (payload: IncomingCallPayload) => {
      const state = useCallStore.getState()
      if (state.callId === payload.callId) return
      if (isBusyPhase(state.phase)) {
        socket.emit('reject_call', { callId: payload.callId, reason: 'busy' })
        return
      }
      if (prepareIncomingState(payload)) void veloraSystemCalls.presentIncomingCall(toNativeIncomingCallPayload(payload))
    }
    const onEnded = (payload: CallEndedPayload) => {
      if (payload.callId !== activeCallIdRef.current && payload.callId !== useCallStore.getState().callId) {
        void veloraSystemCalls.dismissIncomingCall(payload.callId)
        return
      }
      void teardown({ error: callEndedMessage(payload) })
    }
    const onRejected = (payload: CallRejectedPayload) => {
      if (payload.callId === activeCallIdRef.current || payload.callId === useCallStore.getState().callId) {
        void teardown({ error: callRejectedMessage(payload) })
      }
    }
    const onPeerReconnecting = (payload: PeerReconnectingPayload) => {
      if (payload.callId !== useCallStore.getState().callId || payload.userId === currentUserId) return
      stopDurationTimer(false)
      reconnectingRef.current = true
      closeRemoteConsumers()
      useCallStore.getState().patch({
        phase: 'reconnecting',
        reconnectDeadlineMs: Date.parse(payload.reconnectDeadlineAt) || Date.now() + RECONNECT_GRACE_MS,
      })
      clearReconnectTimer()
      reconnectTimerRef.current = setTimeout(() => void teardown({ error: 'Call connection was lost' }), RECONNECT_GRACE_MS)
    }
    const onPeerReconnected = (payload: PeerReconnectedPayload) => {
      if (payload.callId !== useCallStore.getState().callId || payload.userId === currentUserId) return
      useCallStore.getState().patch({ remoteAudioState: 'waiting' })
    }
    const onPeerLeft = (payload: PeerLeftPayload) => {
      if (payload.callId === useCallStore.getState().callId) void teardown({ error: 'The call was interrupted' })
    }
    const onTypeChanged = (payload: { callId: string; callType: CallType; changedByUserId: string }) => {
      if (payload.callId !== useCallStore.getState().callId) return
      if (payload.callType === 'VOICE') {
        cleanupLocalVideo()
        useCallStore.getState().patch({ callType: 'VOICE', remoteVideoState: 'idle' })
      } else {
        useCallStore.getState().patch({ callType: 'VIDEO', remoteVideoState: 'waiting' })
      }
    }

    socket.on('call_socket_ready', onReady)
    socket.on('disconnect', onDisconnect)
    socket.on('incoming_call', onIncoming)
    socket.on('new_producer', (payload) => void consumeProducer(payload))
    socket.on('producer_closed', removeRemoteProducer)
    socket.on('call_type_changed', onTypeChanged)
    socket.on('call_ended', onEnded)
    socket.on('call_rejected', onRejected)
    socket.on('peer_reconnecting', onPeerReconnecting)
    socket.on('peer_reconnected', onPeerReconnected)
    socket.on('peer_left', onPeerLeft)

    void authenticateCallSocket(socket)
      .then(() => {
        if (!cancelled && !socket.connected) socket.connect()
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      socket.off('call_socket_ready', onReady)
      socket.off('disconnect', onDisconnect)
      socket.off('incoming_call', onIncoming)
      socket.off('new_producer')
      socket.off('producer_closed', removeRemoteProducer)
      socket.off('call_type_changed', onTypeChanged)
      socket.off('call_ended', onEnded)
      socket.off('call_rejected', onRejected)
      socket.off('peer_reconnecting', onPeerReconnecting)
      socket.off('peer_reconnected', onPeerReconnected)
      socket.off('peer_left', onPeerLeft)
    }
  }, [
    cleanupLocalVideo,
    clearReconnectTimer,
    closeRemoteConsumers,
    consumeProducer,
    currentUserId,
    isAuthenticated,
    isLoading,
    prepareIncomingState,
    recoverCall,
    removeRemoteProducer,
    setError,
    stopDurationTimer,
    teardown,
  ])

  useEffect(() => {
    const subscription = veloraSystemCalls.addCallActionListener((action) => {
      void processNativeAction(action)
    })
    return () => subscription.remove()
  }, [processNativeAction])

  useEffect(() => {
    if (!isLoading && isAuthenticated && currentUserId) replayPendingNativeAction()
  }, [currentUserId, isAuthenticated, isLoading, replayPendingNativeAction])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previous = lastAppStateRef.current
      lastAppStateRef.current = nextState
      const state = useCallStore.getState()
      const videoTrack = localStreamRef.current?.getVideoTracks()[0]

      if (nextState !== 'active' && state.phase === 'active' && state.callType === 'VIDEO' && state.cameraEnabled && videoTrack) {
        videoTrack.enabled = false
        cameraPausedByBackgroundRef.current = true
      }

      if (nextState === 'active') {
        replayPendingNativeAction()
        if (previous !== 'active' && cameraPausedByBackgroundRef.current && state.phase === 'active' && state.callType === 'VIDEO' && state.cameraEnabled && videoTrack) {
          videoTrack.enabled = true
        }
        cameraPausedByBackgroundRef.current = false
      }
    })
    return () => subscription.remove()
  }, [replayPendingNativeAction])

  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      socketRef.current?.removeAllListeners()
      socketRef.current?.disconnect()
      socketRef.current = null
      socketReadyRef.current = false
      void teardown({ endNative: true })
    }
  }, [isAuthenticated, isLoading, teardown])

  useEffect(() => () => {
    clearReconnectTimer()
    stopDurationTimer(false)
    disposeMedia(false)
    clearWaitRegistry(waitRegistryRef.current)
    socketRef.current?.removeAllListeners()
    socketRef.current?.disconnect()
  }, [clearReconnectTimer, disposeMedia, stopDurationTimer])

  const dismissCallError = useCallback(() => setError(null), [setError])

  const value = useMemo<UseCallValue>(() => ({
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
  }), [
    acceptIncomingCall,
    dismissCallError,
    endCall,
    rejectIncomingCall,
    startVideoCall,
    startVoiceCall,
    switchCallType,
    switchCamera,
    toggleCamera,
    toggleMute,
    toggleSpeaker,
  ])

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}
