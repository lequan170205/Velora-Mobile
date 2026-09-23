import { useCallback } from 'react'
import { AppState } from 'react-native'
import { MediaStream, mediaDevices } from 'react-native-webrtc'

import { useCallStore } from '../../stores/callStore'

import {
  CALL_SETUP_CANCELLED_ERROR,
  CONSUMER_CREATED_TIMEOUT_MS,
  CONSUMER_RESUMED_TIMEOUT_MS,
  REMOTE_CONSUMER_MAX_RETRY_ATTEMPTS,
  REMOTE_CONSUMER_RETRY_DELAY_MAX_MS,
  REMOTE_CONSUMER_RETRY_DELAY_MS,
  REMOTE_PRODUCER_TIMEOUT_MS,
  TRANSPORT_CONNECTED_TIMEOUT_MS,
  TRANSPORT_CREATED_TIMEOUT_MS,
  VOICE_OPUS_CODEC_OPTIONS,
} from './callConstants'
import { safeCallErrorCode, shortCallId } from './callDebug'
import { isCallSetupCancelledError, isTerminalRemoteMediaError, stableJson } from './callPolicies'
import { createCallRequestId, emitAndWaitForEvent } from './callSocket'
import { boundedRetryDelay, shouldApplyRemoteVideoRevision } from './callVideoState'
import {
  createMediasoupDevice,
  ensureMediasoupGlobalsRegistered,
  toRouterRtpCapabilities,
  toTransportOptions,
} from './mediasoup'

import type { CallWaitRegistry } from './callSocket'
import type { CallTelemetrySession } from './callTelemetry'
import type {
  CallJoinedPayload,
  CallRejoinedPayload,
  CallSocket,
  LocalVideoActivationSource,
  NewProducerPayload,
  ProducerCreatedPayload,
  RemoteVideoState,
  TransportCreatedPayload,
} from '../../types/call.types'
import type { Device as MediasoupDevice } from 'mediasoup-client'
import type * as MediasoupTypes from 'mediasoup-client/types'
import type { MediaStreamTrack } from 'react-native-webrtc'

type MutableRef<T> = { current: T }
type CachedMediasoupDevice = { device: MediasoupDevice; rtpCapabilitiesKey: string }
type StatsLogInput = {
  callId: string
  label: string
  mediaId: string
  getStats: () => Promise<RTCStatsReport>
}

export type RemoteConsumerRetryState = {
  attempt: number
  setupToken: number
  timeoutId: ReturnType<typeof setTimeout>
}

const debugCall = (...args: Parameters<typeof console.warn>) => {
  if (__DEV__) console.warn(...args)
}

type MediaTransportRuntimeOptions = {
  currentUserId: string | null
  socketRef: MutableRef<CallSocket | null>
  socketGenerationRef: MutableRef<number>
  waitRegistryRef: MutableRef<CallWaitRegistry>
  deviceRef: MutableRef<MediasoupDevice | null>
  sendTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  recvTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  localStreamRef: MutableRef<MediaStream | null>
  remoteStreamRef: MutableRef<MediaStream | null>
  audioProducerRef: MutableRef<MediasoupTypes.Producer<Record<string, unknown>> | null>
  cachedDeviceRef: MutableRef<CachedMediasoupDevice | null>
  consumerMapRef: MutableRef<Map<string, MediasoupTypes.Consumer<Record<string, unknown>>>>
  connectedTransportIdsRef: MutableRef<Set<string>>
  queuedRemoteProducerMapRef: MutableRef<Map<string, NewProducerPayload>>
  handledRemoteProducerIdsRef: MutableRef<Set<string>>
  remoteVideoEnabledByProducerRef: MutableRef<Map<string, boolean>>
  remoteVideoRevisionByProducerRef: MutableRef<Map<string, number>>
  closedRemoteVideoProducerIdsRef: MutableRef<Set<string>>
  remoteVideoSnapshotReadyRef: MutableRef<boolean>
  deriveRemoteVideoState: () => RemoteVideoState
  markRemoteVideoSnapshotReady: (ready: boolean) => void
  reconcileRemoteVideoSnapshot: (activeProducerIds: Set<string>) => void
  consumingProducerIdsRef: MutableRef<Set<string>>
  retryingProducerIdsRef: MutableRef<Set<string>>
  remoteConsumerRetryStateRef: MutableRef<Map<string, RemoteConsumerRetryState>>
  routerRtpCapabilitiesRef: MutableRef<Record<string, unknown> | null>
  reconnectModeRef: MutableRef<'local' | 'peer' | null>
  cameraPausedByBackgroundRef: MutableRef<boolean>
  telemetrySessionRef: MutableRef<CallTelemetrySession | null>
  callAnsweredRef: MutableRef<boolean>
  callSetupGenerationRef: MutableRef<number>
  mediaTransportStateHandlerRef: MutableRef<
    ((payload: { callId: string; transportId: string; state: string }) => void) | null
  >
  getCurrentCallId: () => string | null
  assertCallSetupCurrent: (setupToken: number, callId: string) => void
  isCallSetupCurrent: (setupToken: number, callId: string) => boolean
  closeRemoteConsumer: (callId: string, consumerId: string) => void
  clearReconnectTimeout: () => void
  clearRemoteAudioFallback: () => void
  confirmAudioFlow: () => void
  scheduleRtcStatsLog: (input: StatsLogInput) => void
  startTimer: (initialDurationSec?: number) => void
  teardownOnce: (
    reason: string,
    options?: {
      errorMessage?: string | null
      telemetryError?: unknown
      telemetryErrorCode?: string
    },
  ) => Promise<void>
  stopRingingPreview: () => void
  armRemoteAudioFallback: () => void
  ensureLocalVideoProducer: (options?: {
    requestPermission?: boolean
    source?: LocalVideoActivationSource
  }) => Promise<boolean>
}

export const useCallMediaTransportRuntime = ({
  currentUserId,
  socketRef,
  socketGenerationRef,
  waitRegistryRef,
  deviceRef,
  sendTransportRef,
  recvTransportRef,
  localStreamRef,
  remoteStreamRef,
  audioProducerRef,
  cachedDeviceRef,
  consumerMapRef,
  connectedTransportIdsRef,
  queuedRemoteProducerMapRef,
  handledRemoteProducerIdsRef,
  remoteVideoEnabledByProducerRef,
  remoteVideoRevisionByProducerRef,
  closedRemoteVideoProducerIdsRef,
  remoteVideoSnapshotReadyRef,
  deriveRemoteVideoState,
  markRemoteVideoSnapshotReady,
  reconcileRemoteVideoSnapshot,
  consumingProducerIdsRef,
  retryingProducerIdsRef,
  remoteConsumerRetryStateRef,
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
  closeRemoteConsumer,
  clearReconnectTimeout,
  clearRemoteAudioFallback,
  confirmAudioFlow,
  scheduleRtcStatsLog,
  startTimer,
  teardownOnce,
  stopRingingPreview,
  armRemoteAudioFallback,
  ensureLocalVideoProducer,
}: MediaTransportRuntimeOptions) => {
  const ensureDeviceLoaded = useCallback(
    async (payload: CallJoinedPayload) => {
      const rtpCapabilitiesKey = stableJson(payload.rtpCapabilities)
      const activeDevice = deviceRef.current

      if (activeDevice) {
        if (stableJson(routerRtpCapabilitiesRef.current) !== rtpCapabilitiesKey) {
          throw new Error('Router RTP capabilities changed during an active call')
        }

        return activeDevice
      }

      const cachedDevice = cachedDeviceRef.current
      if (cachedDevice?.rtpCapabilitiesKey === rtpCapabilitiesKey) {
        deviceRef.current = cachedDevice.device
        routerRtpCapabilitiesRef.current = payload.rtpCapabilities
        telemetrySessionRef.current?.record('device_cache_hit', { outcome: 'succeeded' })
        return cachedDevice.device
      }

      ensureMediasoupGlobalsRegistered()
      const device = createMediasoupDevice()
      await device.load({
        routerRtpCapabilities: toRouterRtpCapabilities(payload.rtpCapabilities),
      })

      cachedDeviceRef.current = { device, rtpCapabilitiesKey }
      deviceRef.current = device
      routerRtpCapabilitiesRef.current = payload.rtpCapabilities
      telemetrySessionRef.current?.record('device_cache_miss', { outcome: 'succeeded' })
      return device
    },
    [cachedDeviceRef, deviceRef, routerRtpCapabilitiesRef, telemetrySessionRef],
  )

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
        debugCall(
          `[Call] ${direction} transport connection state changed`,
          JSON.stringify({
            callId: shortCallId(callId),
            transportId: shortCallId(transport.id),
            socketGeneration: socketGenerationRef.current,
            state,
          }),
        )
        mediaTransportStateHandlerRef.current?.({
          callId,
          transportId: transport.id,
          state,
        })
      })

      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        void (async () => {
          try {
            debugCall(
              `[Call] Connecting ${direction} transport`,
              JSON.stringify({
                callId: shortCallId(callId),
                transportId: shortCallId(transport.id),
                socketGeneration: socketGenerationRef.current,
              }),
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
            telemetrySessionRef.current?.record(`${direction}_transport_connected`, {
              outcome: 'succeeded',
            })
            debugCall(
              `[Call] ${direction} transport connected`,
              JSON.stringify({
                callId: shortCallId(callId),
                transportId: shortCallId(transport.id),
                socketGeneration: socketGenerationRef.current,
              }),
            )
            callback()
          } catch (error) {
            console.warn(
              `[Call] Failed to connect ${direction} transport`,
              JSON.stringify({
                callId: shortCallId(callId),
                transportId: shortCallId(transport.id),
                errorCode: safeCallErrorCode(error),
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
              const requestId = createCallRequestId('produce')
              debugCall(
                '[Call] Producing local media',
                JSON.stringify({
                  callId: shortCallId(callId),
                  transportId: shortCallId(transport.id),
                  socketGeneration: socketGenerationRef.current,
                  kind,
                  requestId: shortCallId(requestId),
                }),
              )
              const produced = await emitAndWaitForEvent<'produce', 'producer_created'>(
                socket,
                'produce',
                {
                  callId,
                  transportId: transport.id,
                  kind: kind as 'audio' | 'video',
                  rtpParameters: rtpParameters as unknown as Record<string, unknown>,
                  requestId,
                },
                {
                  event: 'producer_created',
                  timeoutMs: REMOTE_PRODUCER_TIMEOUT_MS,
                  registry: waitRegistryRef.current,
                  requestId,
                  filter: (payload: ProducerCreatedPayload) =>
                    payload.callId === callId &&
                    payload.userId === currentUserId &&
                    payload.kind === kind &&
                    payload.transportId === transport.id &&
                    payload.requestId === requestId,
                },
              )

              debugCall(
                '[Call] Local producer announced',
                JSON.stringify({
                  callId: shortCallId(callId),
                  transportId: shortCallId(transport.id),
                  socketGeneration: socketGenerationRef.current,
                  producerId: shortCallId(produced.producerId),
                  kind: produced.kind,
                }),
              )
              callback({ id: produced.producerId })
            } catch (error) {
              console.warn(
                '[Call] Failed to produce local media',
                JSON.stringify({
                  callId: shortCallId(callId),
                  transportId: shortCallId(transport.id),
                  socketGeneration: socketGenerationRef.current,
                  errorCode: safeCallErrorCode(error),
                }),
              )
              errback(error instanceof Error ? error : new Error('Failed to produce local media'))
            }
          })()
        })
      }

      return transport
    },
    [
      connectedTransportIdsRef,
      currentUserId,
      mediaTransportStateHandlerRef,
      socketGenerationRef,
      telemetrySessionRef,
      waitRegistryRef,
    ],
  )

  const consumeRemoteProducer = useCallback(
    async (
      payload: NewProducerPayload,
      options?: {
        propagateFailure?: boolean
        retryOnFailure?: boolean
        retryAttempt?: number
        setupToken?: number
      },
    ) => {
      const socket = socketRef.current
      const callId = getCurrentCallId()
      const device = deviceRef.current
      const recvTransport = recvTransportRef.current
      const setupToken = options?.setupToken ?? callSetupGenerationRef.current

      if (!callId || payload.callId !== callId) return
      assertCallSetupCurrent(setupToken, callId)

      if (
        payload.kind === 'video' &&
        closedRemoteVideoProducerIdsRef.current.has(payload.producerId)
      ) {
        return
      }

      if (payload.kind === 'video' && payload.userId !== currentUserId) {
        const incomingRevision = payload.revision ?? 0
        const currentRevision = remoteVideoRevisionByProducerRef.current.get(payload.producerId)
        const incomingEnabled = payload.paused === undefined ? undefined : payload.paused !== true
        if (
          shouldApplyRemoteVideoRevision(
            currentRevision,
            incomingRevision,
            remoteVideoEnabledByProducerRef.current.get(payload.producerId),
            incomingEnabled,
          )
        ) {
          remoteVideoRevisionByProducerRef.current.set(payload.producerId, incomingRevision)
          remoteVideoEnabledByProducerRef.current.set(
            payload.producerId,
            incomingEnabled ??
              remoteVideoEnabledByProducerRef.current.get(payload.producerId) ??
              true,
          )
          if (remoteVideoSnapshotReadyRef.current) {
            useCallStore.getState().patch({ remoteVideoState: deriveRemoteVideoState() })
          }
        }
      }

      if (!socket || !device?.loaded || !recvTransport) {
        if (options?.propagateFailure) throw new Error('Remote consumer runtime is unavailable')
        queuedRemoteProducerMapRef.current.set(payload.producerId, payload)
        return
      }

      if (
        payload.userId === currentUserId ||
        handledRemoteProducerIdsRef.current.has(payload.producerId) ||
        consumingProducerIdsRef.current.has(payload.producerId) ||
        retryingProducerIdsRef.current.has(payload.producerId)
      ) {
        return
      }

      consumingProducerIdsRef.current.add(payload.producerId)
      let pendingConsumer: MediasoupTypes.Consumer<Record<string, unknown>> | null = null
      let pendingServerConsumerId: string | null = null
      const consumeRequestId = createCallRequestId('consume')
      try {
        const consumerCreated = await emitAndWaitForEvent<'consume', 'consumer_created'>(
          socket,
          'consume',
          {
            callId,
            transportId: recvTransport.id,
            producerId: payload.producerId,
            rtpCapabilities: device.rtpCapabilities as unknown as Record<string, unknown>,
            requestId: consumeRequestId,
          },
          {
            event: 'consumer_created',
            timeoutMs: CONSUMER_CREATED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            requestId: consumeRequestId,
            filter: (eventPayload) =>
              eventPayload.callId === callId &&
              eventPayload.producerId === payload.producerId &&
              eventPayload.requestId === consumeRequestId,
          },
        )
        pendingServerConsumerId = consumerCreated.consumerId
        assertCallSetupCurrent(setupToken, callId)

        const consumer = await recvTransport.consume({
          id: consumerCreated.consumerId,
          producerId: consumerCreated.producerId,
          kind: consumerCreated.kind,
          rtpParameters: consumerCreated.rtpParameters as never,
        })
        pendingConsumer = consumer
        if (!isCallSetupCurrent(setupToken, callId)) {
          throw new Error(CALL_SETUP_CANCELLED_ERROR)
        }

        const firstRemoteAudio =
          payload.kind === 'audio' &&
          ![...consumerMapRef.current.values()].some((existing) => existing.kind === 'audio')
        consumerMapRef.current.set(consumer.id, consumer)
        telemetrySessionRef.current?.record('remote_consumer_ready', { outcome: 'succeeded' })

        if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream()
        remoteStreamRef.current.addTrack(consumer.track as unknown as MediaStreamTrack)
        useCallStore.getState().patch({ remoteStreamUrl: remoteStreamRef.current.toURL() })

        await emitAndWaitForEvent<'resume_consumer', 'consumer_resumed'>(
          socket,
          'resume_consumer',
          { callId, consumerId: consumer.id },
          {
            event: 'consumer_resumed',
            timeoutMs: CONSUMER_RESUMED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (eventPayload) =>
              eventPayload.callId === callId && eventPayload.consumerId === consumer.id,
          },
        )
        assertCallSetupCurrent(setupToken, callId)

        handledRemoteProducerIdsRef.current.add(payload.producerId)
        queuedRemoteProducerMapRef.current.delete(payload.producerId)
        const completedRetry = remoteConsumerRetryStateRef.current.get(payload.producerId)
        if (completedRetry) clearTimeout(completedRetry.timeoutId)
        remoteConsumerRetryStateRef.current.delete(payload.producerId)
        retryingProducerIdsRef.current.delete(payload.producerId)

        if (payload.kind === 'video') {
          useCallStore.getState().patch({ remoteVideoState: deriveRemoteVideoState() })
          pendingConsumer = null
          pendingServerConsumerId = null
          return
        }

        scheduleRtcStatsLog({
          callId,
          label: 'Remote consumer',
          mediaId: consumer.id,
          getStats: () => consumer.getStats(),
        })
        const wasWaitingForPeerAudio = reconnectModeRef.current === 'peer'
        reconnectModeRef.current = null
        clearReconnectTimeout()
        clearRemoteAudioFallback()
        useCallStore.getState().patch({
          ...(wasWaitingForPeerAudio ? { phase: 'active', reconnectDeadlineMs: null } : {}),
          remoteAudioState: 'connected',
        })
        if (firstRemoteAudio) {
          telemetrySessionRef.current?.record('remote_consumer_resumed', { outcome: 'succeeded' })
          // The consumer has resumed and its audio track is attached to the
          // stream. This is our client-side, privacy-safe usability proxy;
          // it intentionally does not inspect or record audio content.
          telemetrySessionRef.current?.record('remote_audio_ready', { outcome: 'succeeded' })
          confirmAudioFlow()
        }
        if (wasWaitingForPeerAudio) startTimer(useCallStore.getState().durationSec)
        pendingConsumer = null
        pendingServerConsumerId = null
      } catch (error) {
        if (pendingServerConsumerId) {
          closeRemoteConsumer(callId, pendingServerConsumerId)
          pendingServerConsumerId = null
        }
        if (pendingConsumer) {
          const consumer = pendingConsumer
          const remoteStream = remoteStreamRef.current
          try {
            remoteStream?.removeTrack(consumer.track as unknown as MediaStreamTrack)
          } catch {
            // The call teardown may already have removed the track.
          }
          try {
            consumer.close()
          } catch {
            // The native consumer may already be closed.
          }
          if (consumerMapRef.current.get(consumer.id) === consumer) {
            consumerMapRef.current.delete(consumer.id)
          }
          if (isCallSetupCurrent(setupToken, callId)) {
            useCallStore.getState().patch({ remoteStreamUrl: remoteStream?.toURL() ?? null })
          }
        }

        if (!isCallSetupCurrent(setupToken, callId)) {
          if (options?.propagateFailure) throw new Error(CALL_SETUP_CANCELLED_ERROR)
          return
        }

        const isRecoveryConsume =
          reconnectModeRef.current !== null || options?.retryOnFailure === true
        if (isRecoveryConsume) {
          if (isTerminalRemoteMediaError(error)) {
            if (payload.kind === 'video') {
              closedRemoteVideoProducerIdsRef.current.add(payload.producerId)
            }
            queuedRemoteProducerMapRef.current.delete(payload.producerId)
            const retryState = remoteConsumerRetryStateRef.current.get(payload.producerId)
            if (retryState) clearTimeout(retryState.timeoutId)
            remoteConsumerRetryStateRef.current.delete(payload.producerId)
            retryingProducerIdsRef.current.delete(payload.producerId)

            if (options?.propagateFailure) throw error
            if (payload.kind === 'video') {
              useCallStore.getState().patch({ remoteVideoState: deriveRemoteVideoState() })
              return
            }
            await teardownOnce('consume_remote_producer_terminal', {
              errorMessage: 'The call is no longer available',
              telemetryError: error,
              telemetryErrorCode: 'remote_media_terminal',
            })
            return
          }

          queuedRemoteProducerMapRef.current.set(payload.producerId, payload)
          useCallStore
            .getState()
            .patch(
              payload.kind === 'audio'
                ? { remoteAudioState: 'waiting' }
                : { remoteVideoState: deriveRemoteVideoState() },
            )
          const previousRetry = remoteConsumerRetryStateRef.current.get(payload.producerId)
          const attempt = options?.retryAttempt ?? previousRetry?.attempt ?? 0
          if (attempt >= REMOTE_CONSUMER_MAX_RETRY_ATTEMPTS) {
            if (previousRetry) clearTimeout(previousRetry.timeoutId)
            remoteConsumerRetryStateRef.current.delete(payload.producerId)
            retryingProducerIdsRef.current.delete(payload.producerId)
            if (options?.propagateFailure) throw error
            if (payload.kind === 'video') {
              useCallStore.getState().patch({ remoteVideoState: deriveRemoteVideoState() })
              return
            }
            await teardownOnce('consume_remote_producer_retry_exhausted', {
              errorMessage: 'Unable to restore call media',
              telemetryError: error,
              telemetryErrorCode: 'remote_media_retry_exhausted',
            })
            return
          }

          const nextAttempt = attempt + 1
          const retryDelay = boundedRetryDelay(
            attempt,
            REMOTE_CONSUMER_RETRY_DELAY_MS,
            REMOTE_CONSUMER_RETRY_DELAY_MAX_MS,
          )
          if (previousRetry) clearTimeout(previousRetry.timeoutId)
          retryingProducerIdsRef.current.add(payload.producerId)
          const retryState = {
            attempt: nextAttempt,
            setupToken,
            timeoutId: undefined as unknown as ReturnType<typeof setTimeout>,
          }
          retryState.timeoutId = setTimeout(() => {
            if (remoteConsumerRetryStateRef.current.get(payload.producerId) !== retryState) return
            remoteConsumerRetryStateRef.current.delete(payload.producerId)
            retryingProducerIdsRef.current.delete(payload.producerId)
            if (
              !isCallSetupCurrent(retryState.setupToken, payload.callId) ||
              !socketRef.current?.connected
            ) {
              return
            }
            const queuedPayload = queuedRemoteProducerMapRef.current.get(payload.producerId)
            if (!queuedPayload) return
            void consumeRemoteProducer(queuedPayload, {
              ...options,
              retryOnFailure: true,
              retryAttempt: retryState.attempt,
              setupToken: retryState.setupToken,
            }).catch((retryError) => {
              if (isCallSetupCancelledError(retryError)) return
              // The retry path is detached from the original event handler.
              // Terminal audio failures and exhausted retries still need one
              // deterministic teardown instead of an unhandled rejection.
              void teardownOnce('consume_remote_producer_retry_failed', {
                errorMessage: 'Unable to restore call media',
                telemetryError: retryError,
                telemetryErrorCode: isTerminalRemoteMediaError(retryError)
                  ? 'remote_media_terminal'
                  : 'remote_media_retry_failed',
              })
            })
          }, retryDelay)
          remoteConsumerRetryStateRef.current.set(payload.producerId, retryState)
          return
        }

        if (options?.propagateFailure) throw error
        if (payload.kind === 'video') {
          useCallStore.getState().patch({ remoteVideoState: deriveRemoteVideoState() })
          return
        }
        await teardownOnce('consume_remote_producer', { errorMessage: 'Unable to set up the call' })
      } finally {
        consumingProducerIdsRef.current.delete(payload.producerId)
      }
    },
    [
      assertCallSetupCurrent,
      callSetupGenerationRef,
      closedRemoteVideoProducerIdsRef,
      consumerMapRef,
      confirmAudioFlow,
      clearReconnectTimeout,
      clearRemoteAudioFallback,
      closeRemoteConsumer,
      currentUserId,
      deriveRemoteVideoState,
      deviceRef,
      getCurrentCallId,
      handledRemoteProducerIdsRef,
      isCallSetupCurrent,
      consumingProducerIdsRef,
      queuedRemoteProducerMapRef,
      reconnectModeRef,
      recvTransportRef,
      remoteStreamRef,
      remoteVideoEnabledByProducerRef,
      remoteVideoRevisionByProducerRef,
      remoteVideoSnapshotReadyRef,
      retryingProducerIdsRef,
      remoteConsumerRetryStateRef,
      scheduleRtcStatsLog,
      socketRef,
      startTimer,
      telemetrySessionRef,
      teardownOnce,
      waitRegistryRef,
    ],
  )

  const flushQueuedRemoteProducers = useCallback(
    async (options: { retryOnFailure?: boolean; setupToken: number }) => {
      const queuedProducers = [...queuedRemoteProducerMapRef.current.values()].sort(
        (left, right) => Number(right.kind === 'audio') - Number(left.kind === 'audio'),
      )

      for (const payload of queuedProducers) {
        await consumeRemoteProducer(payload, {
          propagateFailure: payload.kind === 'audio',
          retryOnFailure: options.retryOnFailure === true,
          setupToken: options.setupToken,
        })
      }
    },
    [consumeRemoteProducer, queuedRemoteProducerMapRef],
  )

  const postAnswerSetup = useCallback(
    async (
      payload: CallJoinedPayload | CallRejoinedPayload,
      options: { recovery?: boolean; resumeDurationSec?: number; setupToken: number },
    ) => {
      const socket = socketRef.current
      if (!socket) throw new Error('Call socket is not connected')

      const callId = payload.callId
      const callType = payload.session.callType
      const shouldDeferLocalVideo = callType === 'VIDEO' && AppState.currentState !== 'active'
      const shouldAutoEnableLocalVideo =
        callType === 'VIDEO' && useCallStore.getState().phase === 'connecting'
      const telemetry = telemetrySessionRef.current
      assertCallSetupCurrent(options.setupToken, callId)
      markRemoteVideoSnapshotReady(false)
      remoteVideoEnabledByProducerRef.current.clear()
      remoteVideoRevisionByProducerRef.current.clear()
      const device = await ensureDeviceLoaded(payload)
      telemetry?.record('device_loaded', { outcome: 'succeeded' })
      assertCallSetupCurrent(options.setupToken, callId)

      stopRingingPreview()
      // Establish the audio path independently from video. On a cold start,
      // camera initialization can take noticeably longer than the microphone;
      // coupling the two meant a video call sounded silent until camera setup
      // completed even though CallKit had already activated the audio session.
      const [recvTransportResult, sendTransportResult, localStreamResult] =
        await Promise.allSettled([
          createTransport(socket, callId, 'recv', device),
          createTransport(socket, callId, 'send', device),
          mediaDevices.getUserMedia({
            audio: true,
            video: false,
          }),
        ])

      if (
        recvTransportResult.status !== 'fulfilled' ||
        sendTransportResult.status !== 'fulfilled' ||
        localStreamResult.status !== 'fulfilled'
      ) {
        if (recvTransportResult.status === 'fulfilled') recvTransportResult.value.close()
        if (sendTransportResult.status === 'fulfilled') sendTransportResult.value.close()
        if (localStreamResult.status === 'fulfilled') {
          localStreamResult.value.getTracks().forEach((track) => track.stop())
        }
        const failedResult = [recvTransportResult, sendTransportResult, localStreamResult].find(
          (result) => result.status === 'rejected',
        )
        throw failedResult && failedResult.status === 'rejected'
          ? failedResult.reason
          : new Error('Unable to initialize call media')
      }

      const recvTransport = recvTransportResult.value
      const sendTransport = sendTransportResult.value
      const localStream = localStreamResult.value
      telemetry?.record('recv_transport_created', { outcome: 'succeeded' })
      telemetry?.record('send_transport_created', { outcome: 'succeeded' })
      if (!isCallSetupCurrent(options.setupToken, callId)) {
        recvTransport.close()
        sendTransport.close()
        localStream.getTracks().forEach((track) => track.stop())
        throw new Error(CALL_SETUP_CANCELLED_ERROR)
      }

      recvTransportRef.current = recvTransport
      sendTransportRef.current = sendTransport
      localStreamRef.current = localStream
      const localAudioTrack = localStream.getAudioTracks()[0]
      if (!localAudioTrack) throw new Error('No local audio track available')

      const muted = useCallStore.getState().muted
      localAudioTrack.enabled = !muted
      telemetry?.record('microphone_ready', { outcome: 'succeeded' })

      if (!device.canProduce('audio')) throw new Error('Device cannot produce audio')
      const audioProducer = await sendTransport.produce({
        track: localAudioTrack as never,
        codecOptions: VOICE_OPUS_CODEC_OPTIONS,
        stopTracks: false,
      })
      if (!isCallSetupCurrent(options.setupToken, callId)) {
        audioProducer.close()
        throw new Error(CALL_SETUP_CANCELLED_ERROR)
      }
      audioProducerRef.current = audioProducer
      telemetry?.record('audio_producer_ready', { outcome: 'succeeded' })
      scheduleRtcStatsLog({
        callId,
        label: 'Local producer',
        mediaId: audioProducer.id,
        getStats: () => audioProducer.getStats(),
      })

      const activeProducers = [...(payload.activeProducers ?? [])].sort(
        (left, right) => Number(right.kind === 'audio') - Number(left.kind === 'audio'),
      )
      reconcileRemoteVideoSnapshot(
        new Set(
          activeProducers
            .filter((producer) => producer.kind === 'video' && producer.userId !== currentUserId)
            .map((producer) => producer.producerId),
        ),
      )
      for (const producer of activeProducers) {
        await consumeRemoteProducer(
          {
            callId,
            userId: producer.userId,
            producerId: producer.producerId,
            kind: producer.kind,
            ...(producer.paused !== undefined ? { paused: producer.paused } : {}),
            ...(producer.revision !== undefined ? { revision: producer.revision } : {}),
          },
          {
            propagateFailure: producer.kind === 'audio',
            retryOnFailure: options.recovery === true,
            setupToken: options.setupToken,
          },
        )
      }
      await flushQueuedRemoteProducers({
        retryOnFailure: options.recovery === true,
        setupToken: options.setupToken,
      })
      assertCallSetupCurrent(options.setupToken, callId)
      markRemoteVideoSnapshotReady(callType === 'VIDEO')
      telemetry?.recordLifecycle('audio_ready', { outcome: 'succeeded' })
      callAnsweredRef.current = true

      const consumers = [...consumerMapRef.current.values()]
      useCallStore.getState().patch({
        phase: 'active',
        callType,
        muted,
        // Audio makes the call usable. Video joins later so a slow camera or
        // a camera runtime failure can never tear down an otherwise healthy
        // audio call after the authoritative accept has succeeded.
        cameraEnabled: false,
        localStreamUrl: localStream.toURL(),
        remoteAudioState: consumers.some((consumer) => consumer.kind === 'audio')
          ? 'connected'
          : 'waiting',
        remoteVideoState: callType === 'VIDEO' ? deriveRemoteVideoState() : 'idle',
        remoteStreamUrl: remoteStreamRef.current?.toURL() ?? null,
        reconnectDeadlineMs: null,
      })
      startTimer(options.resumeDurationSec ?? 0)
      armRemoteAudioFallback()

      if (callType !== 'VIDEO' || !shouldAutoEnableLocalVideo) return

      if (shouldDeferLocalVideo) {
        cameraPausedByBackgroundRef.current = true
        return
      }

      // Keep this enrichment detached from the audio-ready critical path. The
      // local-media runtime owns the single-flight activation promise shared by
      // this automatic attempt, manual camera toggles, and resume handling.
      void (async () => {
        try {
          telemetry?.recordLifecycle('media_enhancing', { outcome: 'started' })
          const activated = await ensureLocalVideoProducer({
            requestPermission: false,
            source: 'post_answer',
          })
          if (activated && isCallSetupCurrent(options.setupToken, callId)) {
            telemetry?.record('video_producer_ready', { outcome: 'succeeded' })
          }
        } catch (error) {
          const currentState = useCallStore.getState()
          if (
            !isCallSetupCurrent(options.setupToken, callId) ||
            currentState.callId !== callId ||
            currentState.phase !== 'active'
          ) {
            return
          }
          telemetry?.record('video_producer_failed', { outcome: 'failed', error })
          useCallStore.getState().patch({
            cameraEnabled: false,
            localStreamUrl: localStream.toURL(),
          })
        }
      })()
    },
    [
      armRemoteAudioFallback,
      assertCallSetupCurrent,
      audioProducerRef,
      callAnsweredRef,
      cameraPausedByBackgroundRef,
      consumerMapRef,
      consumeRemoteProducer,
      createTransport,
      currentUserId,
      deriveRemoteVideoState,
      ensureDeviceLoaded,
      flushQueuedRemoteProducers,
      isCallSetupCurrent,
      localStreamRef,
      markRemoteVideoSnapshotReady,
      reconcileRemoteVideoSnapshot,
      recvTransportRef,
      remoteStreamRef,
      remoteVideoEnabledByProducerRef,
      remoteVideoRevisionByProducerRef,
      scheduleRtcStatsLog,
      sendTransportRef,
      socketRef,
      startTimer,
      stopRingingPreview,
      telemetrySessionRef,
      ensureLocalVideoProducer,
    ],
  )

  return {
    ensureDeviceLoaded,
    createTransport,
    consumeRemoteProducer,
    flushQueuedRemoteProducers,
    postAnswerSetup,
  }
}
