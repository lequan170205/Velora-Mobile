import { useQueryClient } from '@tanstack/react-query'
import { Camera } from 'expo-camera'
import { useRouter } from 'expo-router'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { AppState, Platform } from 'react-native'
import { MediaStream, mediaDevices } from 'react-native-webrtc'

import { queryKeys } from '../constants/queryKeys'
import {
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
import { useAuthStore } from '../stores/authStore'
import { useCallStore } from '../stores/callStore'

import type {
  CallAnsweredPayload,
  CallEndedPayload,
  CallJoinedPayload,
  CallRejoinedPayload,
  CallRejectedPayload,
  CallSocket,
  IncomingCallPayload,
  NewProducerPayload,
  PeerReconnectedPayload,
  PeerReconnectingPayload,
  PeerLeftPayload,
  StartVoiceCallInput,
  TransportCreatedPayload,
  UseCallValue,
} from '../types/call.types'
import type { Conversation } from '../types/conversation.types'
import type { Device as MediasoupDevice } from 'mediasoup-client'
import type * as MediasoupTypes from 'mediasoup-client/types'
import type { AppStateStatus } from 'react-native'
import type { MediaStreamTrack } from 'react-native-webrtc'

const CALL_JOINED_TIMEOUT_MS = 10_000
const TRANSPORT_CREATED_TIMEOUT_MS = 10_000
const TRANSPORT_CONNECTED_TIMEOUT_MS = 10_000
const CONSUMER_CREATED_TIMEOUT_MS = 10_000
const CONSUMER_RESUMED_TIMEOUT_MS = 10_000
const DEFAULT_CALL_NO_ANSWER_TIMEOUT_MS = 30_000
const getOutgoingRingWaitTimeoutMs = (noAnswerTimeoutMs?: number) =>
  (noAnswerTimeoutMs && noAnswerTimeoutMs > 0
    ? noAnswerTimeoutMs
    : DEFAULT_CALL_NO_ANSWER_TIMEOUT_MS) + CALL_JOINED_TIMEOUT_MS
const REMOTE_PRODUCER_TIMEOUT_MS = 30_000
const REMOTE_AUDIO_WAIT_FALLBACK_MS = 10_000
const PEER_LEFT_GRACE_MS = 750
const DEFAULT_RECONNECT_GRACE_MS = 15_000
const RECONNECT_RECOVERY_TIMEOUT_MS = (() => {
  const configured = Number(process.env.EXPO_PUBLIC_CALL_RECONNECT_GRACE_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RECONNECT_GRACE_MS
})()

const CallContext = createContext<UseCallValue>({
  startVoiceCall: async () => {},
  acceptIncomingCall: async () => {},
  rejectIncomingCall: async () => {},
  endCall: async () => {},
  toggleMute: () => {},
  dismissCallError: () => {},
})

const isBusyPhase = (phase: ReturnType<typeof useCallStore.getState>['phase']) => phase !== 'idle'

const getConversationsFromCache = (value: unknown) => {
  if (Array.isArray(value)) {
    return value as Conversation[]
  }

  return ((value as { pages?: Conversation[][] } | undefined)?.pages?.flat() ??
    []) as Conversation[]
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
  const peer =
    conversation?.participants?.find((participant) => participant.id !== currentUserId) ?? null

  return {
    conversation,
    peerUserId: peer?.id ?? fallbackPeerUserId ?? null,
    peerName: peer?.name ?? peer?.email ?? null,
    peerAvatarUrl: peer?.picture ?? null,
  }
}

const getCallEndedMessage = (
  payload: CallEndedPayload,
  state: Pick<ReturnType<typeof useCallStore.getState>, 'direction' | 'phase'>,
) => {
  if (payload.reason === 'no_answer') {
    return state.direction === 'outgoing' ? 'No one answered' : null
  }

  if (payload.reason === 'cancelled') {
    return 'The caller canceled the call'
  }

  if (payload.reason === 'disconnected') {
    return 'The call was interrupted'
  }

  return null
}

const getCallRejectedMessage = (payload: CallRejectedPayload) => {
  if (payload.reason === 'busy') {
    return 'The other person is on another call'
  }

  if (payload.reason === 'mic_permission_denied') {
    return 'The other person needs microphone access to answer'
  }

  if (payload.reason === 'unsupported_video') {
    return 'Video calls are not supported yet'
  }

  return 'The call was rejected'
}

const isWaitTimeoutError = (error: unknown) =>
  error instanceof Error && error.message.startsWith('Timed out')

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
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const audioProducerRef = useRef<MediasoupTypes.Producer<Record<string, unknown>> | null>(null)
  const consumerMapRef = useRef<Map<string, MediasoupTypes.Consumer<Record<string, unknown>>>>(
    new Map(),
  )
  const connectedTransportIdsRef = useRef<Set<string>>(new Set())
  const queuedRemoteProducerMapRef = useRef<Map<string, NewProducerPayload>>(new Map())
  const handledRemoteProducerIdsRef = useRef<Set<string>>(new Set())
  const consumingProducerIdsRef = useRef<Set<string>>(new Set())
  const retryingProducerIdsRef = useRef<Set<string>>(new Set())
  const activeCallIdRef = useRef<string | null>(null)
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
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)

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
    if (remoteAudioFallbackTimeoutRef.current) {
      clearTimeout(remoteAudioFallbackTimeoutRef.current)
      remoteAudioFallbackTimeoutRef.current = null
    }
  }, [])

  const clearPeerLeftFallback = useCallback(() => {
    if (peerLeftTimeoutRef.current) {
      clearTimeout(peerLeftTimeoutRef.current)
      peerLeftTimeoutRef.current = null
    }
  }, [])

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
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
      clearRemoteAudioFallback()
      clearPeerLeftFallback()
      clearReconnectTimeout()
      clearWaitRegistry(waitRegistryRef.current)
      connectedTransportIdsRef.current.clear()
      queuedRemoteProducerMapRef.current.clear()
      handledRemoteProducerIdsRef.current.clear()
      consumingProducerIdsRef.current.clear()
      retryingProducerIdsRef.current.clear()
      consumerMapRef.current.clear()
      deviceRef.current = null
      sendTransportRef.current = null
      recvTransportRef.current = null
      localStreamRef.current = null
      remoteStreamRef.current = null
      audioProducerRef.current = null
      routerRtpCapabilitiesRef.current = null
      reconnectRecoveryInFlightRef.current = false
      reconnectModeRef.current = null

      if (!options?.preserveActiveCall) {
        activeCallIdRef.current = null
        callAnsweredRef.current = false
      }
    },
    [clearPeerLeftFallback, clearReconnectTimeout, clearRemoteAudioFallback],
  )

  const disposeMediaRuntime = useCallback(
    (options?: { preserveActiveCall?: boolean }) => {
      const currentConsumers = [...consumerMapRef.current.values()]
      const currentProducer = audioProducerRef.current
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

      if (currentProducer) {
        try {
          currentProducer.close()
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
  }, [])

  const teardownOnce = useCallback(
    async (reason: string, options?: { errorMessage?: string | null }) => {
      if (teardownInProgressRef.current) {
        return
      }

      teardownInProgressRef.current = true
      stopTimer()
      disposeMediaRuntime()
      useCallStore.getState().reset()

      if (options?.errorMessage) {
        useCallStore.getState().patch({ error: options.errorMessage })
      }

      teardownInProgressRef.current = false
      console.warn(`[Call] Teardown completed (${reason})`)
    },
    [disposeMediaRuntime, stopTimer],
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

  const ensureMicPermission = useCallback(async () => {
    if (typeof Camera.requestMicrophonePermissionsAsync !== 'function') {
      throw new Error('Microphone permission API is unavailable in this build')
    }

    const permission = await Camera.requestMicrophonePermissionsAsync()
    const granted = permission.granted === true
    useCallStore.getState().patch({ hasMicPermission: granted })
    return granted
  }, [])

  const ensureSocketConnected = useCallback(async () => {
    let socket = socketRef.current

    if (!socket) {
      socket = createCallSocket()
      socketRef.current = socket
    }

    if (socket.connected) {
      return socket
    }

    socket.connect()

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        socket?.off('connect', handleConnect)
        socket?.off('connect_error', handleConnectError)
        reject(new Error('Timed out connecting call socket'))
      }, CALL_JOINED_TIMEOUT_MS)

      const handleConnect = () => {
        clearTimeout(timeoutId)
        socket?.off('connect_error', handleConnectError)
        resolve()
      }

      const handleConnectError = (error: Error) => {
        clearTimeout(timeoutId)
        socket?.off('connect', handleConnect)
        reject(error)
      }

      socket?.once('connect', handleConnect)
      socket?.once('connect_error', handleConnectError)
    })

    return socket
  }, [])

  const ensureDeviceLoaded = useCallback(async (payload: CallJoinedPayload) => {
    let device = deviceRef.current

    if (!device) {
      ensureMediasoupGlobalsRegistered()
      device = createMediasoupDevice()
      deviceRef.current = device
    }

    if (!device.loaded) {
      await device.load({
        routerRtpCapabilities: toRouterRtpCapabilities(payload.rtpCapabilities),
      })
    }

    routerRtpCapabilitiesRef.current = payload.rtpCapabilities
    return device
  }, [])

  const createTransport = useCallback(
    async (
      socket: CallSocket,
      callId: string,
      direction: 'send' | 'recv',
      device: MediasoupDevice,
    ) => {
      const transportCreated = await emitAndWaitForEvent<'create_transport', 'transport_created'>(
        socket,
        'create_transport',
        { callId, direction },
        {
          event: 'transport_created',
          timeoutMs: TRANSPORT_CREATED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload: TransportCreatedPayload) =>
            payload.callId === callId && payload.direction === direction,
        },
      )

      const transportOptions = toTransportOptions(transportCreated)
      const transport =
        direction === 'send'
          ? device.createSendTransport<Record<string, unknown>>(transportOptions)
          : device.createRecvTransport<Record<string, unknown>>(transportOptions)

      transport.on('connectionstatechange', (state) => {
        console.warn(
          `[Call] ${direction} transport connection state changed`,
          JSON.stringify({ callId, transportId: transport.id, state }),
        )
      })

      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        void (async () => {
          try {
            console.warn(
              `[Call] Connecting ${direction} transport`,
              JSON.stringify({ callId, transportId: transport.id }),
            )
            await emitAndWaitForEvent<'connect_transport', 'transport_connected'>(
              socket,
              'connect_transport',
              {
                callId,
                transportId: transport.id,
                dtlsParameters: dtlsParameters as unknown as Record<string, unknown>,
              },
              {
                event: 'transport_connected',
                timeoutMs: TRANSPORT_CONNECTED_TIMEOUT_MS,
                registry: waitRegistryRef.current,
                filter: (payload) =>
                  payload.callId === callId && payload.transportId === transport.id,
              },
            )

            connectedTransportIdsRef.current.add(transport.id)
            console.warn(
              `[Call] ${direction} transport connected`,
              JSON.stringify({ callId, transportId: transport.id }),
            )
            callback()
          } catch (error) {
            console.warn(
              `[Call] Failed to connect ${direction} transport`,
              JSON.stringify({
                callId,
                transportId: transport.id,
                error: error instanceof Error ? error.message : 'unknown_error',
              }),
            )
            errback(error instanceof Error ? error : new Error('Failed to connect transport'))
          }
        })()
      })

      if (direction === 'send') {
        transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
          void (async () => {
            try {
              console.warn(
                '[Call] Producing local media',
                JSON.stringify({ callId, transportId: transport.id, kind }),
              )
              const produced = await emitAndWaitForEvent<'produce', 'new_producer'>(
                socket,
                'produce',
                {
                  callId,
                  transportId: transport.id,
                  kind: kind as 'audio',
                  rtpParameters: rtpParameters as unknown as Record<string, unknown>,
                },
                {
                  event: 'new_producer',
                  timeoutMs: REMOTE_PRODUCER_TIMEOUT_MS,
                  registry: waitRegistryRef.current,
                  filter: (payload) =>
                    payload.callId === callId &&
                    payload.userId === currentUserId &&
                    payload.kind === 'audio',
                },
              )

              console.warn(
                '[Call] Local producer announced',
                JSON.stringify({
                  callId,
                  transportId: transport.id,
                  producerId: produced.producerId,
                  kind: produced.kind,
                }),
              )
              callback({ id: produced.producerId })
            } catch (error) {
              console.warn(
                '[Call] Failed to produce local media',
                JSON.stringify({
                  callId,
                  transportId: transport.id,
                  error: error instanceof Error ? error.message : 'unknown_error',
                }),
              )
              errback(error instanceof Error ? error : new Error('Failed to produce audio'))
            }
          })()
        })
      }

      return transport
    },
    [currentUserId],
  )

  const consumeRemoteProducer = useCallback(
    async (payload: NewProducerPayload) => {
      const socket = socketRef.current
      const callId = activeCallIdRef.current
      const device = deviceRef.current
      const recvTransport = recvTransportRef.current

      if (!socket || !callId || !device?.loaded || !recvTransport) {
        console.warn(
          '[Call] Queueing remote producer until runtime is ready',
          JSON.stringify({
            payloadCallId: payload.callId,
            activeCallId: callId,
            producerId: payload.producerId,
            hasSocket: Boolean(socket),
            deviceLoaded: Boolean(device?.loaded),
            hasRecvTransport: Boolean(recvTransport),
          }),
        )
        queuedRemoteProducerMapRef.current.set(payload.producerId, payload)
        return
      }

      if (!connectedTransportIdsRef.current.has(recvTransport.id)) {
        console.warn(
          '[Call] Queueing remote producer until recv transport connects',
          JSON.stringify({
            callId,
            recvTransportId: recvTransport.id,
            producerId: payload.producerId,
          }),
        )
        queuedRemoteProducerMapRef.current.set(payload.producerId, payload)
        return
      }

      if (
        payload.callId !== callId ||
        payload.userId === currentUserId ||
        payload.kind !== 'audio' ||
        handledRemoteProducerIdsRef.current.has(payload.producerId) ||
        consumingProducerIdsRef.current.has(payload.producerId)
      ) {
        console.warn(
          '[Call] Ignoring new_producer event',
          JSON.stringify({
            payloadCallId: payload.callId,
            activeCallId: callId,
            payloadUserId: payload.userId,
            currentUserId,
            producerId: payload.producerId,
            kind: payload.kind,
            alreadyHandled: handledRemoteProducerIdsRef.current.has(payload.producerId),
            alreadyConsuming: consumingProducerIdsRef.current.has(payload.producerId),
          }),
        )
        return
      }

      const rtpCapabilities = device.rtpCapabilities
      consumingProducerIdsRef.current.add(payload.producerId)

      try {
        console.warn(
          '[Call] Consuming remote producer',
          JSON.stringify({
            callId,
            recvTransportId: recvTransport.id,
            producerId: payload.producerId,
            peerUserId: payload.userId,
          }),
        )
        const consumerCreated = await emitAndWaitForEvent<'consume', 'consumer_created'>(
          socket,
          'consume',
          {
            callId,
            transportId: recvTransport.id,
            producerId: payload.producerId,
            rtpCapabilities: rtpCapabilities as unknown as Record<string, unknown>,
          },
          {
            event: 'consumer_created',
            timeoutMs: CONSUMER_CREATED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (eventPayload) =>
              eventPayload.callId === callId && eventPayload.producerId === payload.producerId,
          },
        )

        console.warn(
          '[Call] Remote consumer created',
          JSON.stringify({
            callId,
            recvTransportId: recvTransport.id,
            consumerId: consumerCreated.consumerId,
            producerId: consumerCreated.producerId,
            kind: consumerCreated.kind,
          }),
        )
        const consumer = await recvTransport.consume({
          id: consumerCreated.consumerId,
          producerId: consumerCreated.producerId,
          kind: consumerCreated.kind,
          rtpParameters: consumerCreated.rtpParameters as never,
        })

        consumerMapRef.current.set(consumer.id, consumer)
        console.warn(
          '[Call] Remote consumer attached locally',
          JSON.stringify({
            callId,
            consumerId: consumer.id,
            producerId: payload.producerId,
            trackId: consumer.track.id,
            muted: consumer.track.muted,
            enabled: consumer.track.enabled,
            readyState: consumer.track.readyState,
          }),
        )

        consumer.track.addEventListener('mute', () => {
          console.warn(
            '[Call] Remote audio track muted',
            JSON.stringify({ callId, consumerId: consumer.id, trackId: consumer.track.id }),
          )
        })

        consumer.track.addEventListener('unmute', () => {
          console.warn(
            '[Call] Remote audio track unmuted',
            JSON.stringify({ callId, consumerId: consumer.id, trackId: consumer.track.id }),
          )
        })

        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream()
        }

        remoteStreamRef.current.addTrack(consumer.track as unknown as MediaStreamTrack)

        await emitAndWaitForEvent<'resume_consumer', 'consumer_resumed'>(
          socket,
          'resume_consumer',
          {
            callId,
            consumerId: consumer.id,
          },
          {
            event: 'consumer_resumed',
            timeoutMs: CONSUMER_RESUMED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (eventPayload) =>
              eventPayload.callId === callId && eventPayload.consumerId === consumer.id,
          },
        )

        console.warn(
          '[Call] Remote consumer resumed',
          JSON.stringify({
            callId,
            consumerId: consumer.id,
            producerId: payload.producerId,
          }),
        )
        const wasWaitingForPeerAudio = reconnectModeRef.current === 'peer'
        handledRemoteProducerIdsRef.current.add(payload.producerId)
        queuedRemoteProducerMapRef.current.delete(payload.producerId)
        reconnectModeRef.current = null
        clearReconnectTimeout()
        clearRemoteAudioFallback()
        useCallStore.getState().patch({
          ...(wasWaitingForPeerAudio ? { phase: 'active', reconnectDeadlineMs: null } : {}),
          remoteAudioState: 'connected',
        })

        if (wasWaitingForPeerAudio) {
          startTimer(useCallStore.getState().durationSec)
        }
      } catch (error) {
        const state = useCallStore.getState()
        console.warn(
          '[Call] Failed to consume remote producer',
          JSON.stringify({
            callId,
            recvTransportId: recvTransport.id,
            producerId: payload.producerId,
            phase: state.phase,
            reconnectMode: reconnectModeRef.current,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )

        if (reconnectModeRef.current) {
          queuedRemoteProducerMapRef.current.set(payload.producerId, payload)
          useCallStore.getState().patch({ remoteAudioState: 'waiting' })

          if (!retryingProducerIdsRef.current.has(payload.producerId)) {
            retryingProducerIdsRef.current.add(payload.producerId)
            setTimeout(() => {
              retryingProducerIdsRef.current.delete(payload.producerId)
              const queuedPayload = queuedRemoteProducerMapRef.current.get(payload.producerId)

              if (
                queuedPayload &&
                reconnectModeRef.current &&
                !handledRemoteProducerIdsRef.current.has(payload.producerId)
              ) {
                void consumeRemoteProducer(queuedPayload)
              }
            }, 750)
          }
          return
        }

        await teardownOnce('consume_remote_producer', {
          errorMessage: 'Unable to set up the call',
        })
      } finally {
        consumingProducerIdsRef.current.delete(payload.producerId)
      }
    },
    [clearReconnectTimeout, clearRemoteAudioFallback, currentUserId, startTimer, teardownOnce],
  )

  const flushQueuedRemoteProducers = useCallback(async () => {
    const queuedProducers = [...queuedRemoteProducerMapRef.current.values()]

    for (const payload of queuedProducers) {
      await consumeRemoteProducer(payload)
    }
  }, [consumeRemoteProducer])

  const primeRecvTransportConnection = useCallback(
    async (transport: MediasoupTypes.Transport<Record<string, unknown>>) => {
      if (connectedTransportIdsRef.current.has(transport.id)) {
        return
      }

      const handler = transport.handler as {
        _forcedLocalDtlsRole?: 'client' | 'server'
        _pc?: {
          addTransceiver: (kind: 'audio', init: { direction: 'recvonly' }) => unknown
          createOffer: () => Promise<{ sdp?: string | null }>
        }
        _transportReady?: boolean
        setupTransport?: (options: {
          localDtlsRole: 'client' | 'server'
          localSdpObject: unknown
        }) => Promise<void>
      }

      if (handler._transportReady || connectedTransportIdsRef.current.has(transport.id)) {
        return
      }

      if (!handler._pc || typeof handler.setupTransport !== 'function') {
        throw new Error('Receive transport handler is unavailable')
      }

      handler._pc.addTransceiver('audio', { direction: 'recvonly' })

      const offer = await handler._pc.createOffer()
      if (!offer.sdp) {
        throw new Error('Receive transport offer is unavailable')
      }

      const sdpTransform = (await import('sdp-transform')) as {
        parse: (sdp: string) => unknown
      }

      await handler.setupTransport({
        localDtlsRole: handler._forcedLocalDtlsRole ?? 'client',
        localSdpObject: sdpTransform.parse(offer.sdp),
      })
    },
    [],
  )

  const postAnswerSetup = useCallback(
    async (
      payload: CallJoinedPayload | CallRejoinedPayload,
      options?: { resumeDurationSec?: number },
    ) => {
      const socket = socketRef.current
      if (!socket) {
        throw new Error('Call socket is not connected')
      }

      const callId = payload.callId
      const device = await ensureDeviceLoaded(payload)
      const recvTransport = await createTransport(socket, callId, 'recv', device)
      recvTransportRef.current = recvTransport
      await primeRecvTransportConnection(recvTransport)

      const sendTransport = await createTransport(socket, callId, 'send', device)
      sendTransportRef.current = sendTransport

      const localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })
      const localAudioTrack = localStream.getAudioTracks()[0]

      if (!localAudioTrack) {
        throw new Error('No local audio track available')
      }

      const muted = useCallStore.getState().muted
      localAudioTrack.enabled = !muted
      localStreamRef.current = localStream

      if (!device.canProduce('audio')) {
        throw new Error('Device cannot produce audio')
      }

      audioProducerRef.current = await sendTransport.produce({
        track: localAudioTrack as never,
        stopTracks: false,
      })

      callAnsweredRef.current = true
      useCallStore.getState().patch({
        phase: 'active',
        muted,
        remoteAudioState: 'waiting',
        reconnectDeadlineMs: null,
      })
      startTimer(options?.resumeDurationSec ?? 0)
      armRemoteAudioFallback()

      await flushQueuedRemoteProducers()
    },
    [
      armRemoteAudioFallback,
      createTransport,
      ensureDeviceLoaded,
      flushQueuedRemoteProducers,
      primeRecvTransportConnection,
      startTimer,
    ],
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
      await postAnswerSetup(rejoined, {
        resumeDurationSec: useCallStore.getState().durationSec,
      })

      if (useCallStore.getState().remoteAudioState !== 'connected') {
        useCallStore.getState().patch({
          reconnectDeadlineMs: Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS,
        })
        armReconnectTimeout('recover_audio_timeout')
      }
    } catch (error) {
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
  }, [armReconnectTimeout, postAnswerSetup, teardownRecoveryFailure])

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

    stopTimer({ resetDuration: false })
    disposeMediaRuntime({ preserveActiveCall: true })
    reconnectModeRef.current = 'local'

    const reconnectDeadlineMs = Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS
    useCallStore.getState().patch({
      phase: 'reconnecting',
      remoteAudioState: 'idle',
      reconnectDeadlineMs,
    })

    armReconnectTimeout('reconnect_timeout')
  }, [armReconnectTimeout, currentUserId, disposeMediaRuntime, isAuthenticated, stopTimer])

  const handlePeerReconnecting = useCallback(
    (payload: PeerReconnectingPayload) => {
      if (payload.callId !== activeCallIdRef.current || payload.userId === currentUserId) {
        return
      }

      const state = useCallStore.getState()
      if (state.phase !== 'active') {
        return
      }

      reconnectModeRef.current = 'peer'
      stopTimer({ resetDuration: false })
      clearRemoteAudioFallback()
      resetRemoteConsumerRuntime()
      useCallStore.getState().patch({
        phase: 'reconnecting',
        remoteAudioState: 'waiting',
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
      resetRemoteConsumerRuntime,
      stopTimer,
    ],
  )

  const handlePeerReconnected = useCallback(
    (payload: PeerReconnectedPayload) => {
      if (payload.callId !== activeCallIdRef.current || payload.userId === currentUserId) {
        return
      }

      if (reconnectModeRef.current !== 'peer') {
        return
      }

      const state = useCallStore.getState()
      if (state.phase !== 'reconnecting') {
        return
      }

      useCallStore.getState().patch({
        remoteAudioState: 'waiting',
        reconnectDeadlineMs: Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS,
      })
      armReconnectTimeout('peer_audio_reconnect_timeout')
    },
    [armReconnectTimeout, currentUserId],
  )

  const rejectIncomingCall = useCallback(async () => {
    const socket = socketRef.current
    const state = useCallStore.getState()

    if (socket?.connected && state.callId) {
      socket.emit('reject_call', {
        callId: state.callId,
      })
    }

    await teardownOnce('reject_incoming_call')
  }, [teardownOnce])

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

      if (payload.callType === 'VIDEO') {
        socketRef.current?.emit('reject_call', {
          callId: payload.callId,
          reason: 'unsupported_video',
        })
        presentError('Video calls are not supported yet')
        return
      }

      if (isBusyPhase(useCallStore.getState().phase)) {
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

      activeCallIdRef.current = payload.callId
      callAnsweredRef.current = false
      routerRtpCapabilitiesRef.current = null
      useCallStore.getState().patch({
        phase: 'incoming_ringing',
        direction: 'incoming',
        callId: payload.callId,
        conversationId: payload.conversationId,
        peerUserId: peerInfo.peerUserId,
        peerName: peerInfo.peerName ?? 'Unknown',
        peerAvatarUrl: peerInfo.peerAvatarUrl,
        callType: payload.callType,
        muted: false,
        remoteAudioState: 'idle',
        reconnectDeadlineMs: null,
        error: null,
        durationSec: 0,
      })
    },
    [currentUserId, presentError, queryClient],
  )

  const acceptIncomingCall = useCallback(async () => {
    const state = useCallStore.getState()
    const socket = socketRef.current

    if (!state.callId || !socket) {
      return
    }

    const hasPermission = await ensureMicPermission()
    if (!hasPermission) {
      socket.emit('reject_call', {
        callId: state.callId,
        reason: 'mic_permission_denied',
      })
      await teardownOnce('accept_incoming_call_permission_denied', {
        errorMessage: 'Velora needs microphone access to place calls',
      })
      return
    }

    try {
      const joined = await emitAndWaitForEvent<'join_call', 'call_joined'>(
        socket,
        'join_call',
        { callId: state.callId },
        {
          event: 'call_joined',
          timeoutMs: CALL_JOINED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload) => payload.callId === state.callId,
        },
      )

      callAnsweredRef.current = true
      socket.emit('answer_call', { callId: state.callId })
      useCallStore.getState().patch({
        phase: 'connecting',
        remoteAudioState: 'idle',
        reconnectDeadlineMs: null,
      })
      router.push(`/call/${state.callId}` as never)
      await postAnswerSetup(joined)
    } catch (error) {
      await teardownOnce('accept_incoming_call_failed', {
        errorMessage: 'Unable to set up the call',
      })
    }
  }, [ensureMicPermission, postAnswerSetup, router, teardownOnce])

  const startVoiceCall = useCallback(
    async (input: StartVoiceCallInput) => {
      if (!currentUserId || isBusyPhase(useCallStore.getState().phase)) {
        return
      }

      const hasPermission = await ensureMicPermission()
      if (!hasPermission) {
        presentError('Velora needs microphone access to place calls')
        useCallStore.getState().patch({ phase: 'idle' })
        return
      }

      try {
        const socket = await ensureSocketConnected()
        const joined = await emitAndWaitForEvent<'initiate_call', 'call_joined'>(
          socket,
          'initiate_call',
          {
            conversationId: input.conversationId,
            targetUserId: input.peerUserId,
            callType: 'VOICE',
          },
          {
            event: 'call_joined',
            timeoutMs: CALL_JOINED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload) => payload.session.conversationId === input.conversationId,
          },
        )

        activeCallIdRef.current = joined.callId
        callAnsweredRef.current = false
        useCallStore.getState().patch({
          phase: 'outgoing_ringing',
          direction: 'outgoing',
          callId: joined.callId,
          conversationId: input.conversationId,
          peerUserId: input.peerUserId,
          peerName: input.peerName ?? 'Unknown',
          peerAvatarUrl: input.peerAvatarUrl ?? null,
          callType: 'VOICE',
          muted: false,
          remoteAudioState: 'idle',
          reconnectDeadlineMs: null,
          error: null,
          durationSec: 0,
        })
        router.push(`/call/${joined.callId}` as never)

        const answerWaitRegistry: CallWaitRegistry = new Set()
        let answerOutcome: 'answered' | 'ended' | 'rejected'
        const answerWaitTimeoutMs = getOutgoingRingWaitTimeoutMs(joined.noAnswerTimeoutMs)

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

        if (answerOutcome !== 'answered') {
          return
        }

        callAnsweredRef.current = true
        useCallStore.getState().patch({ phase: 'connecting', reconnectDeadlineMs: null })
        await postAnswerSetup(joined)
      } catch (error) {
        const activeCallId = activeCallIdRef.current
        if (socketRef.current?.connected && activeCallId) {
          socketRef.current.emit('leave_call', {
            callId: activeCallId,
            reason: 'timeout',
          })
        }
        await teardownOnce('start_voice_call_failed', {
          errorMessage: 'Unable to set up the call',
        })
      }
    },
    [
      currentUserId,
      ensureMicPermission,
      ensureSocketConnected,
      postAnswerSetup,
      presentError,
      router,
      teardownOnce,
    ],
  )

  const toggleMute = useCallback(() => {
    const localAudioTrack = localStreamRef.current?.getAudioTracks()[0]
    if (!localAudioTrack) {
      return
    }

    const nextMuted = !useCallStore.getState().muted
    localAudioTrack.enabled = !nextMuted
    useCallStore.getState().patch({ muted: nextMuted })
  }, [])

  const dismissCallError = useCallback(() => {
    useCallStore.getState().patch({ error: null })
  }, [])

  useEffect(() => {
    if ((callPhase !== 'active' && callPhase !== 'reconnecting') || !callId) {
      return
    }

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const previousAppState = appStateRef.current
      appStateRef.current = nextAppState

      if (Platform.OS !== 'web' && previousAppState === 'active' && nextAppState !== 'active') {
        void leaveCallFromLifecycle('app_backgrounded')
      }
    }

    const handlePageExit = () => {
      void leaveCallFromLifecycle('app_closed')
    }

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange)

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('pagehide', handlePageExit)
      window.addEventListener('beforeunload', handlePageExit)
    }

    return () => {
      appStateSubscription.remove()
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('pagehide', handlePageExit)
        window.removeEventListener('beforeunload', handlePageExit)
      }
    }
  }, [callId, callPhase, leaveCallFromLifecycle])

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!isAuthenticated || !currentUserId) {
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

    const handleConnect = () => {
      if (
        useCallStore.getState().phase === 'reconnecting' &&
        reconnectModeRef.current === 'local'
      ) {
        void recoverActiveCall()
      }
    }

    const handleDisconnect = () => {
      const { phase } = useCallStore.getState()

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

      if (!isBusyPhase(phase)) {
        return
      }

      void teardownOnce('socket_disconnect', {
        errorMessage: 'The call was interrupted',
      })
    }

    const handleCallRejected = (payload: CallRejectedPayload) => {
      if (payload.callId !== activeCallIdRef.current) {
        return
      }

      void teardownOnce('call_rejected', {
        errorMessage: getCallRejectedMessage(payload),
      })
    }

    const handleCallEnded = (payload: CallEndedPayload) => {
      if (payload.callId !== activeCallIdRef.current) {
        return
      }

      clearPeerLeftFallback()
      const state = useCallStore.getState()
      void teardownOnce('call_ended', {
        errorMessage: getCallEndedMessage(payload, state),
      })
    }

    const handlePeerLeft = (payload: PeerLeftPayload) => {
      if (payload.callId !== activeCallIdRef.current) {
        return
      }

      clearPeerLeftFallback()
      peerLeftTimeoutRef.current = setTimeout(() => {
        void teardownOnce('peer_left', {
          errorMessage: 'The call was interrupted',
        })
      }, PEER_LEFT_GRACE_MS)
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('incoming_call', (payload) => {
      void handleIncomingCall(payload)
    })
    socket.on('new_producer', (payload) => {
      void consumeRemoteProducer(payload)
    })
    socket.on('call_answered', (payload) => {
      if (payload.callId === activeCallIdRef.current) {
        callAnsweredRef.current = true
      }
    })
    socket.on('call_rejected', handleCallRejected)
    socket.on('peer_reconnecting', handlePeerReconnecting)
    socket.on('peer_reconnected', handlePeerReconnected)
    socket.on('peer_left', handlePeerLeft)
    socket.on('call_ended', handleCallEnded)

    if (socket.connected) {
      handleConnect()
    } else {
      socket.connect()
    }

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('call_rejected', handleCallRejected)
      socket.off('peer_reconnecting', handlePeerReconnecting)
      socket.off('peer_reconnected', handlePeerReconnected)
      socket.off('peer_left', handlePeerLeft)
      socket.off('call_ended', handleCallEnded)
      socket.off('incoming_call')
      socket.off('new_producer')
      socket.off('call_answered')
    }
  }, [
    consumeRemoteProducer,
    currentUserId,
    beginReconnectRecovery,
    handlePeerReconnected,
    handlePeerReconnecting,
    handleIncomingCall,
    isAuthenticated,
    isLoading,
    presentError,
    recoverActiveCall,
    teardownOnce,
    clearPeerLeftFallback,
  ])

  useEffect(() => {
    const waitRegistry = waitRegistryRef.current

    return () => {
      socketRef.current?.removeAllListeners()
      socketRef.current?.disconnect()
      socketRef.current = null
      stopTimer()
      clearRemoteAudioFallback()
      clearPeerLeftFallback()
      clearWaitRegistry(waitRegistry)
    }
  }, [clearPeerLeftFallback, clearRemoteAudioFallback, stopTimer])

  const value = useMemo<UseCallValue>(
    () => ({
      startVoiceCall,
      acceptIncomingCall,
      rejectIncomingCall,
      endCall,
      toggleMute,
      dismissCallError,
    }),
    [acceptIncomingCall, dismissCallError, endCall, rejectIncomingCall, startVoiceCall, toggleMute],
  )

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}
