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

test('group host skips the one-to-one answer wait and guests ignore peer-left teardown', () => {
  const provider = read('src/providers/CallProvider.tsx')
  const callScreen = read('app/call/[id].tsx')
  const recovery = read('src/lib/call/useCallRecoveryRuntime.ts')
  assert.match(provider, /joined\.session\.isGroupCall\s*\? 'answered'/)
  assert.match(provider, /if \(useCallStore\.getState\(\)\.isGroupCall\) return/)
  assert.match(provider, /payload\.session\.isGroupCall === true/)
  assert.match(provider, /const armGroupInvitationTimeout = useCallback/)
  assert.match(provider, /teardownOnce\('group_invitation_expired'\)/)
  assert.match(callScreen, /\) : !isGroupCall \? \(/)
  assert.match(recovery, /if \(state\.isGroupCall\) return/)
  assert.match(recovery, /if \(useCallStore\.getState\(\)\.isGroupCall\) return/)
})
