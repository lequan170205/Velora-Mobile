const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const read = (...parts) => readFileSync(join(__dirname, '..', ...parts), 'utf8')

test('the network context exposes a link flag that ignores the internet-reachable guess', () => {
  const network = read('src', 'providers', 'NetworkProvider.tsx')
  assert.match(
    network,
    /const isLinkUp = isNetworkResolved && networkState\?\.isConnected === true && !isForceOffline/,
  )
  assert.doesNotMatch(network.match(/const isLinkUp = .*/)[0], /isInternetReachable/)
  assert.match(network, /isLinkUp,\s*isNetworkResolved,/)
})

test('the chat socket connects on the link flag, not on OS reachability', () => {
  const provider = read('src', 'providers', 'SocketProvider.tsx')
  assert.match(provider, /const \{ isNetworkResolved, isLinkUp \} = useNetworkStatus\(\)/)

  const gateEffect = provider.slice(
    provider.indexOf('if (!isLinkUp) {'),
    provider.indexOf('socket.connect()\n  }, [isAuthenticated'),
  )
  assert.match(gateEffect, /if \(socket\.connected \|\| socket\.active\)/)
  assert.doesNotMatch(provider.slice(provider.indexOf('export function SocketProvider')), /!isOnline/)
})

test('coming back to the app retries a disconnected socket at once', () => {
  const provider = read('src', 'providers', 'SocketProvider.tsx')
  assert.match(provider, /import \{ AppState \} from 'react-native'/)

  const listener = provider.slice(provider.indexOf("AppState.addEventListener('change'"))
  const body = listener.slice(0, listener.indexOf('return () => subscription.remove()'))
  assert.match(body, /nextState !== 'active' \|\| socket\.connected \|\| !isLinkUpRef\.current/)
  assert.match(body, /socket\.disconnect\(\)\s*socket\.connect\(\)/)
})
