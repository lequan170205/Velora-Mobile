const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

global.__DEV__ = false

const source = fs.readFileSync(
  path.join(__dirname, '../src/lib/call/useCallMediaTransportRuntime.ts'),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

const createRuntime = (isGroupCall, error, hasRemoteAudio = false) => {
  const state = { isGroupCall, remoteAudioState: 'connected' }
  const store = { getState: () => ({ ...state, patch: (next) => Object.assign(state, next) }) }
  const mocks = {
    react: { useCallback: (callback) => callback },
    'react-native': { AppState: { currentState: 'active' } },
    'react-native-webrtc': { MediaStream: class {}, mediaDevices: {} },
    '../../stores/callStore': { useCallStore: store },
    './callConstants': { REMOTE_CONSUMER_MAX_RETRY_ATTEMPTS: 1 },
    './callDebug': { safeCallErrorCode: () => 'test', shortCallId: (id) => id },
    './callPolicies': {
      isCallSetupCancelledError: () => false,
      isTerminalRemoteMediaError: (failure) => /^(Producer|Room) not found$/.test(failure.message),
    },
    './callSocket': {
      createCallRequestId: () => 'request-1',
      emitAndWaitForEvent: async () => {
        throw error
      },
    },
    './callVideoState': { shouldApplyRemoteVideoRevision: () => false },
    './mediasoup': {},
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    (specifier) => mocks[specifier] ?? require(specifier),
    module,
    module.exports,
  )
  const ref = (current) => ({ current })
  const consumerMapRef = ref(new Map(hasRemoteAudio ? [['survivor', { kind: 'audio' }]] : []))
  let teardownCount = 0
  const runtime = module.exports.useCallMediaTransportRuntime({
    currentUserId: 'me',
    recordGroupMicProducer: () => {},
    socketRef: ref({ connected: true }),
    waitRegistryRef: ref(new Set()),
    deviceRef: ref({ loaded: true }),
    recvTransportRef: ref({ id: 'recv-1' }),
    consumerMapRef,
    queuedRemoteProducerMapRef: ref(new Map()),
    handledRemoteProducerIdsRef: ref(new Set()),
    remoteVideoRevisionByProducerRef: ref(new Map()),
    remoteVideoEnabledByProducerRef: ref(new Map()),
    closedRemoteVideoProducerIdsRef: ref(new Set()),
    consumingProducerIdsRef: ref(new Set()),
    retryingProducerIdsRef: ref(new Set()),
    remoteConsumerRetryStateRef: ref(new Map()),
    reconnectModeRef: ref(null),
    callSetupGenerationRef: ref(1),
    telemetrySessionRef: ref(null),
    getCurrentCallId: () => 'call-1',
    assertCallSetupCurrent: () => {},
    isCallSetupCurrent: () => true,
    teardownOnce: async () => {
      teardownCount += 1
    },
    deriveRemoteVideoState: () => 'idle',
  })
  return { runtime, state, getTeardownCount: () => teardownCount }
}

const producer = { callId: 'call-1', userId: 'guest', producerId: 'audio-1', kind: 'audio' }

test('a stale group producer does not end the room or hide surviving audio', async () => {
  const { runtime, state, getTeardownCount } = createRuntime(
    true,
    new Error('Producer not found'),
    true,
  )
  await runtime.consumeRemoteProducer(producer, { propagateFailure: true, retryOnFailure: true })
  assert.equal(getTeardownCount(), 0)
  assert.equal(state.remoteAudioState, 'connected')
})

test('an exhausted group producer retry leaves the room active and waiting', async () => {
  const { runtime, state, getTeardownCount } = createRuntime(true, new Error('transport failed'))
  await runtime.consumeRemoteProducer(producer, {
    propagateFailure: true,
    retryOnFailure: true,
    retryAttempt: 1,
  })
  assert.equal(getTeardownCount(), 0)
  assert.equal(state.remoteAudioState, 'waiting')
})

test('a missing room remains terminal, and direct calls retain their failure policy', async () => {
  const group = createRuntime(true, new Error('Room not found'))
  await assert.rejects(
    group.runtime.consumeRemoteProducer(producer, { propagateFailure: true, retryOnFailure: true }),
    /Room not found/,
  )
  const direct = createRuntime(false, new Error('Producer not found'))
  await direct.runtime.consumeRemoteProducer(producer)
  assert.equal(direct.getTeardownCount(), 1)
})
