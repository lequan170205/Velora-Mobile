const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const read = (...parts) => readFileSync(join(__dirname, '..', ...parts), 'utf8')

test('the chat socket is only torn down after a lasting offline state', () => {
  const provider = read('src', 'providers', 'SocketProvider.tsx')
  assert.match(provider, /const OFFLINE_DISCONNECT_GRACE_MS = 5000/)

  const effect = provider.slice(provider.indexOf('if (!isLinkUp) {'))
  const offlineBranch = effect.slice(0, effect.indexOf('if (socket.connected || socket.active)'))
  assert.match(
    offlineBranch,
    /setTimeout\(\(\) => \{[\s\S]*socket\.disconnect\(\)[\s\S]*\}, OFFLINE_DISCONNECT_GRACE_MS\)/,
  )
  assert.match(offlineBranch, /return \(\) => clearTimeout\(disconnectTimeoutId\)/)
  assert.doesNotMatch(
    offlineBranch.replace(/setTimeout\(\(\) => \{[\s\S]*?\}, OFFLINE_DISCONNECT_GRACE_MS\)/, ''),
    /socket\.disconnect\(\)/,
  )
})

test('the Reconnecting banner and presence label wait for a sustained socket gap', () => {
  const hook = read('src', 'hooks', 'useSustainedFlag.ts')
  assert.match(hook, /setTimeout\(\(\) => setSustained\(true\), delayMs\)/)
  assert.match(hook, /if \(!value\) \{\s*setSustained\(false\)/)

  const screen = read('app', 'conversation', '[id].tsx')
  assert.match(screen, /const RECONNECTING_BANNER_DELAY_MS = 3000/)
  assert.match(screen, /useSustainedFlag\(!isConnected, RECONNECTING_BANNER_DELAY_MS\)/)
  assert.match(screen, /useConversationPresence\(\{[\s\S]*?isConnected: !isReconnecting,/)
  assert.match(screen, /<ConversationHeader[\s\S]*?isConnected=\{!isReconnecting\}/)
})
