const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const providerSource = read('src/providers/CallProvider.tsx')
const chatScreen = read('app/conversation/[id].tsx')

const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

test('the chat banner can join while this device still rings for the same call', () => {
  assert.match(
    chatScreen,
    /const isRingingHere =\s*serverCall\?\.callId === currentCallId && callPhase === 'incoming_ringing'/,
  )
  assert.match(
    chatScreen,
    /canOpen:[\s\S]*!serverCall\.joined && \(callPhase === 'idle' \|\| isRingingHere\)/,
  )

  const openHandler = sliceBetween(
    chatScreen,
    'const handleOpenActiveGroupCall = useCallback(async () => {',
    'const latest = await getCallState(active.callId)',
  )
  assert.match(
    openHandler,
    /const ringingHere = local\.phase === 'incoming_ringing' && local\.callId === active\.callId/,
  )
  assert.match(openHandler, /if \(local\.phase !== 'idle' && !ringingHere\) return/)
  assert.match(openHandler, /await joinGroupCall\(/)
})

test('joining a ringing invitation stops local ringing without declining it', () => {
  const joinGroupCall = sliceBetween(
    providerSource,
    'const joinGroupCall = useCallback(',
    'const startVideoCall = useCallback(',
  )

  const ringingCheck = joinGroupCall.indexOf("ringing.phase === 'incoming_ringing'")
  const dismiss = joinGroupCall.indexOf('veloraSystemCalls.dismissIncomingCall(')
  const localTeardown = joinGroupCall.indexOf(
    "await teardownOnce('group_invitation_joined_from_chat')",
  )
  const lateJoin = joinGroupCall.indexOf('joinCallId: input.callId')

  assert.ok(ringingCheck !== -1, 'checks for a ringing invitation')
  assert.match(joinGroupCall, /ringing\.isGroupCall &&\s*ringing\.callId === input\.callId/)
  assert.ok(dismiss > ringingCheck, 'dismisses the native ringing surface')
  assert.ok(localTeardown > dismiss, 'clears the local ringing state')
  assert.ok(lateJoin > localTeardown, 'joins only after the ringing state is gone')

  // A decline would end the invitation; the late join itself supersedes it.
  assert.doesNotMatch(joinGroupCall, /reject_call|rejectIncomingCall/)
  assert.doesNotMatch(
    'group_invitation_joined_from_chat',
    /reject|declin|cancel|fail|error/,
    'the local teardown is recorded as an ended ringing, not a decline or failure',
  )
})
