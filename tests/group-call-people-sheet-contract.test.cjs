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
