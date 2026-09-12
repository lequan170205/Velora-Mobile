const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const providerSource = read('src/providers/CallProvider.tsx')
const callScreenSource = read('app/call/[id].tsx')

const assertOrdered = (source, markers, message) => {
  let previousIndex = -1

  for (const marker of markers) {
    const index = source.indexOf(marker, previousIndex + 1)
    assert.notEqual(index, -1, `${message}: missing ${marker}`)
    assert.ok(index > previousIndex, `${message}: ${marker} is out of order`)
    previousIndex = index
  }
}

const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const loadTypeScriptModule = (file, mocks) => {
  const source = fs.readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
  }).outputText
  const loadedModule = { exports: {} }
  const localRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
    return require(specifier)
  }
  const evaluate = new Function('require', 'module', 'exports', compiled)
  evaluate(localRequire, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

class FakeSocket {
  constructor() {
    this.listeners = new Map()
    this.emitted = []
    this.onClientEmit = null
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  off(event, listener) {
    if (!listener) {
      this.listeners.delete(event)
      return this
    }

    const listeners = this.listeners.get(event)
    listeners?.delete(listener)
    if (listeners?.size === 0) this.listeners.delete(event)
    return this
  }

  emit(event, payload) {
    this.emitted.push({ event, payload })
    this.onClientEmit?.(event, payload)
    return this
  }

  serverEmit(event, payload) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload)
  }

  listenerCount(event) {
    return this.listeners.get(event)?.size ?? 0
  }
}

const callSocketModule = loadTypeScriptModule(path.join(root, 'src/lib/call/callSocket.ts'), {
  'socket.io-client': { io: () => new FakeSocket() },
  '../../api/auth.api': {
    authApi: { getSocketToken: async () => ({ accessToken: 'test-token' }) },
  },
})

const callPoliciesModule = loadTypeScriptModule(path.join(root, 'src/lib/call/callPolicies.ts'), {
  axios: { isAxiosError: () => false },
  '@tanstack/react-query': {},
  '../../constants/queryKeys': { queryKeys: {} },
  './callConstants': {
    CALL_SETUP_CANCELLED_ERROR: 'call_setup_cancelled',
    TRANSPORT_CONNECTED_TIMEOUT_MS: 10_000,
  },
  './callSocket': callSocketModule,
})

test('emitAndWaitForEvent subscribes before emit and supports synchronous acknowledgements', async () => {
  const socket = new FakeSocket()
  const registry = new Set()
  socket.onClientEmit = (event, payload) => {
    assert.equal(event, 'join_call')
    socket.serverEmit('call_joined', { callId: payload.callId })
  }

  const result = await callSocketModule.emitAndWaitForEvent(
    socket,
    'join_call',
    { callId: 'call-1' },
    {
      event: 'call_joined',
      timeoutMs: 50,
      registry,
      filter: (payload) => payload.callId === 'call-1',
    },
  )

  assert.equal(result.callId, 'call-1')
  assert.equal(socket.listenerCount('call_joined'), 0)
  assert.equal(socket.listenerCount('exception'), 0)
  assert.equal(registry.size, 0)
})

test('a cleared prewarm cannot repopulate a socket credential after logout', async () => {
  let requestCount = 0
  let resolveFirstRequest
  const firstRequest = new Promise((resolve) => {
    resolveFirstRequest = resolve
  })
  const scopedCallSocketModule = loadTypeScriptModule(path.join(root, 'src/lib/call/callSocket.ts'), {
    'socket.io-client': { io: () => new FakeSocket() },
    '../../api/auth.api': {
      authApi: {
        getSocketToken: () => {
          requestCount += 1
          if (requestCount === 1) return firstRequest
          return Promise.resolve({ accessToken: 'fresh-session-token' })
        },
      },
    },
  })

  const stalePrewarm = scopedCallSocketModule.prewarmCallSocketCredentials('user-a')
  scopedCallSocketModule.clearPrewarmedCallSocketCredentials('user-a')
  resolveFirstRequest({ accessToken: 'stale-session-token' })
  await stalePrewarm

  const socket = new FakeSocket()
  await scopedCallSocketModule.authenticateCallSocket(socket, 'user-a')

  assert.equal(requestCount, 2)
  assert.deepEqual(socket.auth, { token: 'fresh-session-token' })
})

test('waitForEventWhere ignores another call and clearWaitRegistry removes pending listeners', async () => {
  const socket = new FakeSocket()
  const registry = new Set()
  let resolved = false
  const waiter = callSocketModule.waitForEventWhere(socket, 'call_ended', {
    timeoutMs: 1_000,
    registry,
    filter: (payload) => payload.callId === 'call-1',
  })
  void waiter.then(
    () => {
      resolved = true
    },
    () => undefined,
  )

  socket.serverEmit('call_ended', { callId: 'call-2', reason: 'ended' })
  await Promise.resolve()
  assert.equal(resolved, false)
  assert.equal(socket.listenerCount('call_ended'), 1)

  callSocketModule.clearWaitRegistry(registry)
  await assert.rejects(waiter, (error) => callSocketModule.isCallWaitCancelledError(error))
  assert.equal(socket.listenerCount('call_ended'), 0)
  assert.equal(registry.size, 0)
})

test('teardown cancellation is classified as expected setup cancellation', async () => {
  const socket = new FakeSocket()
  const registry = new Set()
  const waiter = callSocketModule.waitForEventWhere(socket, 'call_joined', {
    timeoutMs: 1_000,
    registry,
  })

  callSocketModule.clearWaitRegistry(registry)
  const cancellation = await waiter.catch((error) => error)

  assert.equal(callPoliciesModule.isCallSetupCancelledError(cancellation), true)
})

test('an End during a native accept terminalizes both sides of the accept race', () => {
  const acceptSource = sliceBetween(
    providerSource,
    "let acceptance: IncomingCallAcceptancePayload | null = null",
    'joinedCall = true',
  )
  const endSource = sliceBetween(
    providerSource,
    'const endCall = useCallback(',
    'const recordCallScreenVisible = useCallback(',
  )
  const terminalIntentSource = sliceBetween(
    providerSource,
    'const emitIncomingAcceptTerminalIntent = useCallback(',
    'const endCall = useCallback(',
  )

  assert.match(
    acceptSource,
    /acceptance = await emitAndWaitForEvent<[\s\S]*?\)\s*assertCallSetupCurrent\(setupToken, callId\)\s*assertCurrentCallAccount\(\)\s*break/,
  )
  assert.match(
    endSource,
    /const wasAcceptingIncomingCall = acceptingIncomingCallIdRef\.current === callId/,
  )
  assertOrdered(
    terminalIntentSource,
    ["socket.emit('reject_call'", "socket.emit('leave_call'"],
    'incoming accept terminal intent order',
  )
  assertOrdered(
    endSource,
    [
      'const wasAcceptingIncomingCall = acceptingIncomingCallIdRef.current === callId',
      'emitIncomingAcceptTerminalIntent(connectedSocket, callId, reason)',
      "await teardownOnce('end_call')",
    ],
    'incoming accept End ordering',
  )
})

test('an accept ACK timeout aborts an uncertain server commit instead of leaving a ghost call', () => {
  const incomingSource = sliceBetween(
    providerSource,
    'const acceptIncomingCall = useCallback(',
    'const startCall = useCallback(',
  )

  assertOrdered(
    incomingSource,
    [
      'let acceptRequestSent = false',
      'acceptRequestSent = true',
      'else if (acceptRequestSent)',
      'const abortUncertainAccept = (connectedSocket: CallSocket) =>',
      'emitIncomingAcceptTerminalIntent(connectedSocket, callId, endReason)',
      'await teardownOnce(\'accept_incoming_call_failed\'',
    ],
    'uncertain accept cleanup order',
  )
  assert.match(incomingSource, /ensureCallSocketConnected\(callId\)[\s\S]*?abortUncertainAccept\(connectedSocket\)/)
})

test('the legacy answer flow is a baked rollback mode, never an automatic atomic retry fallback', () => {
  const constantsSource = read('src/lib/call/callConstants.ts')
  const incomingSource = sliceBetween(
    providerSource,
    'const acceptIncomingCall = useCallback(',
    'const startCall = useCallback(',
  )

  assert.match(constantsSource, /EXPO_PUBLIC_CALL_ATOMIC_ACCEPT_ENABLED/)
  assert.match(constantsSource, /ATOMIC_INCOMING_CALL_ACCEPT_ENABLED/)
  assertOrdered(
    incomingSource,
    [
      'if (ATOMIC_INCOMING_CALL_ACCEPT_ENABLED)',
      "'accept_incoming_call'",
      '} else {',
      "telemetry.record('legacy_accept_rollback_mode'",
      "'join_call'",
      "'answer_call'",
    ],
    'atomic accept rollback ordering',
  )
  assert.match(
    incomingSource, /'answer_call',[\s\S]*?\{ callId, actionId: incomingActionId \}/)
})

test('socket exceptions reject emit/wait operations and release every waiter resource', async () => {
  const socket = new FakeSocket()
  const registry = new Set()
  socket.onClientEmit = () => {
    socket.serverEmit('exception', { status: 'error', message: 'server rejected join' })
  }

  await assert.rejects(
    callSocketModule.emitAndWaitForEvent(
      socket,
      'join_call',
      { callId: 'call-1' },
      {
        event: 'call_joined',
        timeoutMs: 50,
        registry,
      },
    ),
    /server rejected join/,
  )
  assert.equal(socket.listenerCount('call_joined'), 0)
  assert.equal(socket.listenerCount('exception'), 0)
  assert.equal(registry.size, 0)
})

test('teardown remains single-flight and preserves cleanup ordering', () => {
  const teardownSource = sliceBetween(
    providerSource,
    'const teardownOnce = useCallback(',
    'const teardownRecoveryFailure = useCallback(',
  )

  assertOrdered(
    teardownSource,
    [
      'if (teardownInProgressRef.current)',
      'teardownInProgressRef.current = true',
      'invalidateCallSetup()',
      'clearSocketDisconnectGraceTimeout()',
      'telemetrySessionRef.current?.terminal(',
      'stopTimer()',
      'veloraSystemCalls.endCall(endingCallId)',
      'disposeMediaRuntime()',
      'useCallStore.getState().reset()',
      'teardownInProgressRef.current = false',
    ],
    'teardown order',
  )
})

test('unrecoverable media failure is reported to native call UI as failed', () => {
  const teardownSource = sliceBetween(
    providerSource,
    'const teardownOnce = useCallback(',
    'const teardownRecoveryFailure = useCallback(',
  )
  const systemCalls = read('src/lib/systemCalls/veloraSystemCalls.ts')
  const iosModule = read('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift')

  assert.match(teardownSource, /terminalLifecycleState === 'failed'/)
  assert.match(teardownSource, /veloraSystemCalls\.reportCallFailed\(endingCallId\)/)
  assert.match(systemCalls, /reportCallFailed: \(callId: string\) => Promise<CallKitTransactionResult>/)
  assert.match(systemCalls, /reportCallFailed\(callId: string\)/)
  assert.match(iosModule, /AsyncFunction\("reportCallFailed"\)/)
  assert.match(iosModule, /func reportCallFailed\(callId: String/)
  assert.match(iosModule, /reason: \.failed/)
})

test('post-answer setup makes audio usable before progressive video enrichment', () => {
  const mediaTransport = read('src/lib/call/useCallMediaTransportRuntime.ts')
  const setupSource = sliceBetween(
    mediaTransport,
    'const postAnswerSetup = useCallback(',
    'return {',
  )

  assertOrdered(
    setupSource,
    [
      'assertCallSetupCurrent(options.setupToken, callId)',
      'await ensureDeviceLoaded(payload)',
      'await Promise.allSettled([',
      'if (!isCallSetupCurrent(options.setupToken, callId))',
      "if (!localAudioTrack) throw new Error('No local audio track available')",
      'const audioProducer = await sendTransport.produce({',
      'audioProducerRef.current = audioProducer',
      'await flushQueuedRemoteProducers({ setupToken: options.setupToken })',
      "telemetry?.recordLifecycle('audio_ready'",
      "phase: 'active'",
      'startTimer(options.resumeDurationSec ?? 0)',
      'armRemoteAudioFallback()',
      'void (async () => {',
      "telemetry?.recordLifecycle('media_enhancing'",
      'const videoCapture = await mediaDevices.getUserMedia({',
      'const videoProducer = await sendTransport.produce({',
      'if (!isCallSetupCurrent(options.setupToken, callId))',
      'videoProducerRef.current = videoProducer',
      "telemetry?.record('video_producer_failed'",
      'cameraEnabled: false',
    ],
    'audio-ready then progressive video order',
  )
  assert.match(setupSource, /stopTracks: false/)
  assert.match(setupSource, /propagateFailure: producer\.kind === 'audio'/)
  assert.match(
    setupSource,
    /void \(async \(\) => \{[\s\S]*?video_producer_failed[\s\S]*?\}\)\(\)/,
    'video setup must be contained so a post-audio failure cannot reject the call setup',
  )
})

test('remote consumer setup rolls back partially published media before retrying', () => {
  const mediaTransport = read('src/lib/call/useCallMediaTransportRuntime.ts')
  const consumeSource = sliceBetween(
    mediaTransport,
    'const consumeRemoteProducer = useCallback(',
    'const flushQueuedRemoteProducers = useCallback(',
  )

  assertOrdered(
    consumeSource,
    [
      'let pendingConsumer:',
      'consumerMapRef.current.set(consumer.id, consumer)',
      "await emitAndWaitForEvent<'resume_consumer', 'consumer_resumed'>",
      'if (pendingConsumer)',
      'remoteStream?.removeTrack(consumer.track',
      'consumer.close()',
      'consumerMapRef.current.delete(consumer.id)',
      'if (reconnectModeRef.current)',
    ],
    'partial consumer rollback order',
  )
})

test('queued remote video remains optional while queued audio setup stays fatal', () => {
  const mediaTransport = read('src/lib/call/useCallMediaTransportRuntime.ts')
  const flushSource = sliceBetween(
    mediaTransport,
    'const flushQueuedRemoteProducers = useCallback(',
    'const postAnswerSetup = useCallback(',
  )

  assert.match(flushSource, /propagateFailure: payload\.kind === 'audio'/)
  assert.doesNotMatch(flushSource, /propagateFailure: true/)
})

test('outgoing ringing races answered, ended and rejected before media setup', () => {
  const outgoingSource = sliceBetween(
    providerSource,
    'const startCall = useCallback(',
    'const startVoiceCall = useCallback(',
  )

  assertOrdered(
    outgoingSource,
    [
      'await ensureMicPermission()',
      'await ensureSocketConnected()',
      "'initiate_call'",
      "phase: 'outgoing_ringing'",
      'router.push(`/call/${joined.callId}` as never)',
      'Promise.race([',
      "waitForEventWhere(socket, 'call_answered'",
      "waitForEventWhere(socket, 'call_ended'",
      "waitForEventWhere(socket, 'call_rejected'",
      "if (answerOutcome !== 'answered') return",
      "phase: 'connecting'",
      'await waitForConfiguredAudioSession(',
      'await postAnswerSetup(joined, { setupToken })',
      'veloraSystemCalls.setCallActive(joined.callId)',
    ],
    'outgoing call order',
  )
})

test('outgoing call start is single-flight and terminal teardown cancels the ring wait', () => {
  const outgoingSource = sliceBetween(
    providerSource,
    'const startCall = useCallback(',
    'const startVoiceCall = useCallback(',
  )

  assertOrdered(
    outgoingSource,
    [
      'outgoingStartInFlightRef.current',
      'outgoingStartInFlightRef.current = true',
      'const setupToken = beginCallSetup()',
      'const assertOutgoingAttemptCurrent = () =>',
      'await ensureMicPermission()',
      'assertOutgoingAttemptCurrent()',
      "'initiate_call'",
      "payload.role === 'host'",
      'payload.session.initiatorId === currentUserId',
      'const cancelAnswerWaits = () => clearWaitRegistry(answerWaitRegistry)',
      'waitRegistryRef.current.add(cancelAnswerWaits)',
      'waitRegistryRef.current.delete(cancelAnswerWaits)',
      "phase: 'connecting'",
      'await postAnswerSetup(joined, { setupToken })',
      'outgoingStartInFlightRef.current = false',
    ],
    'single-flight outgoing call order',
  )
})

test('incoming answer atomically claims the server action before native audio and media', () => {
  const incomingSource = sliceBetween(
    providerSource,
    'const acceptIncomingCall = useCallback(',
    'const startCall = useCallback(',
  )

  assertOrdered(
    incomingSource,
    [
      'acceptingIncomingCallIdRef.current = callId',
      'const setupToken = beginCallSetup()',
      'if (!isCallSetupCurrent(setupToken, callId)) {',
      'await ensureCallSocketConnected(callId)',
      'assertCallSetupCurrent(setupToken, callId)',
      'await ensureMicPermission()',
      'assertCallSetupCurrent(setupToken, callId)',
      "'accept_incoming_call'",
      "event: 'incoming_call_acceptance'",
      "phase: 'connecting'",
      'router.push(`/call/${callId}` as never)',
      'if (!completeNativeAnswer(true))',
      'await waitForConfiguredAudioSession(setupToken, callId)',
      'await postAnswerSetup(joined, { setupToken })',
      'veloraSystemCalls.setCallActive(callId)',
    ],
    'incoming call order',
  )
  assert.match(incomingSource, /INCOMING_ACCEPT_MAX_ATTEMPTS/)
  assert.match(incomingSource, /INCOMING_ACCEPT_ACK_TIMEOUT_MS/)
  assert.match(incomingSource, /server_accept_ack_retry/)
  assert.match(incomingSource, /\{ callId, actionId: incomingActionId \}/)
})

test('a crash after server acceptance resumes with rejoin instead of replaying answer', () => {
  const nativeActions = read('src/lib/call/useNativeCallActions.ts')
  const provider = read('src/providers/CallProvider.tsx')
  const recovery = read('src/lib/call/useCallRecoveryRuntime.ts')

  assert.match(nativeActions, /if \(action\.action === 'resume'\)/)
  assert.match(nativeActions, /callState\.status !== 'active'/)
  assert.match(nativeActions, /await resumeAcceptedCall\(callState\)/)
  assert.doesNotMatch(
    sliceBetween(nativeActions, "if (action.action === 'resume')", "if (action.action === 'answer')"),
    /acceptIncomingCall\('native'/,
  )
  assert.match(provider, /const resumeAcceptedCall = useCallback/)
  assert.match(provider, /reconnectModeRef\.current = 'local'/)
  assert.match(provider, /armReconnectTimeout\('native_resume_timeout'\)/)
  assert.match(provider, /await recoverActiveCall\(\)/)
  assert.match(recovery, /'rejoin_call'/)
  assert.match(recovery, /markNativeCallActive\(rejoined\.callId\)/)
})

test('a delayed incoming rejection cannot teardown a newer call', () => {
  const rejectionSource = sliceBetween(
    providerSource,
    'const rejectIncomingCall = useCallback(',
    'const endCall = useCallback(',
  )

  assertOrdered(
    rejectionSource,
    [
      'const callId = state.callId',
      'await ensureCallSocketConnected(callId)',
      "socket.emit('reject_call'",
      'veloraSystemCalls.dismissIncomingCall(callId)',
      'if (!callId || !isCurrentCall(callId)) return',
      "await teardownOnce('reject_incoming_call')",
    ],
    'incoming rejection current-call guard',
  )
})

test('local video activation is single-flight and discards stale media resources', () => {
  const localMedia = read('src/lib/call/useCallLocalMediaRuntime.ts')
  const deactivationSource = sliceBetween(
    localMedia,
    'const deactivateLocalVideo = useCallback(',
    'const activateLocalVideo = useCallback(',
  )
  const activationSource = sliceBetween(
    localMedia,
    'const activateLocalVideo = useCallback(',
    'const clearRemoteVideoRuntime = useCallback(',
  )

  assert.match(deactivationSource, /videoActivationGenerationRef\.current \+= 1/)

  assertOrdered(
    activationSource,
    [
      'const setupToken = callSetupGenerationRef.current',
      'const activationGeneration = videoActivationGenerationRef.current',
      'const existingActivation = videoActivationRef.current',
      'existingActivation?.callId === callId',
      'existingActivation.setupToken === setupToken',
      'existingActivation.generation === activationGeneration',
      'const isActivationCurrent = () =>',
      'activationGeneration === videoActivationGenerationRef.current',
      "AppState.currentState === 'active'",
      'await mediaDevices.getUserMedia({',
      'if (!isActivationCurrent()) return false',
      'if (!isActivationCurrent() || sendTransportRef.current !== sendTransport)',
      'const producer = await sendTransport.produce({',
      'producer.close()',
      'targetStream.removeTrack(track',
      'track.stop()',
      'videoProducerRef.current = producer',
      'videoActivationRef.current = activation',
      'if (videoActivationRef.current === activation)',
    ],
    'local video activation cancellation order',
  )
})

test('call type and camera facing changes publish only into their originating session', () => {
  const callTypeSource = sliceBetween(
    providerSource,
    'const switchCallType = useCallback(',
    'const dismissCallError = useCallback(',
  )
  const localMedia = read('src/lib/call/useCallLocalMediaRuntime.ts')
  const switchCameraSource = sliceBetween(
    localMedia,
    'const switchCamera = useCallback(',
    'return {',
  )

  assertOrdered(
    callTypeSource,
    [
      'const setupToken = callSetupGenerationRef.current',
      'const isCallTypeSwitchCurrent = () =>',
      'await ensureCameraPermission()',
      'if (!isCallTypeSwitchCurrent()) return',
      'await emitAndWaitForEvent(',
      "presentError('Unable to change call type')",
      'if (!isCallTypeSwitchCurrent()) return',
      'await activateLocalVideo({ requestPermission: false })',
      'if (!isCallTypeSwitchCurrent()) return',
      '.getNativeAudioSessionState()',
      'if (!isCallTypeSwitchCurrent()) return',
    ],
    'call type switch session guards',
  )

  assertOrdered(
    switchCameraSource,
    [
      'const setupToken = callSetupGenerationRef.current',
      'const isCameraSwitchCurrent = () =>',
      'await track.applyConstraints({ facingMode: nextFacing })',
      'if (!isCameraSwitchCurrent()) return',
      'useCallStore.getState().patch({ cameraFacing: nextFacing })',
      'if (!isCameraSwitchCurrent()) return',
      'try {',
      'track._switchCamera()',
      'catch',
      "presentError('Unable to switch camera')",
    ],
    'camera switch session guards',
  )
})

test('local reconnect prefers ICE restart and rebuilds media only after restart failure', () => {
  const recoveryRuntime = read('src/lib/call/useCallRecoveryRuntime.ts')
  const recoverySource = sliceBetween(
    recoveryRuntime,
    'const recoverActiveCall = useCallback(',
    'const beginReconnectRecovery = useCallback(',
  )

  assertOrdered(
    recoverySource,
    [
      'const restartSetupToken = beginCallSetup()',
      "'rejoin_call'",
      'assertCallSetupCurrent(restartSetupToken, rejoined.callId)',
      'await restartConnectedTransports(socket, rejoined.callId)',
      'assertCallSetupCurrent(restartSetupToken, rejoined.callId)',
      "propagateFailure: producer.kind === 'audio'",
      'setupToken: restartSetupToken',
      'assertCallSetupCurrent(restartSetupToken, rejoined.callId)',
      "phase: 'active'",
      'await activateLocalVideo({ requestPermission: false })',
      'assertCallSetupCurrent(restartSetupToken, rejoined.callId)',
      'clearReconnectTimeout()',
      'startTimer(useCallStore.getState().durationSec)',
      "'[Call] ICE restart failed; rebuilding media runtime'",
      'invalidateCallSetup()',
      'disposeMediaRuntime({ preserveActiveCall: true })',
      "phase: 'reconnecting'",
      "armReconnectTimeout('recover_rebuild_timeout')",
      'const setupToken = beginCallSetup()',
      'await postAnswerSetup(rejoined, {',
      'assertCallSetupCurrent(setupToken, rejoined.callId)',
      'clearReconnectTimeout()',
    ],
    'reconnect recovery order',
  )
})

test('peer reconnect disposes remote consumers without disposing local media', () => {
  const recoveryRuntime = read('src/lib/call/useCallRecoveryRuntime.ts')
  const peerRecoverySource = sliceBetween(
    recoveryRuntime,
    'const handlePeerReconnecting = useCallback(',
    'const handlePeerReconnected = useCallback(',
  )

  assert.match(peerRecoverySource, /reconnectModeRef\.current = 'peer'/)
  assert.match(peerRecoverySource, /resetRemoteConsumerRuntime\(\)/)
  assert.doesNotMatch(peerRecoverySource, /disposeMediaRuntime/)
  assert.doesNotMatch(peerRecoverySource, /deactivateLocalVideo/)
})

test('native answers are auth-gated, deduplicated and use the signed CallKit payload first', () => {
  const nativeActions = read('src/lib/call/useNativeCallActions.ts')
  const nativeActionSource = sliceBetween(
    nativeActions,
    'const processNativeCallAction = useCallback(',
    'const processPendingNativeCallAction = useCallback(',
  )

  assertOrdered(
    nativeActionSource,
    [
      'completedNativeActionIdsRef.current.has(action.actionId)',
      'processingNativeActionIdsRef.current.has(action.actionId)',
      "if (action.action === 'remote_end')",
      'if (isLoading || !isAuthenticated || !currentUserId)',
      'processingNativeActionIdsRef.current.add(action.actionId)',
      'const hasConflictingCall =',
      'outgoingStartInFlightRef.current',
      'activeState.callId !== action.callId',
      'if (hasConflictingCall())',
      "if (action.action === 'answer')",
      'prepareIncomingCallFromPayload(action)',
      "await acceptIncomingCall('native', action.actionId)",
      'completeNativeCallAction(action.actionId)',
    ],
    'native action order',
  )
  const nativeAnswerSource = sliceBetween(
    nativeActionSource,
    "if (action.action === 'answer')",
    'let callState:',
  )
  assert.doesNotMatch(nativeAnswerSource, /getCallState\(action\.callId\)/)
  assert.match(
    nativeActionSource,
    /await ensureCallSocketConnected\(action\.callId\)[\s\S]*if \(hasConflictingCall\(\)\) \{[\s\S]*completeNativeCallAction\(action\.actionId\)[\s\S]*return[\s\S]*socket\.emit\('leave_call'/,
  )
  assert.match(providerSource, /outgoingStartInFlightRef,/)
})

test('a native terminal update clears its CallKit surface before auth hydration', () => {
  const nativeActions = read('src/lib/call/useNativeCallActions.ts')
  const nativeActionSource = sliceBetween(
    nativeActions,
    'const processNativeCallAction = useCallback(',
    'const processPendingNativeCallAction = useCallback(',
  )
  const terminalIndex = nativeActionSource.indexOf("if (action.action === 'remote_end')")
  const authGateIndex = nativeActionSource.indexOf('if (isLoading || !isAuthenticated || !currentUserId)')

  assert.ok(terminalIndex >= 0, 'remote terminal action branch must exist')
  assert.ok(authGateIndex >= 0, 'native actions must retain the auth gate for non-terminal actions')
  assert.ok(
    terminalIndex < authGateIndex,
    'a remote terminal action must not wait for auth hydration',
  )
  assert.match(
    nativeActionSource.slice(terminalIndex, authGateIndex),
    /veloraSystemCalls\.dismissIncomingCall\(action\.callId\)/,
  )
})

test('journaled terminal actions cannot affect a different signed-in account', () => {
  const nativeActions = read('src/lib/call/useNativeCallActions.ts')
  const nativeActionSource = sliceBetween(
    nativeActions,
    'const processNativeCallAction = useCallback(',
    'const processPendingNativeCallAction = useCallback(',
  )
  const nativeTypes = read('src/lib/systemCalls/veloraSystemCalls.ts')

  const terminalSource = sliceBetween(
    nativeActionSource,
    "if (action.action === 'remote_end')",
    'if (isLoading || !isAuthenticated || !currentUserId)',
  )

  assert.match(terminalSource, /const belongsToCurrentAccount =/)
  assertOrdered(
    terminalSource,
    [
      'veloraSystemCalls.dismissIncomingCall(action.callId)',
      'if (belongsToCurrentAccount && isCurrentCall(action.callId))',
      "await teardownOnce('native_remote_end')",
    ],
    'native terminal account ownership before in-app teardown',
  )
  assert.match(nativeTypes, /action: 'remote_end'[\s\S]*accountId\?: string/)
})

test('an account switch during a cold-start action cannot continue with stale credentials', () => {
  const nativeActions = read('src/lib/call/useNativeCallActions.ts')
  const nativeActionSource = sliceBetween(
    nativeActions,
    'const processNativeCallAction = useCallback(',
    'const processPendingNativeCallAction = useCallback(',
  )
  const incomingAcceptSource = sliceBetween(
    providerSource,
    'const acceptIncomingCall = useCallback(',
    'const startCall = useCallback(',
  )

  assert.match(nativeActions, /import \{ useAuthStore \} from '\.\.\/\.\.\/stores\/authStore'/)
  assert.match(nativeActionSource, /const isActionAccountCurrent = \(\) =>/)
  assert.match(nativeActionSource, /const abandonActionForAccountChange = async \(\) =>/)
  assert.match(
    nativeActionSource,
    /callState = await getCallState\(action\.callId\)[\s\S]*?if \(!isActionAccountCurrent\(\)\) \{[\s\S]*?await abandonActionForAccountChange\(\)/,
  )
  assert.match(
    incomingAcceptSource,
    /socket = await ensureCallSocketConnected\(callId\)[\s\S]*?assertCurrentCallAccount\(\)/,
  )
  assert.match(
    incomingAcceptSource,
    /await waitForConfiguredAudioSession\(setupToken, callId\)[\s\S]*?assertCurrentCallAccount\(\)/,
  )
})

test('a live answer from another device ends a locally pending native answer immediately', () => {
  const callTypes = read('src/types/call.types.ts')
  const handlerSource = sliceBetween(
    providerSource,
    'const handleCallAnswered = (payload: CallAnsweredPayload) => {',
    "socket.on('connect', handleConnect)",
  )

  assert.match(callTypes, /export interface CallAnsweredPayload \{[\s\S]*answerActionId\?: string/)
  assert.match(handlerSource, /const localIncomingAction = incomingAnswerActionRef\.current/)
  assert.match(handlerSource, /acceptingIncomingCallIdRef\.current === payload\.callId/)
  assert.match(handlerSource, /localIncomingAction\.actionId !== payload\.answerActionId/)
  assert.match(
    handlerSource,
    /veloraSystemCalls\.completePendingAnswer\([\s\S]*false,[\s\S]*'answered_elsewhere'/,
  )
  assert.match(handlerSource, /teardownOnce\('answered_elsewhere'/)
})

test('a live answer on a second device dismisses an unanswered incoming surface', () => {
  const handlerSource = sliceBetween(
    providerSource,
    'const handleCallAnswered = (payload: CallAnsweredPayload) => {',
    "socket.on('connect', handleConnect)",
  )

  assert.match(handlerSource, /state\.phase === 'incoming_ringing'/)
  assert.match(handlerSource, /!acceptingIncomingCallIdRef\.current/)
  assert.match(handlerSource, /veloraSystemCalls\.dismissIncomingCall\(payload\.callId\)/)
  assert.match(handlerSource, /teardownOnce\('answered_elsewhere'/)
})

test('an authenticated account switch disposes old socket credentials and in-flight call work', () => {
  const ownershipEffect = sliceBetween(
    providerSource,
    'const previousUserId = prewarmCredentialOwnerRef.current',
    'useEffect(() => {\n    if (isLoading) {',
  )

  assertOrdered(
    ownershipEffect,
    [
      'clearPrewarmedCallSocketCredentials(previousUserId)',
      'invalidateCallSetup()',
      'clearWaitRegistry(waitRegistryRef.current)',
      'socketRef.current?.disconnect()',
      'callSocketPromisesRef.current.clear()',
      'callSocketAuthenticatedRef.current = false',
      "teardownOnce('auth_account_changed')",
    ],
    'authenticated account-switch cleanup order',
  )
})

test('background video pauses signaling intent and restores or recreates the track on resume', () => {
  const lifecycleSource = sliceBetween(
    providerSource,
    "const subscription = AppState.addEventListener('change', (nextState) => {",
    'useEffect(() => {\n    void flushCallTelemetry()',
  )

  assertOrdered(
    lifecycleSource,
    [
      "if (nextState !== 'active')",
      'localVideoTrack.enabled = false',
      'emitLocalVideoState(false)',
      'cameraPausedByBackgroundRef.current = true',
      "previousState !== 'active'",
      'localVideoTrack.enabled = true',
      'emitLocalVideoState(true)',
      'activateLocalVideo({ requestPermission: false })',
      '.catch(() =>',
      "processPendingNativeCallAction('app_resume')",
    ],
    'video app lifecycle order',
  )
})

test('camera toggle owns activation failures because the call screen discards its promise', () => {
  const localMedia = read('src/lib/call/useCallLocalMediaRuntime.ts')
  const toggleSource = sliceBetween(
    localMedia,
    'const toggleCamera = useCallback(',
    'const switchCamera = useCallback(',
  )

  assertOrdered(
    toggleSource,
    ['try {', 'await activateLocalVideo()', 'catch', "presentError('Unable to enable video')"],
    'camera toggle rejection handling',
  )
})

test('native audio waiters are cancellable resources during teardown and unmount', () => {
  const nativeAudio = read('src/lib/call/useNativeAudioSessionRuntime.ts')
  assert.match(nativeAudio, /cancelWaiter = \(\) => settle/)
  assert.match(nativeAudio, /const cancelAudioSessionWait = useCallback/)
  assert.match(nativeAudio, /const cancelAllAudioSessionWaits = useCallback/)
  assert.match(providerSource, /cancelAudioSessionWait\(endingCallId\)/)
  assert.match(
    providerSource,
    /clearWaitRegistry\(waitRegistry\)[\s\S]*cancelAllAudioSessionWaits\(\)/,
  )
})

test('provider unmount invalidates permission and media work that cannot be synchronously cancelled', () => {
  const unmountSource = sliceBetween(
    providerSource,
    'const callSocketPromises = callSocketPromisesRef.current',
    'const value = useMemo<UseCallValue>',
  )

  assertOrdered(
    unmountSource,
    [
      'return () =>',
      'invalidateCallSetup()',
      'outgoingStartInFlightRef.current = false',
      'clearWaitRegistry(waitRegistry)',
      'cancelAllAudioSessionWaits()',
    ],
    'provider unmount cancellation order',
  )
})

test('pre-active socket reconnect cannot clear timers or publish telemetry for a newer call', () => {
  const reconnectSource = sliceBetween(
    providerSource,
    'const handleDisconnect = (reason: string) =>',
    'const handleCallRejected = (payload: CallRejectedPayload) =>',
  )

  assertOrdered(
    reconnectSource,
    [
      'await restorePreActiveCallMembership(connectedSocket, disconnectedCallId)',
      'const restoredState = useCallStore.getState()',
      'restoredState.callId !== disconnectedCallId',
      'clearSocketDisconnectGraceTimeout()',
      '.catch((error) =>',
      'if (!isCurrentCall(disconnectedCallId)) return',
    ],
    'pre-active reconnect current-call guard',
  )
})

test('socket effect removes only provider-owned handlers and preserves event waiters', () => {
  for (const event of ['incoming_call', 'new_producer', 'call_answered']) {
    assert.doesNotMatch(providerSource, new RegExp(`socket\\.off\\('${event}'\\)`))
    assert.match(providerSource, new RegExp(`socket\\.off\\('${event}', handle`))
  }
})

test('video call canvas branches have isolated Fabric identities', () => {
  assert.match(
    callScreenSource,
    /<RTCView\s+key="remote-video"/,
    'remote RTC branch must have a stable reconciliation key',
  )
  assert.match(
    callScreenSource,
    /<CameraOffSurface\s+key="remote-camera-off"/,
    'remote camera-off branch must have a distinct reconciliation key',
  )
  assert.match(
    callScreenSource,
    /<RTCView\s+key="local-video"/,
    'local RTC branch must have a stable reconciliation key',
  )
  assert.match(
    callScreenSource,
    /<CameraOffSurface key="local-camera-off"/,
    'local camera-off branch must have a distinct reconciliation key',
  )
})
