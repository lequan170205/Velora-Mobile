const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const read = (...parts) => readFileSync(join(__dirname, '..', ...parts), 'utf8')

test('a recipient device tells the caller it is ringing, by socket and after a push-first call', () => {
  const provider = read('src', 'providers', 'CallProvider.tsx')
  assert.match(provider, /socketRef\.current\?\.emit\('call_ringing', \{ callId: payload\.callId \}\)/)
  assert.match(
    provider,
    /ringing\.phase === 'incoming_ringing' && ringing\.callId[\s\S]{0,80}socket\.emit\('call_ringing', \{ callId: ringing\.callId \}\)/,
  )
})

test('only the outgoing side of the current call reacts to call_ringing, and only once', () => {
  const provider = read('src', 'providers', 'CallProvider.tsx')
  const handler = provider.slice(provider.indexOf('const handleCallRinging'), provider.indexOf('const handleCallAnswered'))
  assert.match(handler, /state\.direction !== 'outgoing'/)
  assert.match(handler, /state\.callId !== payload\.callId/)
  assert.match(handler, /state\.remoteRinging/)
  assert.match(handler, /patch\(\{ remoteRinging: true \}\)/)
  assert.match(provider, /socket\.on\('call_ringing', handleCallRinging\)/)
  assert.match(provider, /socket\.off\('call_ringing', handleCallRinging\)/)
})

test('a new outgoing call starts as connecting, and the store resets the flag', () => {
  assert.match(read('src', 'providers', 'CallProvider.tsx'), /direction: 'outgoing',\s*remoteRinging: false/)
  assert.match(read('src', 'stores', 'callStore.ts'), /remoteRinging: false/)
})

test('the call screen says Connecting until the callee rings, then Ringing, and plays the ringback tone only while ringing', () => {
  const screen = read('app', 'call', '[id].tsx')
  assert.match(screen, /phase === 'outgoing_ringing'\) return remoteRinging \? 'Ringing…' : 'Connecting…'/)
  assert.match(screen, /remoteRinging \? 'Ringing…' : 'Waiting for others to join…'/)
  assert.match(screen, /useRingbackTone\(\s*remoteRinging &&/)
})

test('the ringback hook loops a bundled tone, never touches the audio session and tolerates a missing module', () => {
  const hook = read('src', 'lib', 'call', 'useRingbackTone.ts')
  assert.match(hook, /assets\/sounds\/ringback\.wav/)
  assert.match(hook, /isLooping: true/)
  assert.doesNotMatch(hook, /setAudioModeAsync/)
  assert.match(hook, /unloadAsync/)
  assert.match(hook, /catch\(\(\) => undefined\)/)
})
