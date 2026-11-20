const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

global.__DEV__ = false

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

const remoteEndHarness = (callState) => {
  const events = []
  const { useNativeCallActions } = load('src/lib/call/useNativeCallActions.ts', {
    react: { useCallback: (fn) => fn },
    '../../api/call.api': { getCallState: async () => ({}) },
    '../../stores/authStore': {
      useAuthStore: { getState: () => ({ user: { id: 'guest-a' }, isAuthenticated: true }) },
    },
    '../../stores/callStore': { useCallStore: { getState: () => callState } },
    '../systemCalls/veloraSystemCalls': {
      veloraSystemCalls: {
        getPendingCallAction: () => null,
        clearPendingCallAction: (id) => events.push(['clear', id]),
        dismissIncomingCall: () => events.push(['dismiss']),
      },
    },
    './callDebug': { safeCallErrorCode: () => 'test_error', shortCallId: () => 'short' },
    './callPolicies': { isBusyPhase: () => false, isRetryableCallStateError: () => false },
    './groupWinnerAction': { groupWinnerAction: { load: async () => null, clear: async () => {} } },
    './callSocket': { emitAndWaitForEvent: async () => ({}) },
  })
  const { processNativeCallAction } = useNativeCallActions({
    isLoading: false,
    isAuthenticated: true,
    currentUserId: 'guest-a',
    processingNativeActionIdsRef: { current: new Set() },
    completedNativeActionIdsRef: { current: new Set() },
    acceptingIncomingCallIdRef: { current: null },
    outgoingStartInFlightRef: { current: false },
    nativeActionRetryTimeoutRef: { current: null },
    clearNativeActionRetryTimeout: () => {},
    isCurrentCall: (callId) => callId === callState.callId,
    teardownOnce: async (reason) => events.push(['teardown', reason]),
    prepareIncomingCallFromState: () => true,
    prepareIncomingCallFromPayload: () => true,
    resumeAcceptedCall: async () => true,
    acceptIncomingCall: async () => {},
    endCall: async (reason) => events.push(['endCall', reason]),
    ensureCallSocketConnected: async () => ({ connected: true, emit: () => {} }),
    rejectIncomingCall: async () => {},
  })
  return { events, processNativeCallAction }
}

const remoteEnd = {
  action: 'remote_end',
  actionId: 'remote-end-1',
  callId: 'room-1',
  accountId: 'guest-a',
  reason: 'answered_elsewhere',
}

for (const phase of ['connecting', 'active', 'reconnecting']) {
  test(`native remote end leaves a group room this device joined (${phase})`, async () => {
    const harness = remoteEndHarness({ callId: 'room-1', isGroupCall: true, phase })
    await harness.processNativeCallAction(remoteEnd)

    // endCall sends the server leave (with retries); a bare teardown would
    // leave this account's seat taken until the socket disconnects.
    assert.deepEqual(harness.events, [['dismiss'], ['endCall', 'ended'], ['clear', 'remote-end-1']])
  })
}

test('native remote end of a ringing group invitation only tears down locally', async () => {
  const harness = remoteEndHarness({
    callId: 'room-1',
    isGroupCall: true,
    phase: 'incoming_ringing',
  })
  await harness.processNativeCallAction({ ...remoteEnd, reason: 'no_answer' })

  assert.deepEqual(harness.events, [
    ['dismiss'],
    ['teardown', 'native_remote_end'],
    ['clear', 'remote-end-1'],
  ])
})

test('native remote end of a 1:1 call keeps the server-ended teardown', async () => {
  const harness = remoteEndHarness({ callId: 'room-1', isGroupCall: false, phase: 'active' })
  await harness.processNativeCallAction({ ...remoteEnd, reason: undefined, status: 'ended' })

  assert.deepEqual(harness.events, [
    ['dismiss'],
    ['teardown', 'native_remote_end'],
    ['clear', 'remote-end-1'],
  ])
})

test('native remote end for another call leaves the current group call alone', async () => {
  const harness = remoteEndHarness({ callId: 'room-2', isGroupCall: true, phase: 'active' })
  await harness.processNativeCallAction(remoteEnd)

  assert.deepEqual(harness.events, [['dismiss'], ['clear', 'remote-end-1']])
})
