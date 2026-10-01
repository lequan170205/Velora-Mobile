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

test('native bridge keeps invitation tombstones separate and translates cold journal actions to the live room', async () => {
  const ended = []
  let raw = {
    type: 'INCOMING_CALL',
    action: 'answer',
    actionId: 'answer-1',
    callId: 'invite-new',
    roomCallId: 'room',
    isGroupCall: true,
  }
  let current = { callId: 'room', groupInvitationId: 'invite-new' }
  const { veloraSystemCalls } = load('src/lib/systemCalls/veloraSystemCalls.ts', {
    expo: {
      requireOptionalNativeModule: () => ({
        getPendingCallAction: () => raw,
        endCall: async (id) => {
          ended.push(id)
          return { success: true }
        },
        dismissIncomingCall: async (id) => {
          ended.push(id)
          return { success: true }
        },
      }),
    },
    'expo-device': { isDevice: true },
    'react-native': { Platform: { OS: 'ios' } },
    '../../stores/callStore': { useCallStore: { getState: () => current } },
  })
  assert.deepEqual(veloraSystemCalls.getPendingCallAction(), {
    ...raw,
    callId: 'room',
    invitationId: 'invite-new',
  })
  await veloraSystemCalls.endCall('room')
  await veloraSystemCalls.endCall('invite-old')
  assert.deepEqual(ended, ['invite-new', 'invite-old'])
  await veloraSystemCalls.dismissIncomingCall('room', 'room')
  assert.equal(ended.at(-1), 'room')
  current = { callId: null, groupInvitationId: null }
  assert.equal(veloraSystemCalls.getPendingCallAction().callId, 'room')
  assert.equal(veloraSystemCalls.getPendingCallAction().invitationId, 'invite-new')
  raw = { ...raw, callId: 'initial-room', roomCallId: undefined }
  assert.equal(veloraSystemCalls.getPendingCallAction().invitationId, 'initial-room')
})

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
  await groupWinnerAction.save('guest-a', 'call-1', 'old-winner')
  await Promise.all([
    groupWinnerAction.save('guest-a', 'call-1', 'new-winner'),
    groupWinnerAction.clear('guest-a', 'call-1', 'old-winner'),
  ])
  assert.equal(await groupWinnerAction.load('guest-a', 'call-1'), 'new-winner')
  await Promise.all([
    groupWinnerAction.clear('guest-a', 'call-1', 'new-winner'),
    groupWinnerAction.save('guest-a', 'call-1', 'newest-winner'),
  ])
  assert.equal(await groupWinnerAction.load('guest-a', 'call-1'), 'newest-winner')
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
  callStateOverride = {},
  uiState = { phase: 'idle', callId: null },
  journal = [],
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
        ...callStateOverride,
      }),
    },
    '../../stores/authStore': {
      useAuthStore: { getState: () => ({ user: { id: 'guest-a' }, isAuthenticated: true }) },
    },
    '../../stores/callStore': {
      useCallStore: { getState: () => uiState },
    },
    '../systemCalls/veloraSystemCalls': {
      veloraSystemCalls: {
        getPendingCallAction: () => journal[0] ?? null,
        clearPendingCallAction: (id) => {
          events.push(['clear', id])
          const index = journal.findIndex((entry) => entry.actionId === id)
          if (index >= 0) journal.splice(index, 1)
        },
        dismissIncomingCall: (id, invitationId) => events.push(['dismiss', invitationId ?? id]),
      },
    },
    './callDebug': { safeCallErrorCode: () => 'test_error', shortCallId: () => 'short' },
    './callPolicies': { isBusyPhase: () => false, isRetryableCallStateError: () => false },
    './groupWinnerAction': {
      groupWinnerAction: {
        load: async () => winnerActionId,
        clear: async (_account, _call, proof) => events.push(['delete-winner', proof]),
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
  const { processNativeCallAction, processPendingNativeCallAction } = useNativeCallActions({
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
    acceptIncomingCall: async () => events.push(['accept']),
    endCall: async () => {},
    ensureCallSocketConnected: async () => socket,
    rejectIncomingCall: async () => {},
  })
  return { events, pending, completed, processNativeCallAction, processPendingNativeCallAction }
}

test('cold replay drains old terminal entries before answering a repeat invitation', async () => {
  const journal = [
    { action: 'remote_end', actionId: 'old-terminal', callId: 'call-1', invitationId: 'call-1' },
    { action: 'answer', actionId: 'new-answer', callId: 'call-1', invitationId: 'new-invite' },
  ]
  const harness = coldEndHarness('winner', 'end', false, false, {}, undefined, journal)
  await harness.processPendingNativeCallAction('auth_ready')
  assert.equal(journal.length, 0)
  assert.equal(harness.events.filter(([event]) => event === 'accept').length, 1)
  assert.equal(harness.completed.has('new-answer'), true)
})

test('journal drain stops at an unfinished retry instead of spinning or skipping it', async () => {
  const journal = [{ action: 'end', actionId: 'retry-end', callId: 'call-1' }]
  const harness = coldEndHarness(null, 'end', false, false, {}, undefined, journal)
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    await harness.processPendingNativeCallAction('app_resume')
  } finally {
    console.warn = originalWarn
  }
  assert.equal(journal.length, 1)
  assert.equal(harness.completed.has('retry-end'), false)
})

test('cold group guest end rejoins with winner proof before confirmed leave', async () => {
  const harness = coldEndHarness('winner-1')
  await harness.processNativeCallAction(harness.pending)
  assert.deepEqual(
    harness.events.map(([event]) => event),
    ['rejoin_call', 'leave_call', 'delete-winner', 'teardown', 'clear'],
  )
  assert.equal(harness.events[0][1].actionId, 'winner-1')
  assert.equal(harness.events.find(([name]) => name === 'delete-winner')[1], 'winner-1')
  assert.equal(harness.completed.has('end-1'), true)
})

test('stale native end and remote-end cannot tear down a newer invitation', async () => {
  for (const action of ['end', 'remote_end']) {
    const harness = coldEndHarness(
      'winner',
      action,
      false,
      false,
      { invitationId: 'new' },
      { callId: 'call-1', phase: 'incoming_ringing', groupInvitationId: 'new' },
    )
    await harness.processNativeCallAction({ ...harness.pending, invitationId: 'old' })
    assert.equal(
      harness.events.some(([event]) => event === 'teardown' || event === 'leave_call'),
      false,
    )
    assert.equal(harness.completed.has('end-1'), true)
  }
})

test('cold stale end rejects the older invitation after the authoritative state read', async () => {
  const harness = coldEndHarness('winner', 'end', false, false, { invitationId: 'new' })
  await harness.processNativeCallAction({ ...harness.pending, invitationId: 'old' })
  assert.deepEqual(harness.events, [
    ['dismiss', 'old'],
    ['clear', 'end-1'],
  ])
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
