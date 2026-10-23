const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const callScreen = fs.readFileSync(path.join(__dirname, '../app/call/[id].tsx'), 'utf8')

test('a member seen in the group call who left is shown as left, not as never invited', () => {
  // Remembered per call, so a new call starts with nobody seen.
  assert.match(callScreen, /const known = previous\.callId === callId \? previous\.userIds : \[\]/)
  assert.match(
    callScreen,
    /const added = groupPeopleIds\.filter\(\(userId\) => !known\.includes\(userId\)\)/,
  )
  assert.match(
    callScreen,
    /const uninvitedLabel = seenInCall\.userIds\.includes\(member\.userId\)\s*\?\s*statusLabels\.left\s*:\s*'Not invited'/,
  )
  assert.match(
    callScreen,
    /!invite\s*\?\s*inviteFeedback\[member\.userId\] \|\| uninvitedLabel\s*:\s*statusLabels\[invite\.status\]/,
  )
  assert.match(callScreen, /left: 'Left the call'/)
})

test('a closed call sheet leaves no backdrop that can swallow taps', () => {
  // The library backdrop starts touchable; on Android a closed sheet's
  // invisible backdrop blocked mute, leave and every other call control.
  assert.match(
    callScreen,
    /const renderParticipantsBackdrop = useCallback\(\s*\(props: BottomSheetBackdropProps\) => \(participantsVisible \? renderSheetBackdrop\(props\) : null\)/,
  )
  assert.match(
    callScreen,
    /const renderControlsBackdrop = useCallback\(\s*\(props: BottomSheetBackdropProps\) => \(controlsVisible \? renderSheetBackdrop\(props\) : null\)/,
  )
  assert.match(callScreen, /backdropComponent=\{renderParticipantsBackdrop\}/)
  assert.match(callScreen, /backdropComponent=\{renderControlsBackdrop\}/)
  assert.doesNotMatch(callScreen, /backdropComponent=\{renderSheetBackdrop\}/)
})

test('invite cooldowns expire while the people sheet is open', () => {
  // The cooldown compares against nowMs; it used to tick only while
  // reconnecting, so "Invite again" stayed disabled for the whole call.
  assert.match(
    callScreen,
    /if \(!isReconnecting && !participantsVisible\) return\s*setNowMs\(Date\.now\(\)\)\s*const intervalId = setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/,
  )
  assert.match(callScreen, /\}, \[participantsVisible, phase, reconnectDeadlineMs\]\)/)
  assert.match(callScreen, /Date\.parse\(invite\.sentAt\) \+ 10_000 > nowMs/)
})

test('stale invite feedback is dropped once the invitation moves on', () => {
  assert.match(callScreen, /next\[userId\] = `\$\{invite\.invitationId\}:\$\{invite\.status\}`/)
  // A fresh ringing invitation keeps its "Invite sent" confirmation; only a
  // later status (declined, missed, left) drops it.
  assert.match(
    callScreen,
    /previous\[userId\] !== undefined &&\s*previous\[userId\] !== next\[userId\] &&\s*invite\.status !== 'ringing'\s*\)\s*changed\.push\(userId\)/,
  )
  // An in-flight request keeps its "Sending…" state until it resolves.
  assert.match(callScreen, /if \(updated\[userId\] !== 'Sending…'\) delete updated\[userId\]/)
  assert.match(callScreen, /\}, \[groupInvitations\]\)/)
})
