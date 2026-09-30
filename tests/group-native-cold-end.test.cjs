const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const load = (file, mocks) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS },
    fileName: file,
  }).outputText
  const result = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    (name) => (Object.hasOwn(mocks, name) ? mocks[name] : require(name)),
    result,
    result.exports,
  )
  return result.exports
}

test('winning action is device-bound and isolated by account and call', async () => {
  const stored = new Map()
  const secureStore = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
    setItemAsync: async (key, value, options) => {
      assert.equal(options.keychainAccessible, 'device-only')
      stored.set(key, value)
    },
    getItemAsync: async (key) => stored.get(key) ?? null,
    deleteItemAsync: async (key) => stored.delete(key),
  }
  const { groupWinnerAction } = load('src/lib/call/groupWinnerAction.ts', {
    'expo-secure-store': secureStore,
  })
  await groupWinnerAction.save('guest-a', 'call-1', 'secret-action')
  assert.equal(await groupWinnerAction.load('guest-a', 'call-1'), 'secret-action')
  assert.equal(await groupWinnerAction.load('guest-b', 'call-1'), null)
  assert.equal(await groupWinnerAction.load('guest-a', 'call-2'), null)
  await groupWinnerAction.clear('guest-a', 'call-1')
  assert.equal(await groupWinnerAction.load('guest-a', 'call-1'), null)
  await assert.rejects(
    async () => groupWinnerAction.load('guest/a', 'call-1'),
    /Invalid group call identity/,
  )
})

const coldEndHarness = (
  winnerActionId,
  action = 'end',
  rejoinFails = false,
  leaveFails = false,
) => {
  const events = []
  const pending = { action, actionId: 'end-1', callId: 'call-1', accountId: 'guest-a' }
  const socket = { connected: true, emit: (name, payload) => events.push([name, payload]) }
  const { useNativeCallActions } = load('src/lib/call/useNativeCallActions.ts', {
    react: { useCallback: (fn) => fn },
    '../../api/call.api': {
      getCallState: async () => ({
        callId: 'call-1',
        status: 'active',
        isGroupCall: true,
        initiatorId: 'host-a',
      }),
    },
    '../../stores/authStore': {
      useAuthStore: { getState: () => ({ user: { id: 'guest-a' }, isAuthenticated: true }) },
    },
    '../../stores/callStore': {
      useCallStore: { getState: () => ({ phase: 'idle', callId: null }) },
    },
    '../systemCalls/veloraSystemCalls': {
      veloraSystemCalls: {
        clearPendingCallAction: (id) => events.push(['clear', id]),
        dismissIncomingCall: (id) => events.push(['dismiss', id]),
      },
    },
    './callDebug': { safeCallErrorCode: () => 'test_error', shortCallId: () => 'short' },
    './callPolicies': { isBusyPhase: () => false, isRetryableCallStateError: () => false },
    './groupWinnerAction': {
      groupWinnerAction: {
        load: async () => winnerActionId,
        clear: async () => events.push(['delete-winner']),
      },
    },
    './callSocket': {
      emitAndWaitForEvent: async (_socket, event, payload) => {
        events.push([event, payload])
        if (event === 'rejoin_call' && rejoinFails) throw new Error('already_left')
        if (event === 'leave_call' && leaveFails) throw new Error('not_owner')
        return { callId: payload.callId }
      },
    },
  })
  const completed = new Set()
  const { processNativeCallAction } = useNativeCallActions({
    isLoading: false,
    isAuthenticated: true,
    currentUserId: 'guest-a',
    processingNativeActionIdsRef: { current: new Set() },
    completedNativeActionIdsRef: { current: completed },
    acceptingIncomingCallIdRef: { current: null },
    outgoingStartInFlightRef: { current: false },
    nativeActionRetryTimeoutRef: { current: null },
    clearNativeActionRetryTimeout: () => {},
    isCurrentCall: () => false,
    teardownOnce: async () => events.push(['teardown']),
    prepareIncomingCallFromState: () => true,
    prepareIncomingCallFromPayload: () => true,
    resumeAcceptedCall: async () => false,
    acceptIncomingCall: async () => {},
    endCall: async () => {},
    ensureCallSocketConnected: async () => socket,
    rejectIncomingCall: async () => {},
  })
  return { events, pending, completed, processNativeCallAction }
}

test('cold group guest end rejoins with winner proof before confirmed leave', async () => {
  const harness = coldEndHarness('winner-1')
  await harness.processNativeCallAction(harness.pending)
  assert.deepEqual(
    harness.events.map(([event]) => event),
    ['rejoin_call', 'leave_call', 'delete-winner', 'teardown', 'clear'],
  )
  assert.equal(harness.events[0][1].actionId, 'winner-1')
  assert.equal(harness.completed.has('end-1'), true)
})

test('missing winner proof never reports a successful leave', async () => {
  const harness = coldEndHarness(null)
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    await harness.processNativeCallAction(harness.pending)
  } finally {
    console.warn = originalWarn
  }
  assert.deepEqual(harness.events, [])
  assert.equal(harness.completed.has('end-1'), false)
})

test('lost prior leave acknowledgement is recovered by idempotent leave', async () => {
  const harness = coldEndHarness('winner-1', 'end', true)
  await harness.processNativeCallAction(harness.pending)
  assert.deepEqual(
    harness.events.map(([event]) => event),
    ['rejoin_call', 'leave_call', 'delete-winner', 'teardown', 'clear'],
  )
  assert.equal(harness.completed.has('end-1'), true)
})

test('a denied leave keeps the native action for retry', async () => {
  const harness = coldEndHarness('wrong-action', 'end', true, true)
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    await harness.processNativeCallAction(harness.pending)
  } finally {
    console.warn = originalWarn
  }
  assert.deepEqual(
    harness.events.map(([event]) => event),
    ['rejoin_call', 'leave_call'],
  )
  assert.equal(harness.completed.has('end-1'), false)
})

test('failed cold resume dismisses native UI and retires its journal entry', async () => {
  const harness = coldEndHarness('winner-1', 'resume')
  await harness.processNativeCallAction(harness.pending)
  assert.deepEqual(harness.events, [
    ['dismiss', 'call-1'],
    ['clear', 'end-1'],
  ])
  assert.equal(harness.completed.has('end-1'), true)
})
