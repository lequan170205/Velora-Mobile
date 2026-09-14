const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

const loadTypeScriptModule = (file, mocks = {}) => {
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
  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    loadedModule,
    loadedModule.exports,
  )
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
}

const videoState = loadTypeScriptModule(path.join(root, 'src/lib/call/callVideoState.ts'))
const callSocket = loadTypeScriptModule(path.join(root, 'src/lib/call/callSocket.ts'), {
  'socket.io-client': { io: () => new FakeSocket() },
  '../../api/auth.api': {
    authApi: { getSocketToken: async () => ({ accessToken: 'test-token' }) },
  },
})
const callDebug = loadTypeScriptModule(path.join(root, 'src/lib/call/callDebug.ts'), {
  './callSocket': callSocket,
})
const callConstants = loadTypeScriptModule(path.join(root, 'src/lib/call/callConstants.ts'))
const callPolicies = loadTypeScriptModule(path.join(root, 'src/lib/call/callPolicies.ts'), {
  axios: { isAxiosError: () => false },
  '@tanstack/react-query': {},
  '../../constants/queryKeys': { queryKeys: {} },
  './callConstants': {
    CALL_SETUP_CANCELLED_ERROR: 'call_setup_cancelled',
    TRANSPORT_CONNECTED_TIMEOUT_MS: 10_000,
  },
  './callSocket': callSocket,
})

test('remote video aggregate stays connected while another enabled producer is usable', () => {
  const registry = new Map([
    ['producer-old', { enabled: true, revision: 3, consumerReady: true, closed: false }],
    ['producer-new', { enabled: true, revision: 1, consumerReady: false, closed: false }],
  ])

  assert.equal(
    videoState.deriveRemoteVideoStateFromRegistry({
      callType: 'VIDEO',
      snapshotReady: true,
      registry: registry.values(),
    }),
    'connected',
  )

  registry.get('producer-old').closed = true
  assert.equal(
    videoState.deriveRemoteVideoStateFromRegistry({
      callType: 'VIDEO',
      snapshotReady: true,
      registry: registry.values(),
    }),
    'waiting',
  )

  registry.get('producer-new').consumerReady = true
  assert.equal(
    videoState.deriveRemoteVideoStateFromRegistry({
      callType: 'VIDEO',
      snapshotReady: true,
      registry: registry.values(),
    }),
    'connected',
  )
})

test('remote video revisions reject late events and keep an unknown snapshot waiting', () => {
  assert.equal(videoState.shouldApplyRemoteVideoRevision(undefined, 0), true)
  assert.equal(videoState.shouldApplyRemoteVideoRevision(7, 6), false)
  assert.equal(videoState.shouldApplyRemoteVideoRevision(7, 7), true)
  assert.equal(videoState.shouldApplyRemoteVideoRevision(7, 7, true, false), false)
  assert.equal(
    videoState.deriveRemoteVideoStateFromRegistry({
      callType: 'VIDEO',
      snapshotReady: false,
      registry: [],
    }),
    'waiting',
  )
  assert.equal(
    videoState.deriveRemoteVideoStateFromRegistry({
      callType: 'VOICE',
      snapshotReady: false,
      registry: [],
    }),
    'idle',
  )
})

test('closed producer tombstones ignore delayed state and reopen only for authoritative/new producer events', () => {
  const closed = new Set()
  videoState.reconcileRemoteVideoProducerTombstones(
    closed,
    ['producer-old', 'producer-current'],
    new Set(['producer-current']),
  )
  assert.equal(videoState.isRemoteVideoProducerCurrent(closed, 'producer-old'), false)
  assert.equal(videoState.isRemoteVideoProducerCurrent(closed, 'producer-current'), true)

  closed.delete('producer-old')
  assert.equal(videoState.isRemoteVideoProducerCurrent(closed, 'producer-old'), true)
})

test('camera ACKs arriving out of order preserve the newest desired revision', () => {
  const initial = {
    desiredEnabled: true,
    confirmedEnabled: false,
    revision: 2,
    pendingActionId: 'camera-new',
  }
  const oldAck = videoState.applyLocalVideoAck(
    initial,
    {
      callId: 'call-1',
      producerId: 'producer-1',
      userId: 'user-a',
      enabled: false,
      revision: 1,
      status: 'applied',
      actionId: 'camera-old',
      requestId: 'camera-old',
    },
    'camera-old',
    1,
  )
  assert.equal(oldAck.state.revision, 2)
  assert.equal(oldAck.state.confirmedEnabled, false)
  assert.equal(oldAck.state.pendingActionId, 'camera-new')

  const newestAck = videoState.applyLocalVideoAck(
    oldAck.state,
    {
      callId: 'call-1',
      producerId: 'producer-1',
      userId: 'user-a',
      enabled: true,
      revision: 2,
      status: 'already_applied',
      actionId: 'camera-new',
      requestId: 'camera-new',
    },
    'camera-new',
    2,
  )
  assert.equal(newestAck.state.confirmedEnabled, true)
  assert.equal(newestAck.state.pendingActionId, null)
  assert.equal(newestAck.accepted, true)
})

test('camera toggle intent keeps automatic and user activation single-flight', () => {
  const base = {
    phase: 'active',
    callType: 'VIDEO',
    cameraEnabled: false,
    desiredEnabled: true,
    confirmedEnabled: false,
    hasProducer: false,
    socketConnected: true,
  }

  assert.equal(
    videoState.resolveLocalVideoToggleIntent({ ...base, activationInFlight: true }),
    'cancel_activation',
  )
  assert.equal(
    videoState.resolveLocalVideoToggleIntent({ ...base, activationInFlight: false }),
    'activate',
  )
})

test('camera intent survives a disconnected off/on cycle and retries after reconnect', () => {
  const producerState = {
    phase: 'active',
    callType: 'VIDEO',
    cameraEnabled: false,
    desiredEnabled: true,
    confirmedEnabled: false,
    hasProducer: true,
    activationInFlight: false,
  }

  assert.equal(
    videoState.resolveLocalVideoToggleIntent({ ...producerState, socketConnected: false }),
    'deactivate',
  )
  assert.equal(
    videoState.resolveLocalVideoToggleIntent({ ...producerState, socketConnected: true }),
    'activate',
  )
})

test('camera and consumer retry delays are bounded exponential backoff', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 10].map((attempt) => videoState.boundedRetryDelay(attempt, 250, 2_000)),
    [250, 500, 1_000, 2_000, 2_000],
  )
})

test('short control-plane grace keeps a brief socket pause from tearing down media', () => {
  assert.equal(callConstants.SOCKET_DISCONNECT_GRACE_MS, 20_000)
  assert.equal(callConstants.DEFAULT_RECONNECT_GRACE_MS, 15_000)
})

test('diagnostic helpers expose only short IDs and stable error codes', () => {
  assert.equal(callDebug.shortCallId('1234567890abcdef'), '12345678…def')
  assert.equal(callDebug.safeCallErrorCode(new Error('native SDK private detail')), 'unknown_error')
  assert.equal(callDebug.safeCallErrorCode(new Error('Producer not found')), 'producer_error')
})

test('terminal stale media errors are never classified as retryable', () => {
  const terminal = new callSocket.CallSocketExceptionError('Call room not found', {
    code: 'http_404',
    event: 'consume',
    callId: 'call-1',
    requestId: 'consume-1',
  })
  assert.equal(callPolicies.isTerminalRemoteMediaError(terminal), true)
  assert.equal(callPolicies.isTerminalRemoteMediaError(new Error('Timed out waiting')), false)
  assert.equal(callPolicies.isTerminalRemoteMediaError(new Error('Producer not found')), true)
})

test('exception context is attached without rejecting a waiter for another command', async () => {
  const socket = new FakeSocket()
  const registry = new Set()
  const requestIds = new Map()
  socket.onClientEmit = (event, payload) => requestIds.set(event, payload.requestId)

  const joinWait = callSocket.emitAndWaitForEvent(
    socket,
    'join_call',
    { callId: 'call-1' },
    { event: 'call_joined', timeoutMs: 100, registry },
  )
  const transportWait = callSocket.emitAndWaitForEvent(
    socket,
    'create_transport',
    { callId: 'call-1', direction: 'send' },
    { event: 'transport_created', timeoutMs: 100, registry },
  )

  socket.serverEmit('exception', {
    status: 'error',
    message: 'join rejected',
    code: 'http_409',
    event: 'join_call',
    callId: 'call-1',
    requestId: requestIds.get('join_call'),
  })
  socket.serverEmit('transport_created', {
    callId: 'call-1',
    transportId: 'transport-1',
    direction: 'send',
    requestId: requestIds.get('create_transport'),
  })

  const joinError = await joinWait.catch((error) => error)
  assert.equal(joinError.code, 'http_409')
  assert.equal(joinError.requestId, requestIds.get('join_call'))
  await assert.doesNotReject(transportWait)
  assert.equal(registry.size, 0)
})
