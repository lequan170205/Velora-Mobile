const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const providerSource = read('src/providers/CallProvider.tsx')

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
      'await ensureCallSocketConnected(callId)',
      'await ensureMicPermission()',
      "'join_call'",
      "'answer_call'",
      'const setupToken = beginCallSetup()',
      "phase: 'connecting'",
      'router.push(`/call/${callId}` as never)',
      'await waitForConfiguredAudioSession(setupToken, callId)',
      'await postAnswerSetup(joined, { setupToken })',
      'veloraSystemCalls.setCallActive(callId)',
    ],
    'incoming call order',
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
      "'rejoin_call'",
      'await restartConnectedTransports(socket, rejoined.callId)',
      "phase: 'active'",
      "'[Call] ICE restart failed; rebuilding media runtime'",
      'invalidateCallSetup()',
      'disposeMediaRuntime({ preserveActiveCall: true })',
      'const setupToken = beginCallSetup()',
      'await postAnswerSetup(rejoined, {',
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
      "if (action.action === 'answer')",
      'prepareIncomingCallFromState(callState)',
      "await acceptIncomingCall('native')",
      'completeNativeCallAction(action.actionId)',
    ],
    'native action order',
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
      "processPendingNativeCallAction('app_resume')",
    ],
    'video app lifecycle order',
  )
})

test('native audio waiters are cancellable resources during teardown and unmount', () => {
  const nativeAudio = read('src/lib/call/useNativeAudioSessionRuntime.ts')
  assert.match(nativeAudio, /cancelWaiter = \(\) => settle/)
  assert.match(nativeAudio, /const cancelAudioSessionWait = useCallback/)
  assert.match(nativeAudio, /const cancelAllAudioSessionWaits = useCallback/)
  assert.match(providerSource, /cancelAudioSessionWait\(endingCallId\)/)
  assert.match(providerSource, /clearWaitRegistry\(waitRegistry\)[\s\S]*cancelAllAudioSessionWaits\(\)/)
})

test('socket effect removes only provider-owned handlers and preserves event waiters', () => {
  for (const event of ['incoming_call', 'new_producer', 'call_answered']) {
    assert.doesNotMatch(providerSource, new RegExp(`socket\\.off\\('${event}'\\)`))
    assert.match(providerSource, new RegExp(`socket\\.off\\('${event}', handle`))
  }
})
