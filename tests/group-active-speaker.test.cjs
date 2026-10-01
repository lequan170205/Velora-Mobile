const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/lib/call/groupActiveSpeaker.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText
const loaded = { exports: {} }
new Function('exports', compiled)(loaded.exports)
const { getGroupSpeakerPatch, getVisibleGroupSpeakerId, GROUP_SPEAKER_TTL_MS } = loaded.exports
const state = () => ({
  callId: 'call',
  isGroupCall: true,
  phase: 'active',
  muted: false,
  groupMicSyncError: false,
  groupParticipantIds: ['self', 'peer'],
  groupReconnectingUserIds: [],
  groupSpeakerRevision: -1,
  groupActiveSpeaker: null,
  groupMicStates: { peer: { producerId: 'audio-peer', enabled: true, revision: 2 } },
})
const event = (revision = 1) => ({
  callId: 'call',
  revision,
  speaker: { userId: 'peer', producerId: 'audio-peer', micRevision: 2 },
})
const patch = (s, e = event(), now = 1000) => getGroupSpeakerPatch(s, e, 'self', 'audio-self', now)

test('speaker identity follows the current authoritative audio producer, then expires', () => {
  const s = { ...state(), ...patch(state()) }
  assert.equal(getVisibleGroupSpeakerId(s, 'self', 1000), 'peer')
  assert.equal(s.groupActiveSpeaker.expiresAt, 1000 + GROUP_SPEAKER_TTL_MS)
  assert.equal(getVisibleGroupSpeakerId(s, 'self', 2500), null)
})
test('silence and newer heartbeats win over reordered or duplicate packets', () => {
  const s = { ...state(), ...patch(state(), event(2)) }
  assert.equal(patch(s, event(1)), null)
  assert.equal(patch(s, event(2)), null)
  const silence = patch(s, { callId: 'call', revision: 3, speaker: null })
  assert.equal(silence.groupActiveSpeaker, null)
  assert.equal(silence.groupSpeakerRevision, 3)
  assert.equal(patch({ ...s, ...silence }, event(2)), null)
})
test('mute, reconnect, leave, unknown mic and replacement suppress a remote highlight', () => {
  const s = { ...state(), ...patch(state()) }
  for (const changed of [
    { groupMicStates: {} },
    { groupMicStates: { peer: { producerId: 'audio-peer', enabled: false, revision: 3 } } },
    { groupMicStates: { peer: { producerId: 'replacement', enabled: true, revision: 2 } } },
    { groupMicStates: { peer: { producerId: 'audio-peer', enabled: true, revision: 3 } } },
    { groupReconnectingUserIds: ['peer'] },
    { groupParticipantIds: ['self'] },
    { phase: 'reconnecting' },
    { phase: 'ended' },
    { isGroupCall: false },
  ])
    assert.equal(getVisibleGroupSpeakerId({ ...s, ...changed }, 'self', 1000), null)
})
test('self speaking requires the local producer and a safely enabled microphone', () => {
  const e = { ...event(), speaker: { userId: 'self', producerId: 'audio-self', micRevision: 0 } }
  const s = { ...state(), ...patch(state(), e) }
  assert.equal(getVisibleGroupSpeakerId(s, 'self', 1000), 'self')
  assert.equal(
    patch(state(), { ...e, speaker: { ...e.speaker, producerId: 'old' } }).groupActiveSpeaker,
    null,
  )
  assert.equal(patch({ ...state(), muted: true }, e).groupActiveSpeaker, null)
  assert.equal(patch({ ...state(), groupMicSyncError: true }, e).groupActiveSpeaker, null)
})
test('cross-call, direct-call, malformed revisions and malformed identities cannot highlight', () => {
  for (const e of [
    null,
    { ...event(), callId: 'other' },
    event(0),
    event(NaN),
    event(1.5),
    event(Infinity),
  ])
    assert.equal(patch(state(), e), null)
  assert.equal(patch({ ...state(), isGroupCall: false }), null)
  for (const speaker of [
    undefined,
    {},
    { userId: 'peer', producerId: 'audio-peer', micRevision: -1 },
    { userId: 'outsider', producerId: 'audio-peer', micRevision: 2 },
  ])
    assert.equal(patch(state(), { ...event(), speaker }).groupActiveSpeaker, null)
})
test('People keeps its layout and exposes speaking with text and an accessible label', () => {
  const screen = fs.readFileSync(path.join(root, 'app/call/[id].tsx'), 'utf8')
  const provider = fs.readFileSync(path.join(root, 'src/providers/CallProvider.tsx'), 'utf8')
  assert.match(screen, /person\.isSpeaking \? 'Speaking' : person\.micStatus/)
  assert.match(screen, /person\.isSpeaking \? ', speaking' : ''/)
  assert.match(
    screen,
    /borderColor: person\.isSpeaking \? colors\.call\.textPrimary : 'transparent'/,
  )
  assert.match(provider, /socket\.on\('group_active_speaker', handleGroupActiveSpeaker\)/)
  assert.match(provider, /socket\.off\('group_active_speaker', handleGroupActiveSpeaker\)/)
  assert.match(
    provider,
    /const handleDisconnect = \(reason: string\) => \{\s*clearGroupSpeaker\(\)/,
  )
  assert.match(provider, /state\.groupSpeakerRevision === payload\.revision/)
})

test('actual provider handler refreshes expiry, cancels silence/disconnect timers and fences a later call', () => {
  const provider = fs.readFileSync(path.join(root, 'src/providers/CallProvider.tsx'), 'utf8')
  const body = provider.slice(
    provider.indexOf('let groupSpeakerTimeout:'),
    provider.indexOf('const handleSocketReady =', provider.indexOf('let groupSpeakerTimeout:')),
  )
  const js = ts.transpileModule(body, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  let current = state()
  current.patch = (next) => {
    current = { ...current, ...next }
  }
  let sequence = 0
  const timers = new Map()
  const setTimer = (fn, delay) => {
    assert.equal(delay, GROUP_SPEAKER_TTL_MS)
    const id = ++sequence
    timers.set(id, fn)
    return id
  }
  const { handleGroupActiveSpeaker: handle, clearGroupSpeaker: clear } = new Function(
    'useCallStore',
    'currentUserId',
    'audioProducerRef',
    'getGroupSpeakerPatch',
    'GROUP_SPEAKER_TTL_MS',
    'setTimeout',
    'clearTimeout',
    `${js}; return { handleGroupActiveSpeaker, clearGroupSpeaker };`,
  )(
    { getState: () => current },
    'self',
    { current: { id: 'audio-self' } },
    getGroupSpeakerPatch,
    GROUP_SPEAKER_TTL_MS,
    setTimer,
    (id) => timers.delete(id),
  )
  handle(event(1))
  const oldTimeout = timers.get(1)
  handle(event(2))
  assert.equal(timers.size, 1)
  oldTimeout()
  assert.equal(current.groupActiveSpeaker.userId, 'peer')
  handle({ callId: 'call', revision: 3, speaker: null })
  assert.equal(current.groupActiveSpeaker, null)
  assert.equal(timers.size, 0)
  handle(event(4))
  clear()
  assert.equal(current.groupActiveSpeaker, null)
  assert.equal(timers.size, 0)
  handle(event(5))
  const pending = [...timers.values()][0]
  current = {
    ...current,
    callId: 'next-call',
    groupSpeakerRevision: 5,
    groupActiveSpeaker: { userId: 'next-user' },
  }
  pending()
  assert.equal(current.groupActiveSpeaker.userId, 'next-user')
})
