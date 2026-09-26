const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('group conversations expose voice while keeping video disabled', () => {
  const screen = read('app/conversation/[id].tsx')
  assert.match(screen, /currentConversation\?\.isGroup \? \{ isGroupCall: true \} : \{\}/)
  assert.match(screen, /callType === 'VIDEO' && currentConversation\?\.isGroup/)
  assert.match(screen, /showVideoCallAction=\{!currentConversation\?\.isGroup\}/)
})

test('conversation banner uses live server state and rechecks before opening the call', () => {
  const screen = read('app/conversation/[id].tsx')
  const header = read('src/components/chat/conversation/ConversationHeader.tsx')
  const api = read('src/api/call.api.ts')
  assert.match(api, /getActiveGroupCall\(conversationId: string\)/)
  assert.match(screen, /queryFn: \(\) => getActiveGroupCall\(conversationId\)/)
  assert.match(screen, /serverCall\?\.joined/)
  assert.match(screen, /serverCall\?\.callId === currentCallId/)
  assert.match(screen, /const active = await getActiveGroupCall\(conversationId\)/)
  assert.match(screen, /const latest = await getCallState\(active\.callId\)/)
  assert.match(screen, /await joinGroupCall\(/)
  assert.match(screen, /latest\.status === 'active'/)
  assert.match(screen, /groupWinnerAction\.load\(user\.id, active\.callId\)/)
  assert.match(screen, /const canRejoin = Boolean\(serverCall\?\.joined && localWinnerQuery\.data/)
  assert.match(header, /Group call in progress/)
  assert.match(header, /accessibilityRole="button"/)
})

test('late join persists the same device action before sending and reuses it after a lost ACK', () => {
  const provider = read('src/providers/CallProvider.tsx')
  const start = provider.slice(provider.indexOf('const startCall = useCallback('))
  const load = start.indexOf('groupWinnerAction.load(currentUserId, input.joinCallId)')
  const save = start.indexOf('groupWinnerAction.save(')
  const send = start.indexOf("'join_group_call',")
  assert.ok(load >= 0 && save > load && send > save)
  assert.match(start, /actionId: lateJoinRequest\.actionId/)
})

test('group host skips the one-to-one answer wait and guests ignore peer-left teardown', () => {
  const provider = read('src/providers/CallProvider.tsx')
  const callScreen = read('app/call/[id].tsx')
  const recovery = read('src/lib/call/useCallRecoveryRuntime.ts')
  assert.match(provider, /joined\.session\.isGroupCall\s*\? 'answered'/)
  assert.match(
    provider,
    /if \(state\.isGroupCall\) \{[\s\S]*groupParticipantIds: state\.groupParticipantIds\.filter/,
  )
  assert.match(provider, /payload\.session\.isGroupCall === true/)
  assert.match(provider, /const armGroupInvitationTimeout = useCallback/)
  assert.match(provider, /teardownOnce\('group_invitation_expired'\)/)
  assert.match(callScreen, /\) : !isGroupCall \? \(/)
  assert.match(
    recovery,
    /if \(state\.isGroupCall\) \{[\s\S]*groupReconnectingUserIds: \[\.\.\.state\.groupReconnectingUserIds, payload\.userId\]/,
  )
  assert.match(recovery, /groupReconnectingUserIds: state\.groupReconnectingUserIds\.filter\(/)
})

test('cold native group invites retain their identity through display, action journal, and acceptance', () => {
  const androidStore = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallStore.kt',
  )
  const androidNotification = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraCallNotifications.kt',
  )
  const androidActivity = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraIncomingCallActivity.kt',
  )
  const ios = read('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift')
  const provider = read('src/providers/CallProvider.tsx')

  for (const source of [androidStore, ios]) {
    assert.match(source, /"isGroupCall"/)
    assert.match(source, /"groupName"/)
    assert.match(source, /"groupAvatarUrl"/)
  }
  assert.match(androidStore, /key == "isGroupCall" && value is String/)
  assert.match(androidNotification, /payload\["isGroupCall"\] == true\) payload\["groupName"\]/)
  assert.match(androidActivity, /payload\["isGroupCall"\] == true\) payload\["groupName"\]/)
  assert.match(ios, /payload\["isGroupCall"\] as\? Bool == true/)
  assert.match(provider, /isGroupCall: joined\.session\.isGroupCall === true/)
  assert.match(provider, /joined\.session\.groupName \|\| 'Group call'/)
})

test('one busy device does not decline a group invite for every device', () => {
  const provider = read('src/providers/CallProvider.tsx')
  const busyBranch = provider.slice(
    provider.indexOf('if (outgoingStartInFlightRef.current || isBusyPhase(currentState.phase))'),
  )
  assert.match(
    busyBranch,
    /if \(!payload\.isGroupCall\) \{\s*socketRef\.current\?\.emit\('reject_call'/,
  )
})

test('microphone denial on one device leaves the group invitation open elsewhere', () => {
  const provider = read('src/providers/CallProvider.tsx')
  const denial = provider.slice(provider.indexOf('if (!hasPermission)'))
  assert.match(denial, /if \(!state\.isGroupCall\) \{\s*socket\.emit\('reject_call'/)
})

test('group People shows joined members and stays in sync across joins, leaves, and reconnects', () => {
  const screen = read('app/call/[id].tsx')
  const provider = read('src/providers/CallProvider.tsx')
  const recovery = read('src/lib/call/useCallRecoveryRuntime.ts')
  const socketRuntime = read('src/lib/call/useCallSocketRuntime.ts')

  assert.match(screen, /groupPeopleIds\.map\(\(userId, index\)/)
  assert.match(screen, /conversationApi\.getMembers\(conversationId\)/)
  assert.match(screen, /participantRows\.map\(\(person\)/)
  assert.match(provider, /socket\.on\('new_peer', handleNewPeer\)/)
  assert.match(
    provider,
    /groupParticipantIds: state\.groupParticipantIds\.filter\(\(id\) => id !== payload\.userId\)/,
  )
  assert.match(
    recovery,
    /groupParticipantIds: rejoined\.session\.isGroupCall \? rejoined\.session\.participantIds : \[\]/,
  )
  assert.match(socketRuntime, /groupParticipantIds: rejoined\.session\.participantIds/)
  assert.match(screen, /member\.status === 'ACTIVE' && !joinedUserIds\.has\(member\.userId\)/)
  assert.match(screen, /Not in call · \{notInCallMembers\.length\}/)
  assert.match(screen, /isReconnecting\s*\? 'Reconnecting…'/)
  assert.match(screen, /reconnecting to this call/)
  assert.match(provider, /groupReconnectingUserIds: state\.groupReconnectingUserIds\.filter\(/)
  assert.match(recovery, /groupReconnectingUserIds: rejoined\.session\.isGroupCall/)
  assert.match(recovery, /pruneStaleGroupConsumers\(activeProducerIds\)/)
  assert.match(provider, /activeProducerIds\.has\(consumer\.producerId\)/)
  assert.match(provider, /consumer\.track\.readyState !== 'ended'/)
  assert.match(provider, /if \(!liveConsumerProducerIds\.has\(producerId\)\)/)
})

test('group call labels host ending separately from guest leaving', () => {
  const screen = read('app/call/[id].tsx')
  assert.match(screen, /const isGroupHost = isGroupCall && direction === 'outgoing'/)
  assert.match(screen, /Alert\.alert\('End group call\?', 'This will end the call for everyone\.'/)
  assert.match(screen, /isGroupHost \? 'End call for everyone' : 'Leave call'/)
  assert.match(screen, /Waiting for others to join…/)
})

test('a confirmed reservation release keeps other group devices eligible', () => {
  const provider = read('src/providers/CallProvider.tsx')
  const types = read('src/types/call.types.ts')
  assert.match(
    provider,
    /acceptance\.outcome === 'media_unavailable' &&\s*!acceptance\.reservationReleased/,
  )
  assert.match(types, /reservationReleased\?: boolean/)
  assert.match(provider, /!acceptance\.retryable/)
  assert.match(types, /retryable\?: boolean/)
})
