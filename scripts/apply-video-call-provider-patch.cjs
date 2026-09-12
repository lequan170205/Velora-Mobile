const fs = require('node:fs')

const providerPath = 'src/providers/CallProvider.tsx'
const conversationPath = 'app/conversation/[id].tsx'

const replaceOnce = (source, search, replacement, label) => {
  if (source.includes(replacement)) return source
  if (!source.includes(search)) throw new Error(`Patch anchor not found: ${label}`)
  return source.replace(search, replacement)
}

const replaceBetween = (source, start, end, replacement, label) => {
  if (source.includes(replacement)) return source
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  if (startIndex < 0 || endIndex < 0) throw new Error(`Patch boundary not found: ${label}`)
  return source.slice(0, startIndex) + replacement + source.slice(endIndex)
}

let provider = fs.readFileSync(providerPath, 'utf8')
if (!provider.includes('// VIDEO_CALL_1TO1_PROVIDER_PATCH')) {
  provider = replaceOnce(
    provider,
    "import type {\n  AudioBitrateProfile,",
    "// VIDEO_CALL_1TO1_PROVIDER_PATCH\nimport type {\n  AudioBitrateProfile,",
    'provider marker',
  )

  provider = replaceOnce(
    provider,
    "  CallRejectedPayload,\n  CallSocket,\n  IncomingCallPayload,",
    "  CallRejectedPayload,\n  CallSocket,\n  CallType,\n  CallTypeChangedPayload,\n  CameraFacing,\n  IncomingCallPayload,",
    'call type imports',
  )
  provider = replaceOnce(
    provider,
    "  PeerLeftPayload,\n  StartVoiceCallInput,\n  TransportCreatedPayload,",
    "  PeerLeftPayload,\n  ProducerClosedPayload,\n  StartCallInput,\n  TransportCreatedPayload,",
    'media imports',
  )

  provider = replaceOnce(
    provider,
    "const CallContext = createContext<UseCallValue>({\n  startVoiceCall: async () => {},\n  acceptIncomingCall: async () => {},\n  rejectIncomingCall: async () => {},\n  endCall: async () => {},\n  toggleMute: () => {},\n  toggleSpeaker: () => {},\n  dismissCallError: () => {},\n})",
    "const CallContext = createContext<UseCallValue>({\n  startVoiceCall: async () => {},\n  startVideoCall: async () => {},\n  acceptIncomingCall: async () => {},\n  rejectIncomingCall: async () => {},\n  endCall: async () => {},\n  toggleMute: () => {},\n  toggleSpeaker: () => {},\n  toggleCamera: async () => {},\n  switchCamera: async () => {},\n  switchCallType: async () => {},\n  dismissCallError: () => {},\n})",
    'call context defaults',
  )

  provider = replaceOnce(
    provider,
    "const getRemoteSetupFailureReason = (errorCode: string) =>\n  errorCode === 'remote_audio_not_ready' ? errorCode : 'remote_accept_failed'\n",
    "const getRemoteSetupFailureReason = (errorCode: string) =>\n  errorCode === 'remote_audio_not_ready' ? errorCode : 'remote_accept_failed'\n\nconst cameraConstraints = (facing: CameraFacing) => ({\n  facingMode: facing,\n  width: { ideal: 1280 },\n  height: { ideal: 720 },\n  frameRate: { ideal: 24, max: 30 },\n})\n",
    'camera constraints',
  )

  provider = replaceOnce(
    provider,
    "  const localStreamRef = useRef<MediaStream | null>(null)\n  const remoteStreamRef = useRef<MediaStream | null>(null)\n  const audioProducerRef = useRef<MediasoupTypes.Producer<Record<string, unknown>> | null>(null)",
    "  const localStreamRef = useRef<MediaStream | null>(null)\n  const ringingPreviewStreamRef = useRef<MediaStream | null>(null)\n  const remoteStreamRef = useRef<MediaStream | null>(null)\n  const audioProducerRef = useRef<MediasoupTypes.Producer<Record<string, unknown>> | null>(null)\n  const videoProducerRef = useRef<MediasoupTypes.Producer<Record<string, unknown>> | null>(null)",
    'video media refs',
  )
  provider = replaceOnce(
    provider,
    "  const callSocketAuthenticatedRef = useRef(false)\n",
    "  const callSocketAuthenticatedRef = useRef(false)\n  const cameraPausedByBackgroundRef = useRef(false)\n  const lastAppStateRef = useRef(AppState.currentState)\n",
    'camera lifecycle refs',
  )

  provider = replaceOnce(
    provider,
    "    const consumer = consumerMapRef.current.values().next().value as\n      MediasoupTypes.Consumer | undefined",
    "    const consumer = [...consumerMapRef.current.values()].find(\n      (candidate) => candidate.kind === 'audio',\n    ) as MediasoupTypes.Consumer | undefined",
    'audio quality consumer selection',
  )

  provider = replaceOnce(
    provider,
    "  const ensureMicPermission = useCallback(async () => {\n    if (typeof Camera.requestMicrophonePermissionsAsync !== 'function') {\n      throw new Error('Microphone permission API is unavailable in this build')\n    }\n\n    const permission = await Camera.requestMicrophonePermissionsAsync()\n    const granted = permission.granted === true\n    useCallStore.getState().patch({ hasMicPermission: granted })\n    return granted\n  }, [])\n",
    "  const ensureMicPermission = useCallback(async () => {\n    if (typeof Camera.requestMicrophonePermissionsAsync !== 'function') {\n      throw new Error('Microphone permission API is unavailable in this build')\n    }\n\n    const permission = await Camera.requestMicrophonePermissionsAsync()\n    const granted = permission.granted === true\n    useCallStore.getState().patch({ hasMicPermission: granted })\n    return granted\n  }, [])\n\n  const ensureCameraPermission = useCallback(async () => {\n    if (typeof Camera.requestCameraPermissionsAsync !== 'function') {\n      throw new Error('Camera permission API is unavailable in this build')\n    }\n\n    const permission = await Camera.requestCameraPermissionsAsync()\n    const granted = permission.granted === true\n    useCallStore.getState().patch({ hasCameraPermission: granted })\n    return granted\n  }, [])\n\n  const stopRingingPreview = useCallback(() => {\n    const preview = ringingPreviewStreamRef.current\n    preview?.getTracks().forEach((track) => {\n      try {\n        track.stop()\n      } catch {\n        // Best-effort preview cleanup.\n      }\n    })\n    ringingPreviewStreamRef.current = null\n    if (!localStreamRef.current) {\n      useCallStore.getState().patch({ localStreamUrl: null })\n    }\n  }, [])\n\n  const deactivateLocalVideo = useCallback(() => {\n    try {\n      videoProducerRef.current?.close()\n    } catch {\n      // The server may already have closed the producer during a downgrade.\n    }\n    videoProducerRef.current = null\n\n    const localStream = localStreamRef.current\n    localStream?.getVideoTracks().forEach((track) => {\n      try {\n        localStream.removeTrack(track)\n      } catch {}\n      try {\n        track.stop()\n      } catch {}\n    })\n\n    cameraPausedByBackgroundRef.current = false\n    useCallStore.getState().patch({\n      cameraEnabled: false,\n      localStreamUrl: localStream?.toURL() ?? null,\n    })\n  }, [])\n\n  const activateLocalVideo = useCallback(\n    async (options?: { requestPermission?: boolean }) => {\n      const state = useCallStore.getState()\n      if (state.phase !== 'active' || state.callType !== 'VIDEO' || !state.callId) {\n        return false\n      }\n\n      if (options?.requestPermission !== false && state.hasCameraPermission !== true) {\n        const granted = await ensureCameraPermission()\n        if (!granted) {\n          presentError('Velora needs camera access for video calls')\n          return false\n        }\n      }\n\n      const existingTrack = localStreamRef.current?.getVideoTracks()[0]\n      if (existingTrack && existingTrack.readyState === 'live') {\n        existingTrack.enabled = true\n        useCallStore.getState().patch({\n          cameraEnabled: true,\n          localStreamUrl: localStreamRef.current?.toURL() ?? null,\n        })\n        return true\n      }\n\n      const sendTransport = sendTransportRef.current\n      const device = deviceRef.current\n      if (!sendTransport || !device?.loaded || !device.canProduce('video')) {\n        presentError('Video is unavailable on this call')\n        return false\n      }\n\n      const stream = await mediaDevices.getUserMedia({\n        audio: false,\n        video: cameraConstraints(state.cameraFacing),\n      })\n      const track = stream.getVideoTracks()[0]\n      if (!track) {\n        stream.getTracks().forEach((candidate) => candidate.stop())\n        throw new Error('No local video track available')\n      }\n\n      if (!localStreamRef.current) {\n        localStreamRef.current = new MediaStream()\n      }\n      localStreamRef.current.addTrack(track as unknown as MediaStreamTrack)\n      const producer = await sendTransport.produce({ track: track as never, stopTracks: false })\n      videoProducerRef.current = producer\n      useCallStore.getState().patch({\n        cameraEnabled: true,\n        localStreamUrl: localStreamRef.current.toURL(),\n      })\n      return true\n    },\n    [ensureCameraPermission, presentError],\n  )\n\n  const clearRemoteVideoRuntime = useCallback((state: 'idle' | 'off' = 'off') => {\n    const remoteStream = remoteStreamRef.current\n    for (const [consumerId, consumer] of consumerMapRef.current.entries()) {\n      if (consumer.kind !== 'video') continue\n      try {\n        remoteStream?.removeTrack(consumer.track as unknown as MediaStreamTrack)\n      } catch {}\n      try {\n        consumer.close()\n      } catch {}\n      consumerMapRef.current.delete(consumerId)\n      handledRemoteProducerIdsRef.current.delete(consumer.producerId)\n    }\n    useCallStore.getState().patch({\n      remoteVideoState: state,\n      remoteStreamUrl: remoteStream?.toURL() ?? null,\n    })\n  }, [])\n",
    'camera runtime helpers',
  )

  provider = replaceOnce(
    provider,
    "      localStreamRef.current = null\n      remoteStreamRef.current = null\n      audioProducerRef.current = null",
    "      localStreamRef.current = null\n      ringingPreviewStreamRef.current = null\n      remoteStreamRef.current = null\n      audioProducerRef.current = null\n      videoProducerRef.current = null\n      cameraPausedByBackgroundRef.current = false",
    'reset video refs',
  )
  provider = replaceOnce(
    provider,
    "      const currentProducer = audioProducerRef.current\n      const currentSendTransport = sendTransportRef.current",
    "      const currentAudioProducer = audioProducerRef.current\n      const currentVideoProducer = videoProducerRef.current\n      const currentPreviewStream = ringingPreviewStreamRef.current\n      const currentSendTransport = sendTransportRef.current",
    'dispose producer refs',
  )
  provider = replaceOnce(
    provider,
    "      if (currentProducer) {\n        try {\n          currentProducer.close()\n        } catch {\n          console.warn('[Call] Failed to close producer during teardown')\n        }\n      }",
    "      for (const producer of [currentAudioProducer, currentVideoProducer]) {\n        if (!producer) continue\n        try {\n          producer.close()\n        } catch {\n          console.warn('[Call] Failed to close producer during teardown')\n        }\n      }",
    'dispose producers',
  )
  provider = replaceOnce(
    provider,
    "      localStream?.getTracks().forEach((track) => {\n        try {\n          track.stop()\n        } catch {\n          console.warn('[Call] Failed to stop local track during teardown')\n        }\n      })",
    "      localStream?.getTracks().forEach((track) => {\n        try {\n          track.stop()\n        } catch {\n          console.warn('[Call] Failed to stop local track during teardown')\n        }\n      })\n      currentPreviewStream?.getTracks().forEach((track) => {\n        try {\n          track.stop()\n        } catch {\n          console.warn('[Call] Failed to stop camera preview during teardown')\n        }\n      })",
    'dispose preview',
  )
  provider = replaceOnce(
    provider,
    "    useCallStore.getState().patch({ remoteStreamUrl: null })\n  }, [])\n\n  const teardownOnce",
    "    useCallStore.getState().patch({\n      remoteStreamUrl: null,\n      remoteVideoState: useCallStore.getState().callType === 'VIDEO' ? 'waiting' : 'idle',\n    })\n  }, [])\n\n  const teardownOnce",
    'reset remote video state',
  )

  provider = replaceOnce(
    provider,
    "                  kind: kind as 'audio',",
    "                  kind: kind as 'audio' | 'video',",
    'produce media kind',
  )
  provider = replaceOnce(
    provider,
    "                    payload.userId === currentUserId &&\n                    payload.kind === 'audio',",
    "                    payload.userId === currentUserId &&\n                    payload.kind === kind,",
    'produce event kind filter',
  )
  provider = replaceOnce(
    provider,
    "              errback(error instanceof Error ? error : new Error('Failed to produce audio'))",
    "              errback(error instanceof Error ? error : new Error('Failed to produce local media'))",
    'produce error',
  )

  const consumeBlock = `  const consumeRemoteProducer = useCallback(\n    async (\n      payload: NewProducerPayload,\n      options?: { propagateFailure?: boolean; setupToken?: number },\n    ) => {\n      const socket = socketRef.current\n      const callId = getCurrentCallId()\n      const device = deviceRef.current\n      const recvTransport = recvTransportRef.current\n      const setupToken = options?.setupToken ?? callSetupGenerationRef.current\n\n      if (!callId || payload.callId !== callId) return\n      assertCallSetupCurrent(setupToken, callId)\n\n      if (!socket || !device?.loaded || !recvTransport) {\n        if (options?.propagateFailure) throw new Error('Remote consumer runtime is unavailable')\n        queuedRemoteProducerMapRef.current.set(payload.producerId, payload)\n        return\n      }\n\n      if (\n        payload.userId === currentUserId ||\n        handledRemoteProducerIdsRef.current.has(payload.producerId) ||\n        consumingProducerIdsRef.current.has(payload.producerId)\n      ) {\n        return\n      }\n\n      consumingProducerIdsRef.current.add(payload.producerId)\n      try {\n        const consumerCreated = await emitAndWaitForEvent<'consume', 'consumer_created'>(\n          socket,\n          'consume',\n          {\n            callId,\n            transportId: recvTransport.id,\n            producerId: payload.producerId,\n            rtpCapabilities: device.rtpCapabilities as unknown as Record<string, unknown>,\n          },\n          {\n            event: 'consumer_created',\n            timeoutMs: CONSUMER_CREATED_TIMEOUT_MS,\n            registry: waitRegistryRef.current,\n            filter: (eventPayload) =>\n              eventPayload.callId === callId && eventPayload.producerId === payload.producerId,\n          },\n        )\n        assertCallSetupCurrent(setupToken, callId)\n\n        const consumer = await recvTransport.consume({\n          id: consumerCreated.consumerId,\n          producerId: consumerCreated.producerId,\n          kind: consumerCreated.kind,\n          rtpParameters: consumerCreated.rtpParameters as never,\n        })\n        if (!isCallSetupCurrent(setupToken, callId)) {\n          consumer.close()\n          throw new Error(CALL_SETUP_CANCELLED_ERROR)\n        }\n\n        const firstRemoteAudio =\n          payload.kind === 'audio' &&\n          ![...consumerMapRef.current.values()].some((existing) => existing.kind === 'audio')\n        consumerMapRef.current.set(consumer.id, consumer)\n        telemetrySessionRef.current?.record('remote_consumer_ready', { outcome: 'succeeded' })\n\n        if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream()\n        remoteStreamRef.current.addTrack(consumer.track as unknown as MediaStreamTrack)\n        useCallStore.getState().patch({ remoteStreamUrl: remoteStreamRef.current.toURL() })\n\n        await emitAndWaitForEvent<'resume_consumer', 'consumer_resumed'>(\n          socket,\n          'resume_consumer',\n          { callId, consumerId: consumer.id },\n          {\n            event: 'consumer_resumed',\n            timeoutMs: CONSUMER_RESUMED_TIMEOUT_MS,\n            registry: waitRegistryRef.current,\n            filter: (eventPayload) =>\n              eventPayload.callId === callId && eventPayload.consumerId === consumer.id,\n          },\n        )\n        assertCallSetupCurrent(setupToken, callId)\n\n        handledRemoteProducerIdsRef.current.add(payload.producerId)\n        queuedRemoteProducerMapRef.current.delete(payload.producerId)\n\n        if (payload.kind === 'video') {\n          useCallStore.getState().patch({ remoteVideoState: 'connected' })\n          return\n        }\n\n        scheduleRtcStatsLog({\n          callId,\n          label: 'Remote consumer',\n          mediaId: consumer.id,\n          getStats: () => consumer.getStats(),\n        })\n        const wasWaitingForPeerAudio = reconnectModeRef.current === 'peer'\n        reconnectModeRef.current = null\n        clearReconnectTimeout()\n        clearRemoteAudioFallback()\n        useCallStore.getState().patch({\n          ...(wasWaitingForPeerAudio ? { phase: 'active', reconnectDeadlineMs: null } : {}),\n          remoteAudioState: 'connected',\n        })\n        if (firstRemoteAudio) {\n          telemetrySessionRef.current?.record('remote_consumer_resumed', { outcome: 'succeeded' })\n          void sampleRtcQuality()\n          clearAudioFlowConfirmation()\n          audioFlowConfirmationTimeoutRef.current = setTimeout(() => {\n            audioFlowConfirmationTimeoutRef.current = null\n            void sampleRtcQuality()\n          }, AUDIO_FLOW_CONFIRMATION_DELAY_MS)\n        }\n        if (wasWaitingForPeerAudio) startTimer(useCallStore.getState().durationSec)\n      } catch (error) {\n        if (!isCallSetupCurrent(setupToken, callId)) {\n          if (options?.propagateFailure) throw new Error(CALL_SETUP_CANCELLED_ERROR)\n          return\n        }\n\n        if (reconnectModeRef.current) {\n          queuedRemoteProducerMapRef.current.set(payload.producerId, payload)\n          useCallStore.getState().patch(\n            payload.kind === 'audio' ? { remoteAudioState: 'waiting' } : { remoteVideoState: 'waiting' },\n          )\n          if (!retryingProducerIdsRef.current.has(payload.producerId)) {\n            retryingProducerIdsRef.current.add(payload.producerId)\n            setTimeout(() => {\n              retryingProducerIdsRef.current.delete(payload.producerId)\n              const queuedPayload = queuedRemoteProducerMapRef.current.get(payload.producerId)\n              if (queuedPayload && reconnectModeRef.current) void consumeRemoteProducer(queuedPayload)\n            }, 750)\n          }\n          return\n        }\n\n        if (options?.propagateFailure) throw error\n        if (payload.kind === 'video') {\n          useCallStore.getState().patch({ remoteVideoState: 'waiting' })\n          return\n        }\n        await teardownOnce('consume_remote_producer', { errorMessage: 'Unable to set up the call' })\n      } finally {\n        consumingProducerIdsRef.current.delete(payload.producerId)\n      }\n    },\n    [\n      assertCallSetupCurrent,\n      clearAudioFlowConfirmation,\n      clearReconnectTimeout,\n      clearRemoteAudioFallback,\n      currentUserId,\n      getCurrentCallId,\n      isCallSetupCurrent,\n      sampleRtcQuality,\n      scheduleRtcStatsLog,\n      startTimer,\n      teardownOnce,\n    ],\n  )\n\n`
  provider = replaceBetween(
    provider,
    '  const consumeRemoteProducer = useCallback(',
    '  const flushQueuedRemoteProducers = useCallback(',
    consumeBlock,
    'consume remote producer',
  )

  const postAnswerBlock = `  const postAnswerSetup = useCallback(\n    async (\n      payload: CallJoinedPayload | CallRejoinedPayload,\n      options: { resumeDurationSec?: number; setupToken: number },\n    ) => {\n      const socket = socketRef.current\n      if (!socket) throw new Error('Call socket is not connected')\n\n      const callId = payload.callId\n      const callType = payload.session.callType\n      const telemetry = telemetrySessionRef.current\n      assertCallSetupCurrent(options.setupToken, callId)\n      const device = await ensureDeviceLoaded(payload)\n      telemetry?.record('device_loaded', { outcome: 'succeeded' })\n      assertCallSetupCurrent(options.setupToken, callId)\n\n      stopRingingPreview()\n      const stateBeforeMedia = useCallStore.getState()\n      const [recvTransportResult, sendTransportResult, localStreamResult] = await Promise.allSettled([\n        createTransport(socket, callId, 'recv', device),\n        createTransport(socket, callId, 'send', device),\n        mediaDevices.getUserMedia({\n          audio: true,\n          video: callType === 'VIDEO' ? cameraConstraints(stateBeforeMedia.cameraFacing) : false,\n        }),\n      ])\n\n      if (\n        recvTransportResult.status !== 'fulfilled' ||\n        sendTransportResult.status !== 'fulfilled' ||\n        localStreamResult.status !== 'fulfilled'\n      ) {\n        if (recvTransportResult.status === 'fulfilled') recvTransportResult.value.close()\n        if (sendTransportResult.status === 'fulfilled') sendTransportResult.value.close()\n        if (localStreamResult.status === 'fulfilled') {\n          localStreamResult.value.getTracks().forEach((track) => track.stop())\n        }\n        const failedResult = [recvTransportResult, sendTransportResult, localStreamResult].find(\n          (result) => result.status === 'rejected',\n        )\n        throw failedResult && failedResult.status === 'rejected'\n          ? failedResult.reason\n          : new Error('Unable to initialize call media')\n      }\n\n      const recvTransport = recvTransportResult.value\n      const sendTransport = sendTransportResult.value\n      const localStream = localStreamResult.value\n      telemetry?.record('recv_transport_created', { outcome: 'succeeded' })\n      telemetry?.record('send_transport_created', { outcome: 'succeeded' })\n      if (!isCallSetupCurrent(options.setupToken, callId)) {\n        recvTransport.close()\n        sendTransport.close()\n        localStream.getTracks().forEach((track) => track.stop())\n        throw new Error(CALL_SETUP_CANCELLED_ERROR)\n      }\n\n      recvTransportRef.current = recvTransport\n      sendTransportRef.current = sendTransport\n      localStreamRef.current = localStream\n      const localAudioTrack = localStream.getAudioTracks()[0]\n      const localVideoTrack = localStream.getVideoTracks()[0]\n      if (!localAudioTrack) throw new Error('No local audio track available')\n      if (callType === 'VIDEO' && !localVideoTrack) throw new Error('No local video track available')\n\n      const muted = useCallStore.getState().muted\n      localAudioTrack.enabled = !muted\n      if (localVideoTrack) localVideoTrack.enabled = true\n      telemetry?.record('microphone_ready', { outcome: 'succeeded' })\n\n      if (!device.canProduce('audio')) throw new Error('Device cannot produce audio')\n      const audioProducer = await sendTransport.produce({\n        track: localAudioTrack as never,\n        codecOptions: VOICE_OPUS_CODEC_OPTIONS,\n        stopTracks: false,\n      })\n      if (!isCallSetupCurrent(options.setupToken, callId)) {\n        audioProducer.close()\n        throw new Error(CALL_SETUP_CANCELLED_ERROR)\n      }\n      audioProducerRef.current = audioProducer\n      telemetry?.record('audio_producer_ready', { outcome: 'succeeded' })\n      scheduleRtcStatsLog({\n        callId,\n        label: 'Local producer',\n        mediaId: audioProducer.id,\n        getStats: () => audioProducer.getStats(),\n      })\n\n      if (callType === 'VIDEO' && localVideoTrack) {\n        if (!device.canProduce('video')) throw new Error('Device cannot produce video')\n        const videoProducer = await sendTransport.produce({\n          track: localVideoTrack as never,\n          stopTracks: false,\n        })\n        videoProducerRef.current = videoProducer\n        telemetry?.record('video_producer_ready', { outcome: 'succeeded' })\n      }\n\n      for (const producer of payload.activeProducers ?? []) {\n        await consumeRemoteProducer(\n          { callId, userId: producer.userId, producerId: producer.producerId, kind: producer.kind },\n          { propagateFailure: producer.kind === 'audio', setupToken: options.setupToken },\n        )\n      }\n      await flushQueuedRemoteProducers({ setupToken: options.setupToken })\n      assertCallSetupCurrent(options.setupToken, callId)\n      callAnsweredRef.current = true\n\n      const consumers = [...consumerMapRef.current.values()]\n      useCallStore.getState().patch({\n        phase: 'active',\n        callType,\n        muted,\n        cameraEnabled: callType === 'VIDEO' && Boolean(localVideoTrack),\n        localStreamUrl: localStream.toURL(),\n        remoteAudioState: consumers.some((consumer) => consumer.kind === 'audio') ? 'connected' : 'waiting',\n        remoteVideoState:\n          callType === 'VIDEO'\n            ? consumers.some((consumer) => consumer.kind === 'video')\n              ? 'connected'\n              : 'waiting'\n            : 'idle',\n        remoteStreamUrl: remoteStreamRef.current?.toURL() ?? null,\n        reconnectDeadlineMs: null,\n      })\n      startTimer(options.resumeDurationSec ?? 0)\n      armRemoteAudioFallback()\n    },\n    [\n      armRemoteAudioFallback,\n      assertCallSetupCurrent,\n      consumeRemoteProducer,\n      createTransport,\n      ensureDeviceLoaded,\n      flushQueuedRemoteProducers,\n      isCallSetupCurrent,\n      scheduleRtcStatsLog,\n      startTimer,\n      stopRingingPreview,\n    ],\n  )\n\n`
  provider = replaceBetween(
    provider,
    '  const postAnswerSetup = useCallback(',
    '  const restartConnectedTransports = useCallback(',
    postAnswerBlock,
    'post answer setup',
  )

  provider = replaceOnce(
    provider,
    "      activeCallIdRef.current = rejoined.callId\n      callAnsweredRef.current = true\n      telemetrySessionRef.current?.attachCall(rejoined.telemetryToken)",
    "      activeCallIdRef.current = rejoined.callId\n      callAnsweredRef.current = true\n      telemetrySessionRef.current?.attachCall(rejoined.telemetryToken)\n      const recoveredCallType = rejoined.session.callType\n      useCallStore.getState().patch({\n        callType: recoveredCallType,\n        remoteVideoState: recoveredCallType === 'VIDEO' ? 'waiting' : 'idle',\n      })\n      if (recoveredCallType === 'VOICE') {\n        deactivateLocalVideo()\n        clearRemoteVideoRuntime('idle')\n      }",
    'recover call type',
  )
  provider = replaceOnce(
    provider,
    "        telemetrySessionRef.current?.record('reconnect_transport_connected', {\n          outcome: 'succeeded',\n        })",
    "        for (const producer of rejoined.activeProducers ?? []) {\n          await consumeRemoteProducer({\n            callId: rejoined.callId,\n            userId: producer.userId,\n            producerId: producer.producerId,\n            kind: producer.kind,\n          })\n        }\n        if (\n          recoveredCallType === 'VIDEO' &&\n          useCallStore.getState().hasCameraPermission === true &&\n          !videoProducerRef.current\n        ) {\n          await activateLocalVideo({ requestPermission: false })\n        }\n        telemetrySessionRef.current?.record('reconnect_transport_connected', {\n          outcome: 'succeeded',\n        })",
    'recover active video producers',
  )
  provider = replaceOnce(
    provider,
    "    postAnswerSetup,\n    restartConnectedTransports,",
    "    postAnswerSetup,\n    restartConnectedTransports,\n    activateLocalVideo,\n    clearRemoteVideoRuntime,\n    consumeRemoteProducer,\n    deactivateLocalVideo,",
    'recover dependencies',
  )

  provider = replaceOnce(
    provider,
    "      if (payload.callType === 'VIDEO') {\n        socketRef.current?.emit('reject_call', {\n          callId: payload.callId,\n          reason: 'unsupported_video',\n        })\n        presentError('Video calls are not supported yet')\n        return\n      }\n\n",
    '',
    'allow incoming video',
  )
  provider = replaceOnce(
    provider,
    "        callType: payload.callType,\n        muted: false,\n        remoteAudioState: 'idle',\n        remoteStreamUrl: null,",
    "        callType: payload.callType,\n        muted: false,\n        cameraEnabled: false,\n        cameraFacing: 'user',\n        remoteAudioState: 'idle',\n        remoteVideoState: payload.callType === 'VIDEO' ? 'waiting' : 'idle',\n        localStreamUrl: null,\n        remoteStreamUrl: null,",
    'incoming video state',
  )
  provider = replaceOnce(
    provider,
    "        callType: callState.callType,\n        muted: false,\n        remoteAudioState: 'idle',\n        remoteStreamUrl: null,",
    "        callType: callState.callType,\n        muted: false,\n        cameraEnabled: false,\n        cameraFacing: 'user',\n        remoteAudioState: 'idle',\n        remoteVideoState: callState.callType === 'VIDEO' ? 'waiting' : 'idle',\n        localStreamUrl: null,\n        remoteStreamUrl: null,",
    'recovered incoming video state',
  )

  provider = replaceOnce(
    provider,
    "      telemetry.record('microphone_permission', { outcome: 'succeeded' })\n\n      let joinedCall = false",
    "      telemetry.record('microphone_permission', { outcome: 'succeeded' })\n\n      if (state.callType === 'VIDEO') {\n        let cameraGranted = false\n        try {\n          cameraGranted = await ensureCameraPermission()\n        } catch (error) {\n          telemetry.record('camera_permission', { outcome: 'failed', error })\n        }\n        if (!cameraGranted) {\n          socket.emit('reject_call', { callId, reason: 'camera_permission_denied' })\n          await teardownOnce('accept_video_call_camera_permission_denied', {\n            errorMessage: 'Velora needs camera access for video calls',\n          })\n          return\n        }\n        telemetry.record('camera_permission', { outcome: 'succeeded' })\n      }\n\n      let joinedCall = false",
    'incoming camera permission',
  )
  provider = replaceOnce(
    provider,
    "          phase: 'connecting',\n          remoteAudioState: 'idle',\n          remoteStreamUrl: null,",
    "          phase: 'connecting',\n          remoteAudioState: 'idle',\n          remoteVideoState: state.callType === 'VIDEO' ? 'waiting' : 'idle',\n          localStreamUrl: null,\n          remoteStreamUrl: null,",
    'accept connecting video state',
  )
  provider = replaceOnce(
    provider,
    "      ensureMicPermission,\n      ensureCallSocketConnected,",
    "      ensureMicPermission,\n      ensureCameraPermission,\n      ensureCallSocketConnected,",
    'accept camera dependency',
  )

  const startCallBlock = `  const startCall = useCallback(\n    async (input: StartCallInput, callType: CallType) => {\n      if (!currentUserId || isBusyPhase(useCallStore.getState().phase)) return\n\n      const telemetry = new CallTelemetrySession('outgoing')\n      telemetrySessionRef.current = telemetry\n      telemetry.record('call_attempt', { outcome: 'started' })\n\n      try {\n        const micGranted = await ensureMicPermission()\n        if (!micGranted) throw new Error('microphone permission denied')\n        telemetry.record('microphone_permission', { outcome: 'succeeded' })\n\n        if (callType === 'VIDEO') {\n          const cameraGranted = await ensureCameraPermission()\n          if (!cameraGranted) throw new Error('camera permission denied')\n          telemetry.record('camera_permission', { outcome: 'succeeded' })\n\n          const preview = await mediaDevices.getUserMedia({\n            audio: false,\n            video: cameraConstraints('user'),\n          })\n          const previewTrack = preview.getVideoTracks()[0]\n          if (!previewTrack) {\n            preview.getTracks().forEach((track) => track.stop())\n            throw new Error('camera preview unavailable')\n          }\n          ringingPreviewStreamRef.current = preview\n          useCallStore.getState().patch({\n            cameraEnabled: true,\n            cameraFacing: 'user',\n            hasCameraPermission: true,\n            localStreamUrl: preview.toURL(),\n          })\n        }\n\n        const socket = await ensureSocketConnected()\n        telemetry.record('socket_connected', { outcome: 'succeeded' })\n        const joined = await emitAndWaitForEvent<'initiate_call', 'call_joined'>(\n          socket,\n          'initiate_call',\n          { conversationId: input.conversationId, targetUserId: input.peerUserId, callType },\n          {\n            event: 'call_joined',\n            timeoutMs: CALL_JOINED_TIMEOUT_MS,\n            registry: waitRegistryRef.current,\n            filter: (payload) => payload.session.conversationId === input.conversationId,\n          },\n        )\n\n        activeCallIdRef.current = joined.callId\n        telemetry.attachCall(joined.telemetryToken)\n        telemetry.record('call_joined', { outcome: 'succeeded' })\n        callAnsweredRef.current = false\n        void veloraSystemCalls.registerOutgoingCall({\n          callId: joined.callId,\n          conversationId: input.conversationId,\n          peerName: input.peerName ?? 'Unknown',\n          callType,\n        })\n        useCallStore.getState().patch({\n          phase: 'outgoing_ringing',\n          direction: 'outgoing',\n          callId: joined.callId,\n          conversationId: input.conversationId,\n          peerUserId: input.peerUserId,\n          peerName: input.peerName ?? 'Unknown',\n          peerAvatarUrl: input.peerAvatarUrl ?? null,\n          callType,\n          muted: false,\n          cameraEnabled: callType === 'VIDEO',\n          remoteAudioState: 'idle',\n          remoteVideoState: callType === 'VIDEO' ? 'waiting' : 'idle',\n          localStreamUrl:\n            callType === 'VIDEO' ? ringingPreviewStreamRef.current?.toURL() ?? null : null,\n          remoteStreamUrl: null,\n          reconnectDeadlineMs: null,\n          error: null,\n          durationSec: 0,\n        })\n        router.push(\`/call/\${joined.callId}\` as never)\n\n        const answerWaitRegistry: CallWaitRegistry = new Set()\n        const answerWaitTimeoutMs = getOutgoingRingWaitTimeoutMs(joined.noAnswerTimeoutMs)\n        let answerOutcome: 'answered' | 'ended' | 'rejected'\n        try {\n          answerOutcome = await Promise.race([\n            waitForEventWhere(socket, 'call_answered', {\n              timeoutMs: answerWaitTimeoutMs,\n              registry: answerWaitRegistry,\n              filter: (payload: CallAnsweredPayload) => payload.callId === joined.callId,\n            }).then(() => 'answered' as const),\n            waitForEventWhere(socket, 'call_ended', {\n              timeoutMs: answerWaitTimeoutMs,\n              registry: answerWaitRegistry,\n              filter: (payload) => payload.callId === joined.callId,\n            }).then(() => 'ended' as const),\n            waitForEventWhere(socket, 'call_rejected', {\n              timeoutMs: answerWaitTimeoutMs,\n              registry: answerWaitRegistry,\n              filter: (payload) => payload.callId === joined.callId,\n            }).then(() => 'rejected' as const),\n          ])\n        } finally {\n          clearWaitRegistry(answerWaitRegistry)\n        }\n        if (answerOutcome !== 'answered') return\n\n        callAnsweredRef.current = true\n        const setupToken = beginCallSetup()\n        useCallStore.getState().patch({ phase: 'connecting', reconnectDeadlineMs: null })\n        stopRingingPreview()\n\n        const audioSessionConfiguration = await waitForConfiguredAudioSession(setupToken, joined.callId)\n        assertCallSetupCurrent(setupToken, joined.callId)\n        const audioRoute = toAudioRouteTelemetry(audioSessionConfiguration)\n        telemetry.record('native_audio_configured', {\n          outcome: 'succeeded',\n          ...(audioRoute ? { details: { audioRoute } } : {}),\n        })\n\n        await postAnswerSetup(joined, { setupToken })\n        assertCallSetupCurrent(setupToken, joined.callId)\n        if (!veloraSystemCalls.setCallActive(joined.callId)) {\n          throw new Error('Native call is no longer active')\n        }\n        telemetry.record('control_plane_active', { outcome: 'succeeded' })\n      } catch (error) {\n        if (isCallSetupCancelledError(error)) return\n        stopRingingPreview()\n        const activeCallId = activeCallIdRef.current\n        if (socketRef.current?.connected && activeCallId) {\n          socketRef.current.emit('leave_call', { callId: activeCallId, reason: 'timeout' })\n        }\n        telemetry.record('setup_failed', { outcome: 'failed', error })\n        if (!activeCallId) {\n          telemetry.terminal('start_call_failed', error)\n          telemetrySessionRef.current = null\n          useCallStore.getState().patch({ phase: 'idle' })\n          presentError(\n            error instanceof Error && /camera/i.test(error.message)\n              ? 'Velora needs camera access for video calls'\n              : 'Velora needs microphone access to place calls',\n          )\n          return\n        }\n        await teardownOnce('start_call_failed', { errorMessage: 'Unable to set up the call' })\n      }\n    },\n    [\n      assertCallSetupCurrent,\n      beginCallSetup,\n      currentUserId,\n      ensureCameraPermission,\n      ensureMicPermission,\n      ensureSocketConnected,\n      postAnswerSetup,\n      presentError,\n      router,\n      stopRingingPreview,\n      teardownOnce,\n      waitForConfiguredAudioSession,\n    ],\n  )\n\n  const startVoiceCall = useCallback(\n    (input: StartCallInput) => startCall(input, 'VOICE'),\n    [startCall],\n  )\n  const startVideoCall = useCallback(\n    (input: StartCallInput) => startCall(input, 'VIDEO'),\n    [startCall],\n  )\n\n`
  provider = replaceBetween(
    provider,
    '  const startVoiceCall = useCallback(',
    '  const processNativeCallAction = useCallback(',
    startCallBlock,
    'generalized outgoing call',
  )

  provider = replaceOnce(
    provider,
    "        if (callState.callType === 'VIDEO') {\n          veloraSystemCalls.dismissIncomingCall(action.callId)\n          completeNativeCallAction(action.actionId)\n          return\n        }\n\n",
    '',
    'native video recovery',
  )

  const controlsBlock = `  const toggleMute = useCallback(() => {\n    const localAudioTrack = localStreamRef.current?.getAudioTracks()[0]\n    if (!localAudioTrack) return\n    const nextMuted = !useCallStore.getState().muted\n    localAudioTrack.enabled = !nextMuted\n    useCallStore.getState().patch({ muted: nextMuted })\n  }, [])\n\n  const toggleSpeaker = useCallback(() => {\n    const state = useCallStore.getState()\n    if (state.phase !== 'active') return\n    const nextSpeakerEnabled = !state.speakerEnabled\n    if (!veloraSystemCalls.setSpeakerEnabled(nextSpeakerEnabled)) {\n      console.warn('[Call] Failed to change speaker route')\n      return\n    }\n    state.patch({ speakerEnabled: nextSpeakerEnabled })\n  }, [])\n\n  const toggleCamera = useCallback(async () => {\n    const state = useCallStore.getState()\n    if (state.phase !== 'active' || state.callType !== 'VIDEO') return\n    if (!state.cameraEnabled) {\n      await activateLocalVideo()\n      return\n    }\n    const track = localStreamRef.current?.getVideoTracks()[0]\n    if (track) track.enabled = false\n    useCallStore.getState().patch({ cameraEnabled: false })\n  }, [activateLocalVideo])\n\n  const switchCamera = useCallback(async () => {\n    const state = useCallStore.getState()\n    if (state.phase !== 'active' || state.callType !== 'VIDEO' || !state.cameraEnabled) return\n    const track = localStreamRef.current?.getVideoTracks()[0] as\n      | (MediaStreamTrack & { _switchCamera?: () => void })\n      | undefined\n    if (!track?._switchCamera) return\n    track._switchCamera()\n    useCallStore.getState().patch({\n      cameraFacing: state.cameraFacing === 'user' ? 'environment' : 'user',\n    })\n  }, [])\n\n  const switchCallType = useCallback(\n    async (nextCallType: CallType) => {\n      const state = useCallStore.getState()\n      const socket = socketRef.current\n      if (state.phase !== 'active' || !state.callId || !socket?.connected) return\n      if (state.callType === nextCallType) return\n\n      if (nextCallType === 'VIDEO') {\n        const granted = await ensureCameraPermission()\n        if (!granted) {\n          presentError('Velora needs camera access for video calls')\n          return\n        }\n      }\n\n      await emitAndWaitForEvent(\n        socket,\n        'set_call_type',\n        { callId: state.callId, callType: nextCallType },\n        {\n          event: 'call_type_changed',\n          timeoutMs: CALL_JOINED_TIMEOUT_MS,\n          registry: waitRegistryRef.current,\n          filter: (payload: CallTypeChangedPayload) =>\n            payload.callId === state.callId && payload.callType === nextCallType,\n        },\n      )\n\n      useCallStore.getState().patch({\n        callType: nextCallType,\n        remoteVideoState: nextCallType === 'VIDEO' ? 'waiting' : 'idle',\n      })\n      if (nextCallType === 'VIDEO') {\n        await activateLocalVideo({ requestPermission: false })\n      } else {\n        deactivateLocalVideo()\n        clearRemoteVideoRuntime('idle')\n      }\n    },\n    [activateLocalVideo, clearRemoteVideoRuntime, deactivateLocalVideo, ensureCameraPermission, presentError],\n  )\n\n`
  provider = replaceBetween(
    provider,
    '  const toggleMute = useCallback(',
    '  const dismissCallError = useCallback(',
    controlsBlock,
    'call controls',
  )

  provider = replaceOnce(
    provider,
    "    const subscription = AppState.addEventListener('change', (nextState) => {\n      if (nextState !== 'active') {\n        return\n      }",
    "    const subscription = AppState.addEventListener('change', (nextState) => {\n      const previousState = lastAppStateRef.current\n      lastAppStateRef.current = nextState\n      const callState = useCallStore.getState()\n      const localVideoTrack =\n        localStreamRef.current?.getVideoTracks()[0] ??\n        ringingPreviewStreamRef.current?.getVideoTracks()[0]\n\n      if (nextState !== 'active') {\n        if (\n          (nextState === 'background' || nextState === 'inactive') &&\n          callState.callType === 'VIDEO' &&\n          callState.cameraEnabled &&\n          localVideoTrack\n        ) {\n          localVideoTrack.enabled = false\n          cameraPausedByBackgroundRef.current = true\n        }\n        return\n      }\n\n      if (\n        previousState !== 'active' &&\n        cameraPausedByBackgroundRef.current &&\n        callState.callType === 'VIDEO' &&\n        callState.cameraEnabled &&\n        localVideoTrack\n      ) {\n        localVideoTrack.enabled = true\n        cameraPausedByBackgroundRef.current = false\n      }",
    'background camera pause',
  )

  const socketHandlers = `    const handleProducerClosed = (payload: ProducerClosedPayload) => {\n      if (!isCurrentCall(payload.callId)) return\n      const remoteStream = remoteStreamRef.current\n      const entry = [...consumerMapRef.current.entries()].find(\n        ([, consumer]) => consumer.producerId === payload.producerId,\n      )\n      if (!entry) {\n        if (payload.kind === 'video') useCallStore.getState().patch({ remoteVideoState: 'off' })\n        return\n      }\n      const [consumerId, consumer] = entry\n      try { remoteStream?.removeTrack(consumer.track as unknown as MediaStreamTrack) } catch {}\n      try { consumer.close() } catch {}\n      consumerMapRef.current.delete(consumerId)\n      handledRemoteProducerIdsRef.current.delete(payload.producerId)\n      useCallStore.getState().patch({\n        remoteStreamUrl: remoteStream?.toURL() ?? null,\n        ...(payload.kind === 'video' ? { remoteVideoState: 'off' as const } : {}),\n      })\n    }\n\n    const handleCallTypeChanged = (payload: CallTypeChangedPayload) => {\n      if (!isCurrentCall(payload.callId)) return\n      const previousType = useCallStore.getState().callType\n      useCallStore.getState().patch({\n        callType: payload.callType,\n        remoteVideoState: payload.callType === 'VIDEO' ? 'waiting' : 'idle',\n      })\n      if (payload.callType === 'VOICE') {\n        deactivateLocalVideo()\n        clearRemoteVideoRuntime('idle')\n        return\n      }\n      if (\n        previousType !== 'VIDEO' &&\n        payload.changedByUserId !== currentUserId &&\n        useCallStore.getState().hasCameraPermission === true\n      ) {\n        void activateLocalVideo({ requestPermission: false })\n      }\n    }\n\n`
  provider = replaceOnce(
    provider,
    "    const handlePeerLeft = (payload: PeerLeftPayload) => {",
    socketHandlers + "    const handlePeerLeft = (payload: PeerLeftPayload) => {",
    'video socket handlers',
  )
  provider = replaceOnce(
    provider,
    "    socket.on('new_producer', (payload) => {\n      void consumeRemoteProducer(payload)\n    })",
    "    socket.on('new_producer', (payload) => {\n      void consumeRemoteProducer(payload)\n    })\n    socket.on('producer_closed', handleProducerClosed)\n    socket.on('call_type_changed', handleCallTypeChanged)",
    'video socket listeners',
  )
  provider = replaceOnce(
    provider,
    "      socket.off('incoming_call')\n      socket.off('new_producer')\n      socket.off('call_answered')",
    "      socket.off('incoming_call')\n      socket.off('new_producer')\n      socket.off('producer_closed', handleProducerClosed)\n      socket.off('call_type_changed', handleCallTypeChanged)\n      socket.off('call_answered')",
    'video socket cleanup',
  )
  provider = replaceOnce(
    provider,
    "    consumeRemoteProducer,\n    currentUserId,\n    beginReconnectRecovery,",
    "    consumeRemoteProducer,\n    currentUserId,\n    activateLocalVideo,\n    clearRemoteVideoRuntime,\n    deactivateLocalVideo,\n    beginReconnectRecovery,",
    'socket effect video deps',
  )

  provider = replaceOnce(
    provider,
    "    () => ({\n      startVoiceCall,\n      acceptIncomingCall,\n      rejectIncomingCall,\n      endCall,\n      toggleMute,\n      toggleSpeaker,\n      dismissCallError,\n    }),",
    "    () => ({\n      startVoiceCall,\n      startVideoCall,\n      acceptIncomingCall,\n      rejectIncomingCall,\n      endCall,\n      toggleMute,\n      toggleSpeaker,\n      toggleCamera,\n      switchCamera,\n      switchCallType,\n      dismissCallError,\n    }),",
    'provider value',
  )
  provider = replaceOnce(
    provider,
    "      rejectIncomingCall,\n      startVoiceCall,\n      toggleMute,\n      toggleSpeaker,",
    "      rejectIncomingCall,\n      startVoiceCall,\n      startVideoCall,\n      toggleMute,\n      toggleSpeaker,\n      toggleCamera,\n      switchCamera,\n      switchCallType,",
    'provider value deps',
  )

  fs.writeFileSync(providerPath, provider)
}

let conversation = fs.readFileSync(conversationPath, 'utf8')
if (!conversation.includes('// VIDEO_CALL_1TO1_CONVERSATION_PATCH')) {
  conversation = replaceOnce(
    conversation,
    "  const { user } = useAuthStore()\n  const { startVoiceCall } = useCall()",
    "  const { user } = useAuthStore()\n  // VIDEO_CALL_1TO1_CONVERSATION_PATCH\n  const { startVideoCall, startVoiceCall } = useCall()",
    'conversation call hooks',
  )
  conversation = replaceOnce(
    conversation,
    "  const handleStartVoiceCall = useCallback(() => {\n    if (!otherUserId || currentConversation?.isGroup) {\n      return\n    }\n\n    void startVoiceCall({\n      conversationId,\n      peerUserId: otherUserId,\n      ...(displayName ? { peerName: displayName } : {}),\n      ...(avatarUrl ? { peerAvatarUrl: avatarUrl } : {}),\n    })",
    "  const handleStartVoiceCall = useCallback(() => {\n    if (!otherUserId || currentConversation?.isGroup) {\n      return\n    }\n\n    void startVoiceCall({\n      conversationId,\n      peerUserId: otherUserId,\n      ...(displayName ? { peerName: displayName } : {}),\n      ...(avatarUrl ? { peerAvatarUrl: avatarUrl } : {}),\n    })",
    'voice handler guard',
  )
  const voiceHandlerEnd = "  }, [\n    avatarUrl,\n    conversationId,\n    currentConversation?.isGroup,\n    displayName,\n    otherUserId,\n    startVoiceCall,\n  ])"
  if (!conversation.includes(voiceHandlerEnd)) throw new Error('Patch anchor not found: voice handler deps')
  conversation = conversation.replace(
    voiceHandlerEnd,
    voiceHandlerEnd + `\n\n  const handleStartVideoCall = useCallback(() => {\n    if (!otherUserId || currentConversation?.isGroup) return\n    void startVideoCall({\n      conversationId,\n      peerUserId: otherUserId,\n      ...(displayName ? { peerName: displayName } : {}),\n      ...(avatarUrl ? { peerAvatarUrl: avatarUrl } : {}),\n    })\n  }, [\n    avatarUrl,\n    conversationId,\n    currentConversation?.isGroup,\n    displayName,\n    otherUserId,\n    startVideoCall,\n  ])`,
  )
  conversation = replaceOnce(
    conversation,
    "            {!currentConversation?.isGroup && otherUserId ? (\n              <TouchableOpacity\n                onPress={handleStartVoiceCall}\n                className=\"h-11 w-11 items-center justify-center rounded-full bg-surface-input\"\n                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}\n                accessibilityRole=\"button\"\n                accessibilityLabel={`Call ${displayName}`}\n              >\n                <MaterialIcons name=\"call\" size={22} color=\"#161616\" />\n              </TouchableOpacity>\n            ) : null}",
    "            {!currentConversation?.isGroup && otherUserId ? (\n              <View className=\"flex-row gap-2\">\n                <TouchableOpacity\n                  onPress={handleStartVideoCall}\n                  className=\"h-11 w-11 items-center justify-center rounded-full bg-surface-input\"\n                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}\n                  accessibilityRole=\"button\"\n                  accessibilityLabel={`Video call ${displayName}`}\n                >\n                  <MaterialIcons name=\"videocam\" size={22} color=\"#161616\" />\n                </TouchableOpacity>\n                <TouchableOpacity\n                  onPress={handleStartVoiceCall}\n                  className=\"h-11 w-11 items-center justify-center rounded-full bg-surface-input\"\n                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}\n                  accessibilityRole=\"button\"\n                  accessibilityLabel={`Call ${displayName}`}\n                >\n                  <MaterialIcons name=\"call\" size={22} color=\"#161616\" />\n                </TouchableOpacity>\n              </View>\n            ) : null}",
    'conversation video call button',
  )
  fs.writeFileSync(conversationPath, conversation)
}

console.log('Video-call provider patch applied successfully')
