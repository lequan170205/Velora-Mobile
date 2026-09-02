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

test('post-answer setup guards every async boundary before publishing active state', () => {
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
      'const videoProducer = await sendTransport.produce({',
      'if (!isCallSetupCurrent(options.setupToken, callId))',
      'videoProducerRef.current = videoProducer',
      'await flushQueuedRemoteProducers({ setupToken: options.setupToken })',
      'assertCallSetupCurrent(options.setupToken, callId)',
      "phase: 'active'",
      'startTimer(options.resumeDurationSec ?? 0)',
      'armRemoteAudioFallback()',
    ],
    'post-answer setup order',
  )
  assert.match(setupSource, /stopTracks: false/)
  assert.match(setupSource, /propagateFailure: producer\.kind === 'audio'/)
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

test('incoming answer joins before answering and waits for native audio before media', () => {
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
      'if (!isCallSetupCurrent(setupToken, callId)) return',
      'await ensureCallSocketConnected(callId)',
      'assertCallSetupCurrent(setupToken, callId)',
      'await ensureMicPermission()',
      'assertCallSetupCurrent(setupToken, callId)',
      "'join_call'",
      "'answer_call'",
      "phase: 'connecting'",
      'router.push(`/call/${callId}` as never)',
      'await waitForConfiguredAudioSession(setupToken, callId)',
      'await postAnswerSetup(joined, { setupToken })',
      'veloraSystemCalls.setCallActive(callId)',
    ],
    'incoming call order',
  )
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

test('native actions are auth-gated, deduplicated and reconcile server state first', () => {
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
      'if (isLoading || !isAuthenticated || !currentUserId || !username?.trim())',
      'processingNativeActionIdsRef.current.add(action.actionId)',
      'callState = await getCallState(action.callId)',
      'const hasConflictingCall =',
      'outgoingStartInFlightRef.current',
      'activeState.callId !== action.callId',
      'if (hasConflictingCall())',
      "if (action.action === 'answer')",
      'prepareIncomingCallFromState(callState)',
      "await acceptIncomingCall('native')",
      'completeNativeCallAction(action.actionId)',
    ],
    'native action order',
  )
  assert.match(
    nativeActionSource,
    /await ensureCallSocketConnected\(action\.callId\)[\s\S]*if \(hasConflictingCall\(\)\) \{[\s\S]*completeNativeCallAction\(action\.actionId\)[\s\S]*return[\s\S]*socket\.emit\('leave_call'/,
  )
  assert.match(providerSource, /outgoingStartInFlightRef,/)
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
  const videoCanvasSource = sliceBetween(
    callScreenSource,
    '<View className="relative flex-1">',
    '<View className="z-20 px-3 pb-2">',
  )

  assert.match(
    videoCanvasSource,
    /<View key="identity" className="flex-1 items-center justify-center pb-16">/,
    'identity branch must have a stable reconciliation key',
  )
  assert.match(
    videoCanvasSource,
    /<View key="video-canvas" className="flex-1">/,
    'video branch must have a distinct reconciliation key',
  )
})
