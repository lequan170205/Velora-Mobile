const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

global.__DEV__ = false

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

class FakeTrack {
  constructor(kind) {
    this.kind = kind
    this.readyState = 'live'
    this.enabled = true
    this.stopCount = 0
  }

  stop() {
    this.stopCount += 1
    this.readyState = 'ended'
  }
}

let streamSequence = 0
class FakeMediaStream {
  constructor() {
    this.id = `stream-${++streamSequence}`
    this.tracks = []
  }

  addTrack(track) {
    if (!this.tracks.includes(track)) this.tracks.push(track)
  }

  removeTrack(track) {
    this.tracks = this.tracks.filter((candidate) => candidate !== track)
  }

  getTracks() {
    return [...this.tracks]
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video')
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio')
  }

  toURL() {
    return `memory://${this.id}`
  }
}

const callVideoState = loadTypeScriptModule(path.join(root, 'src/lib/call/callVideoState.ts'))
const callDebug = {
  shortCallId: (value) => value,
  safeCallErrorCode: () => 'test_error',
}

const createDeferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const createRuntime = ({
  deferredVideoCapture = null,
  deferredCameraAck = null,
  cameraAckResponder = null,
  deferredProducerClosure = null,
} = {}) => {
  const state = {
    phase: 'active',
    callType: 'VIDEO',
    callId: 'call-runtime-1',
    hasCameraPermission: true,
    cameraFacing: 'user',
    cameraEnabled: false,
    muted: false,
    localStreamUrl: null,
    remoteStreamUrl: null,
    remoteVideoState: 'waiting',
  }
  const store = {
    getState: () => ({
      ...state,
      patch: (next) => Object.assign(state, next),
    }),
  }
  const socket = { connected: true }
  const localStreamRef = { current: null }
  const videoProducerRef = { current: null }
  const produced = []
  const capturedTracks = []
  const cameraCommands = []
  const closedProducerRequests = []
  let requestSequence = 0

  const mediaDevices = {
    getUserMedia: async ({ video }) => {
      const capture = deferredVideoCapture ?? Promise.resolve()
      await capture
      const track = new FakeTrack(video ? 'video' : 'audio')
      capturedTracks.push(track)
      const stream = new FakeMediaStream()
      stream.addTrack(track)
      return stream
    },
  }

  const producer = (track) => ({
    id: `producer-${produced.length + 1}`,
    track,
    closed: false,
    close() {
      this.closed = true
    },
  })
  const sendTransport = {
    produce: async ({ track }) => {
      const nextProducer = producer(track)
      produced.push(nextProducer)
      return nextProducer
    },
  }

  const callSocket = {
    createCallRequestId: (prefix = 'call') => `${prefix}-${++requestSequence}`,
    emitAndWaitForEvent: async (_socket, event, payload) => {
      if (event !== 'set_video_enabled') {
        throw new Error(`unexpected event ${event}`)
      }
      cameraCommands.push(payload)
      if (cameraAckResponder) {
        await cameraAckResponder(payload)
      } else if (deferredCameraAck) {
        await deferredCameraAck.promise
      }
      return {
        callId: payload.callId,
        producerId: payload.producerId,
        userId: 'user-a',
        enabled: payload.enabled,
        revision: payload.revision,
        status: 'applied',
        actionId: payload.actionId,
        requestId: payload.requestId,
      }
    },
    isCallWaitCancelledError: () => false,
  }

  const Camera = {
    requestCameraPermissionsAsync: async () => ({ granted: true }),
    requestMicrophonePermissionsAsync: async () => ({ granted: true }),
  }
  const AppState = { currentState: 'active' }
  const react = {
    useCallback: (callback) => callback,
    useRef: (initialValue) => ({ current: initialValue }),
  }

  const runtimeModule = loadTypeScriptModule(
    path.join(root, 'src/lib/call/useCallLocalMediaRuntime.ts'),
    {
      react,
      'expo-camera': { Camera },
      'react-native': { AppState },
      'react-native-webrtc': { MediaStream: FakeMediaStream, mediaDevices },
      '../../stores/callStore': { useCallStore: store },
      './callConstants': {
        VIDEO_STATE_MAX_ATTEMPTS: 1,
        VIDEO_STATE_RETRY_DELAY_MAX_MS: 1,
        VIDEO_STATE_RETRY_DELAY_MS: 1,
        VIDEO_STATE_UPDATED_TIMEOUT_MS: 50,
      },
      './callDebug': callDebug,
      './callPolicies': {
        cameraConstraints: () => ({ facingMode: 'user' }),
        isCallSetupCancelledError: () => false,
        isTerminalRemoteMediaError: () => false,
      },
      './callSocket': callSocket,
      './callVideoState': callVideoState,
    },
  )

  const refs = {
    socketRef: { current: socket },
    socketGenerationRef: { current: 1 },
    waitRegistryRef: { current: new Set() },
    deviceRef: { current: { loaded: true, canProduce: () => true } },
    sendTransportRef: { current: sendTransport },
    localStreamRef,
    ringingPreviewStreamRef: { current: null },
    remoteStreamRef: { current: null },
    videoProducerRef,
    localVideoStateRef: {
      current: {
        desiredEnabled: false,
        confirmedEnabled: false,
        revision: 0,
        pendingActionId: null,
      },
    },
    consumerMapRef: { current: new Map() },
    handledRemoteProducerIdsRef: { current: new Set() },
    queuedRemoteProducerMapRef: { current: new Map() },
    remoteVideoEnabledByProducerRef: { current: new Map() },
    remoteVideoRevisionByProducerRef: { current: new Map() },
    remoteVideoSnapshotReadyRef: { current: true },
    cameraPausedByBackgroundRef: { current: false },
    callSetupGenerationRef: { current: 1 },
    isCallSetupCurrent: () => true,
    closeLocalVideoProducer: async (callId, producerId) => {
      closedProducerRequests.push({ callId, producerId })
      if (deferredProducerClosure) await deferredProducerClosure.promise
    },
    waitForLocalVideoProducerClosures: async () => true,
    presentError: () => undefined,
  }

  const runtime = runtimeModule.useCallLocalMediaRuntime(refs)
  return {
    runtime,
    state,
    socket,
    refs,
    produced,
    capturedTracks,
    cameraCommands,
    closedProducerRequests,
  }
}

test('automatic and user video activation share one capture and one producer', async () => {
  const captureReady = createDeferred()
  const harness = createRuntime({ deferredVideoCapture: captureReady.promise })

  const automatic = harness.runtime.activateLocalVideo({
    requestPermission: false,
    source: 'post_answer',
  })
  await Promise.resolve()
  const userTap = harness.runtime.activateLocalVideo({
    requestPermission: false,
    source: 'user',
  })

  assert.equal(harness.capturedTracks.length, 0)
  captureReady.resolve()
  await Promise.all([automatic, userTap])

  assert.equal(harness.capturedTracks.length, 1)
  assert.equal(harness.produced.length, 1)
  assert.equal(harness.cameraCommands.length, 1)
  assert.equal(harness.state.cameraEnabled, true)
})

test('twenty concurrent video activations share one capture and one producer', async () => {
  const harness = createRuntime()

  const activations = Array.from({ length: 20 }, () =>
    harness.runtime.activateLocalVideo({
      requestPermission: false,
      source: 'user',
    }),
  )
  const results = await Promise.all(activations)

  assert.deepEqual(
    results,
    Array.from({ length: 20 }, () => true),
  )
  assert.equal(harness.capturedTracks.length, 1)
  assert.equal(harness.produced.length, 1)
  assert.equal(harness.cameraCommands.length, 1)
  assert.equal(harness.state.cameraEnabled, true)
})

test('does not create a second producer when the existing native track has ended', async () => {
  const harness = createRuntime()

  assert.equal(
    await harness.runtime.activateLocalVideo({ requestPermission: false, source: 'user' }),
    true,
  )
  harness.capturedTracks[0].readyState = 'ended'

  assert.equal(
    await harness.runtime.activateLocalVideo({ requestPermission: false, source: 'recovery' }),
    false,
  )
  assert.equal(harness.capturedTracks.length, 1)
  assert.equal(harness.produced.length, 1)
})

test('a user cancellation during automatic capture closes the stale track without producing video', async () => {
  const captureReady = createDeferred()
  const harness = createRuntime({ deferredVideoCapture: captureReady.promise })

  const automatic = harness.runtime.activateLocalVideo({
    requestPermission: false,
    source: 'post_answer',
  })
  await Promise.resolve()
  await harness.runtime.toggleCamera()
  captureReady.resolve()

  assert.equal(await automatic, false)
  assert.equal(harness.produced.length, 0)
  assert.equal(harness.capturedTracks.length, 1)
  assert.equal(harness.capturedTracks[0].stopCount, 1)
  assert.equal(harness.state.cameraEnabled, false)
  assert.equal(harness.refs.localVideoStateRef.current.desiredEnabled, false)
})

test('cancellation after server produce closes the local producer exactly once', async () => {
  const cameraAck = createDeferred()
  const harness = createRuntime({ deferredCameraAck: cameraAck })

  const activation = harness.runtime.activateLocalVideo({
    requestPermission: false,
    source: 'post_answer',
  })
  for (let attempt = 0; attempt < 10 && harness.produced.length === 0; attempt += 1) {
    await Promise.resolve()
  }
  assert.equal(harness.produced.length, 1)

  const cancellation = harness.runtime.toggleCamera()
  cameraAck.resolve()
  await Promise.all([activation, cancellation])

  assert.deepEqual(harness.closedProducerRequests, [
    { callId: 'call-runtime-1', producerId: 'producer-1' },
  ])
  assert.equal(harness.produced[0].closed, true)
  assert.equal(harness.refs.videoProducerRef.current, null)
})

test('reactivation waits for cancelled producer cleanup before producing again', async () => {
  const cameraAck = createDeferred()
  const producerClosure = createDeferred()
  const harness = createRuntime({
    deferredCameraAck: cameraAck,
    deferredProducerClosure: producerClosure,
  })

  const firstActivation = harness.runtime.activateLocalVideo({
    requestPermission: false,
    source: 'post_answer',
  })
  for (let attempt = 0; attempt < 10 && harness.produced.length === 0; attempt += 1) {
    await Promise.resolve()
  }
  assert.equal(harness.produced.length, 1)

  await harness.runtime.toggleCamera()
  cameraAck.resolve()
  const reactivation = harness.runtime.activateLocalVideo({
    requestPermission: false,
    source: 'user',
  })
  await Promise.resolve()
  assert.equal(harness.produced.length, 1)

  producerClosure.resolve()
  assert.equal(await firstActivation, false)
  assert.equal(await reactivation, true)
  assert.equal(harness.produced.length, 2)
  assert.deepEqual(harness.closedProducerRequests, [
    { callId: 'call-runtime-1', producerId: 'producer-1' },
  ])
})

test('camera off/on while disconnected preserves desired intent and reconciles after reconnect', async () => {
  const harness = createRuntime()
  assert.equal(
    await harness.runtime.activateLocalVideo({ requestPermission: false, source: 'user' }),
    true,
  )
  const track = harness.capturedTracks[0]
  assert.equal(harness.produced.length, 1)

  harness.socket.connected = false
  await harness.runtime.toggleCamera()
  await Promise.resolve()
  assert.equal(track.enabled, false)
  assert.equal(harness.refs.localVideoStateRef.current.desiredEnabled, false)
  assert.equal(harness.state.cameraEnabled, false)

  await harness.runtime.toggleCamera()
  assert.equal(track.enabled, true)
  assert.equal(harness.refs.localVideoStateRef.current.desiredEnabled, true)
  assert.equal(harness.state.cameraEnabled, false)
  assert.equal(harness.produced.length, 1)

  harness.socket.connected = true
  assert.equal(await harness.runtime.synchronizeLocalVideoState(), true)
  assert.equal(harness.state.cameraEnabled, true)
  assert.equal(harness.refs.localVideoStateRef.current.confirmedEnabled, true)
  assert.equal(harness.refs.localVideoStateRef.current.desiredEnabled, true)
  assert.equal(harness.produced.length, 1)
})

test('a late camera ACK cannot roll the native track back behind the newest revision', async () => {
  const ackResolvers = new Map()
  const harness = createRuntime({
    cameraAckResponder: async (payload) => {
      if (payload.revision === 1) return
      await new Promise((resolve) => ackResolvers.set(payload.revision, resolve))
    },
  })

  assert.equal(
    await harness.runtime.activateLocalVideo({ requestPermission: false, source: 'user' }),
    true,
  )
  const track = harness.capturedTracks[0]

  const cameraOff = harness.runtime.toggleCamera()
  for (let attempt = 0; attempt < 10 && !ackResolvers.has(2); attempt += 1) {
    await Promise.resolve()
  }
  assert.equal(ackResolvers.has(2), true)

  const cameraOn = harness.runtime.toggleCamera()
  for (let attempt = 0; attempt < 10 && !ackResolvers.has(3); attempt += 1) {
    await Promise.resolve()
  }
  assert.equal(ackResolvers.has(3), true)

  ackResolvers.get(3)()
  await Promise.resolve()
  assert.equal(track.enabled, true)
  ackResolvers.get(2)()

  await Promise.all([cameraOff, cameraOn])
  assert.equal(track.enabled, true)
  assert.equal(harness.state.cameraEnabled, true)
  assert.equal(harness.refs.localVideoStateRef.current.revision, 3)
  assert.equal(harness.refs.localVideoStateRef.current.confirmedEnabled, true)
})

test('a failed camera command restores the last confirmed local state', async () => {
  const harness = createRuntime({
    cameraAckResponder: async (payload) => {
      if (payload.revision === 2) throw new Error('camera_timeout')
    },
  })

  assert.equal(
    await harness.runtime.activateLocalVideo({ requestPermission: false, source: 'user' }),
    true,
  )
  const track = harness.capturedTracks[0]

  await harness.runtime.toggleCamera()
  for (let attempt = 0; attempt < 10 && harness.cameraCommands.length < 2; attempt += 1) {
    await Promise.resolve()
  }
  await Promise.resolve()

  assert.equal(track.enabled, true)
  assert.equal(harness.state.cameraEnabled, true)
  assert.equal(harness.refs.localVideoStateRef.current.desiredEnabled, false)
  assert.equal(harness.refs.localVideoStateRef.current.confirmedEnabled, true)
})

const createRecoveryRuntime = ({ rejoinPayload, rejoinDeferred = null } = {}) => {
  const state = {
    phase: 'active',
    callId: 'call-runtime-1',
    callType: 'VIDEO',
    hasCameraPermission: true,
    durationSec: 12,
    remoteAudioState: 'waiting',
  }
  const store = {
    getState: () => ({ ...state, patch: (next) => Object.assign(state, next) }),
  }
  const setupRef = { current: 1 }
  const socket = { connected: true }
  const recoveryInFlightRef = { current: false }
  const controlPlaneRecoveringRef = { current: true }
  const reconnectModeRef = { current: null }
  const activeCallIdRef = { current: state.callId }
  const rejoinResult =
    rejoinDeferred ??
    Promise.resolve(
      rejoinPayload ?? {
        callId: state.callId,
        session: { callType: 'VIDEO' },
        activeProducers: [],
        telemetryToken: 'telemetry-token',
      },
    )
  const rejoinCalls = []
  const reconciledSnapshots = []
  const consumed = []
  let teardownCount = 0
  let postAnswerCount = 0

  const callSocket = {
    emitAndWaitForEvent: async (_socket, event, payload) => {
      assert.equal(event, 'rejoin_call')
      rejoinCalls.push(payload)
      return rejoinResult
    },
  }
  const runtimeModule = loadTypeScriptModule(
    path.join(root, 'src/lib/call/useCallRecoveryRuntime.ts'),
    {
      react: { useCallback: (callback) => callback },
      '../../stores/callStore': { useCallStore: store },
      './callConstants': {
        CALL_JOINED_TIMEOUT_MS: 50,
        MEDIA_TRANSPORT_DISCONNECT_GRACE_MS: 1,
        RECONNECT_RECOVERY_TIMEOUT_MS: 50,
        TRANSPORT_CONNECTED_TIMEOUT_MS: 50,
      },
      './callDebug': callDebug,
      './callPolicies': {
        isCallSetupCancelledError: (error) =>
          error instanceof Error && error.message === 'Call setup was cancelled',
        isConnectedTransportState: () => false,
        isTerminalRemoteMediaError: () => false,
        isWaitTimeoutError: () => false,
        waitForTransportConnection: async () => undefined,
      },
      './callSocket': callSocket,
    },
  )

  const refs = {
    socketRef: { current: socket },
    socketGenerationRef: { current: 1 },
    waitRegistryRef: { current: new Set() },
    sendTransportRef: { current: null },
    recvTransportRef: { current: null },
    videoProducerRef: { current: null },
    localVideoStateRef: {
      current: {
        desiredEnabled: false,
        confirmedEnabled: false,
        revision: 0,
        pendingActionId: null,
      },
    },
    remoteVideoEnabledByProducerRef: { current: new Map() },
    remoteVideoRevisionByProducerRef: { current: new Map() },
    remoteVideoSnapshotReadyRef: { current: false },
    connectedTransportIdsRef: { current: new Set() },
    activeCallIdRef,
    callAnsweredRef: { current: true },
    telemetrySessionRef: { current: null },
    reconnectRecoveryInFlightRef: recoveryInFlightRef,
    controlPlaneRecoveringRef,
    reconnectModeRef,
    teardownInProgressRef: { current: false },
    mediaTransportDisconnectTimeoutsRef: { current: new Map() },
  }

  const runtime = runtimeModule.useCallRecoveryRuntime({
    isAuthenticated: true,
    currentUserId: 'user-local',
    ...refs,
    markRemoteVideoSnapshotReady: (ready) => {
      refs.remoteVideoSnapshotReadyRef.current = ready
    },
    reconcileRemoteVideoSnapshot: (activeIds) => {
      reconciledSnapshots.push([...activeIds].sort())
    },
    activateLocalVideo: async () => true,
    synchronizeLocalVideoState: async () => true,
    deactivateLocalVideo: () => undefined,
    clearRemoteVideoRuntime: () => undefined,
    consumeRemoteProducer: async (payload) => {
      consumed.push(payload)
    },
    invalidateCallSetup: () => {
      setupRef.current += 1
    },
    disposeMediaRuntime: () => undefined,
    beginCallSetup: () => {
      setupRef.current += 1
      return setupRef.current
    },
    postAnswerSetup: async () => {
      postAnswerCount += 1
    },
    assertCallSetupCurrent: (token, callId) => {
      if (token !== setupRef.current || callId !== state.callId) {
        throw new Error('Call setup was cancelled')
      }
    },
    clearReconnectTimeout: () => undefined,
    startTimer: () => undefined,
    markNativeCallActive: () => true,
    armReconnectTimeout: () => undefined,
    teardownRecoveryFailure: async () => {
      teardownCount += 1
    },
    stopTimer: () => undefined,
    isCurrentCall: (callId) => callId === state.callId,
    clearMediaTransportDisconnectTimeout: () => undefined,
    clearRemoteAudioFallback: () => undefined,
    resetRemoteConsumerRuntime: () => undefined,
  })

  return {
    runtime,
    state,
    setupRef,
    recoveryInFlightRef,
    rejoinCalls,
    reconciledSnapshots,
    consumed,
    get teardownCount() {
      return teardownCount
    },
    get postAnswerCount() {
      return postAnswerCount
    },
  }
}

test('a stale recovery generation cannot mutate the newer call runtime', async () => {
  const rejoin = createDeferred()
  const harness = createRecoveryRuntime({ rejoinDeferred: rejoin.promise })
  const recovery = harness.runtime.recoverActiveCall()
  await Promise.resolve()
  harness.setupRef.current += 1
  rejoin.resolve({
    callId: 'call-runtime-1',
    session: { callType: 'VIDEO' },
    activeProducers: [],
    telemetryToken: 'telemetry-token',
  })

  await recovery
  assert.equal(harness.teardownCount, 0)
  assert.equal(harness.postAnswerCount, 0)
  assert.equal(harness.recoveryInFlightRef.current, false)
})

test('rejoin snapshot rebuilds remote video state from active producers', async () => {
  const harness = createRecoveryRuntime({
    rejoinPayload: {
      callId: 'call-runtime-1',
      session: { callType: 'VIDEO' },
      activeProducers: [
        { userId: 'user-peer', producerId: 'video-2', kind: 'video', paused: false, revision: 4 },
        { userId: 'user-peer', producerId: 'audio-1', kind: 'audio', paused: false },
      ],
      telemetryToken: 'telemetry-token',
    },
  })

  await harness.runtime.recoverActiveCall()
  assert.deepEqual(harness.rejoinCalls, [{ callId: 'call-runtime-1' }])
  assert.deepEqual(harness.reconciledSnapshots, [['video-2']])
  assert.deepEqual(
    harness.consumed.map(({ producerId, kind, revision }) => ({ producerId, kind, revision })),
    [
      { producerId: 'audio-1', kind: 'audio', revision: undefined },
      { producerId: 'video-2', kind: 'video', revision: 4 },
    ],
  )
  assert.equal(harness.state.phase, 'active')
})
