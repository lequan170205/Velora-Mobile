import { useCallback } from 'react'
import { AppState } from 'react-native'
import { MediaStream, mediaDevices } from 'react-native-webrtc'

import { useCallStore } from '../../stores/callStore'

import {
  CALL_SETUP_CANCELLED_ERROR,
  CONSUMER_CREATED_TIMEOUT_MS,
  CONSUMER_RESUMED_TIMEOUT_MS,
  REMOTE_PRODUCER_TIMEOUT_MS,
  TRANSPORT_CONNECTED_TIMEOUT_MS,
  TRANSPORT_CREATED_TIMEOUT_MS,
  VOICE_OPUS_CODEC_OPTIONS,
} from './callConstants'
import { cameraConstraints, stableJson } from './callPolicies'
import { emitAndWaitForEvent } from './callSocket'
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
  NewProducerPayload,
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

const debugCall = (...args: Parameters<typeof console.warn>) => {
  if (__DEV__) console.warn(...args)
}

type MediaTransportRuntimeOptions = {
  currentUserId: string | null
  socketRef: MutableRef<CallSocket | null>
  waitRegistryRef: MutableRef<CallWaitRegistry>
  deviceRef: MutableRef<MediasoupDevice | null>
  sendTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  recvTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  localStreamRef: MutableRef<MediaStream | null>
  remoteStreamRef: MutableRef<MediaStream | null>
  audioProducerRef: MutableRef<MediasoupTypes.Producer<Record<string, unknown>> | null>
  videoProducerRef: MutableRef<MediasoupTypes.Producer<Record<string, unknown>> | null>
  cachedDeviceRef: MutableRef<CachedMediasoupDevice | null>
  consumerMapRef: MutableRef<Map<string, MediasoupTypes.Consumer<Record<string, unknown>>>>
  connectedTransportIdsRef: MutableRef<Set<string>>
  queuedRemoteProducerMapRef: MutableRef<Map<string, NewProducerPayload>>
  handledRemoteProducerIdsRef: MutableRef<Set<string>>
  remoteVideoEnabledByProducerRef: MutableRef<Map<string, boolean>>
  consumingProducerIdsRef: MutableRef<Set<string>>
  retryingProducerIdsRef: MutableRef<Set<string>>
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
}

export const useCallMediaTransportRuntime = ({
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
          JSON.stringify({ callId, transportId: transport.id, state }),
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
            telemetrySessionRef.current?.record(`${direction}_transport_connected`, {
              outcome: 'succeeded',
            })
            debugCall(
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
              debugCall(
                '[Call] Producing local media',
                JSON.stringify({ callId, transportId: transport.id, kind }),
              )
              const produced = await emitAndWaitForEvent<'produce', 'new_producer'>(
                socket,
                'produce',
                {
                  callId,
                  transportId: transport.id,
                  kind: kind as 'audio' | 'video',
                  rtpParameters: rtpParameters as unknown as Record<string, unknown>,
                },
                {
                  event: 'new_producer',
                  timeoutMs: REMOTE_PRODUCER_TIMEOUT_MS,
                  registry: waitRegistryRef.current,
                  filter: (payload) =>
                    payload.callId === callId &&
                    payload.userId === currentUserId &&
                    payload.kind === kind,
                },
              )

              debugCall(
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
      telemetrySessionRef,
      waitRegistryRef,
    ],
  )

  const consumeRemoteProducer = useCallback(
    async (
      payload: NewProducerPayload,
      options?: { propagateFailure?: boolean; setupToken?: number },
    ) => {
      const socket = socketRef.current
      const callId = getCurrentCallId()
      const device = deviceRef.current
      const recvTransport = recvTransportRef.current
      const setupToken = options?.setupToken ?? callSetupGenerationRef.current

      if (!callId || payload.callId !== callId) return
      assertCallSetupCurrent(setupToken, callId)

      if (!socket || !device?.loaded || !recvTransport) {
        if (options?.propagateFailure) throw new Error('Remote consumer runtime is unavailable')
        queuedRemoteProducerMapRef.current.set(payload.producerId, payload)
        return
      }

      if (
        payload.userId === currentUserId ||
        handledRemoteProducerIdsRef.current.has(payload.producerId) ||
        consumingProducerIdsRef.current.has(payload.producerId)
      ) {
        return
      }

      consumingProducerIdsRef.current.add(payload.producerId)
      let pendingConsumer: MediasoupTypes.Consumer<Record<string, unknown>> | null = null
      try {
        const consumerCreated = await emitAndWaitForEvent<'consume', 'consumer_created'>(
          socket,
          'consume',
          {
            callId,
            transportId: recvTransport.id,
            producerId: payload.producerId,
            rtpCapabilities: device.rtpCapabilities as unknown as Record<string, unknown>,
          },
          {
            event: 'consumer_created',
            timeoutMs: CONSUMER_CREATED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (eventPayload) =>
              eventPayload.callId === callId && eventPayload.producerId === payload.producerId,
          },
        )
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

        if (payload.kind === 'video') {
          if (payload.paused !== undefined) {
            remoteVideoEnabledByProducerRef.current.set(payload.producerId, !payload.paused)
          }
          const videoEnabled =
            remoteVideoEnabledByProducerRef.current.get(payload.producerId) ?? !payload.paused
          useCallStore.getState().patch({
            remoteVideoState: videoEnabled ? 'connected' : 'off',
          })
          pendingConsumer = null
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
      } catch (error) {
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

        if (reconnectModeRef.current) {
          queuedRemoteProducerMapRef.current.set(payload.producerId, payload)
          useCallStore
            .getState()
            .patch(
              payload.kind === 'audio'
                ? { remoteAudioState: 'waiting' }
                : { remoteVideoState: 'waiting' },
            )
          if (!retryingProducerIdsRef.current.has(payload.producerId)) {
            retryingProducerIdsRef.current.add(payload.producerId)
            setTimeout(() => {
              retryingProducerIdsRef.current.delete(payload.producerId)
              const queuedPayload = queuedRemoteProducerMapRef.current.get(payload.producerId)
              if (queuedPayload && reconnectModeRef.current)
                void consumeRemoteProducer(queuedPayload)
            }, 750)
          }
          return
        }

        if (options?.propagateFailure) throw error
        if (payload.kind === 'video') {
          useCallStore.getState().patch({ remoteVideoState: 'waiting' })
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
      consumerMapRef,
      confirmAudioFlow,
      clearReconnectTimeout,
      clearRemoteAudioFallback,
      currentUserId,
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
      retryingProducerIdsRef,
      scheduleRtcStatsLog,
      socketRef,
      startTimer,
      telemetrySessionRef,
      teardownOnce,
      waitRegistryRef,
    ],
  )

  const flushQueuedRemoteProducers = useCallback(
    async (options: { setupToken: number }) => {
      const queuedProducers = [...queuedRemoteProducerMapRef.current.values()].sort(
        (left, right) => Number(right.kind === 'audio') - Number(left.kind === 'audio'),
      )

      for (const payload of queuedProducers) {
        await consumeRemoteProducer(payload, {
          propagateFailure: payload.kind === 'audio',
          setupToken: options.setupToken,
        })
      }
    },
    [consumeRemoteProducer, queuedRemoteProducerMapRef],
  )

  const postAnswerSetup = useCallback(
    async (
      payload: CallJoinedPayload | CallRejoinedPayload,
      options: { resumeDurationSec?: number; setupToken: number },
    ) => {
      const socket = socketRef.current
      if (!socket) throw new Error('Call socket is not connected')

      const callId = payload.callId
      const callType = payload.session.callType
      const shouldDeferLocalVideo = callType === 'VIDEO' && AppState.currentState !== 'active'
      const telemetry = telemetrySessionRef.current
      assertCallSetupCurrent(options.setupToken, callId)
      const device = await ensureDeviceLoaded(payload)
      telemetry?.record('device_loaded', { outcome: 'succeeded' })
      assertCallSetupCurrent(options.setupToken, callId)

      stopRingingPreview()
      const stateBeforeMedia = useCallStore.getState()
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
      for (const producer of activeProducers) {
        await consumeRemoteProducer(
          {
            callId,
            userId: producer.userId,
            producerId: producer.producerId,
            kind: producer.kind,
            ...(producer.paused !== undefined ? { paused: producer.paused } : {}),
          },
          { propagateFailure: producer.kind === 'audio', setupToken: options.setupToken },
        )
      }
      await flushQueuedRemoteProducers({ setupToken: options.setupToken })
      assertCallSetupCurrent(options.setupToken, callId)
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
        remoteVideoState:
          callType === 'VIDEO'
            ? consumers.some((consumer) => consumer.kind === 'video')
              ? 'connected'
              : 'waiting'
            : 'idle',
        remoteStreamUrl: remoteStreamRef.current?.toURL() ?? null,
        reconnectDeadlineMs: null,
      })
      startTimer(options.resumeDurationSec ?? 0)
      armRemoteAudioFallback()

      if (callType !== 'VIDEO') return

      if (shouldDeferLocalVideo) {
        cameraPausedByBackgroundRef.current = true
        return
      }

      // Keep this enrichment detached from the audio-ready critical path.
      // `activateLocalVideo` handles later user retries; this first attempt is
      // best-effort after the camera permission check that happened pre-accept.
      void (async () => {
        try {
          telemetry?.recordLifecycle('media_enhancing', { outcome: 'started' })
          if (!device.canProduce('video')) throw new Error('Device cannot produce video')

          const videoCapture = await mediaDevices.getUserMedia({
            audio: false,
            video: cameraConstraints(stateBeforeMedia.cameraFacing),
          })
          const capturedVideoTrack = videoCapture.getVideoTracks()[0]
          if (!capturedVideoTrack) {
            videoCapture.getTracks().forEach((track) => track.stop())
            throw new Error('No local video track available')
          }
          if (!isCallSetupCurrent(options.setupToken, callId)) {
            videoCapture.getTracks().forEach((track) => track.stop())
            return
          }

          capturedVideoTrack.enabled = true
          localStream.addTrack(capturedVideoTrack as unknown as MediaStreamTrack)
          try {
            const videoProducer = await sendTransport.produce({
              track: capturedVideoTrack as never,
              stopTracks: false,
            })
            if (!isCallSetupCurrent(options.setupToken, callId)) {
              videoProducer.close()
              localStream.removeTrack(capturedVideoTrack as unknown as MediaStreamTrack)
              capturedVideoTrack.stop()
              return
            }
            videoProducerRef.current = videoProducer
            telemetry?.record('video_producer_ready', { outcome: 'succeeded' })
            useCallStore.getState().patch({
              cameraEnabled: true,
              localStreamUrl: localStream.toURL(),
            })
          } catch (error) {
            try {
              localStream.removeTrack(capturedVideoTrack as unknown as MediaStreamTrack)
            } catch {
              // The call teardown may already have removed the track.
            }
            capturedVideoTrack.stop()
            throw error
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
      ensureDeviceLoaded,
      flushQueuedRemoteProducers,
      isCallSetupCurrent,
      localStreamRef,
      recvTransportRef,
      remoteStreamRef,
      scheduleRtcStatsLog,
      sendTransportRef,
      socketRef,
      startTimer,
      stopRingingPreview,
      telemetrySessionRef,
      videoProducerRef,
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
