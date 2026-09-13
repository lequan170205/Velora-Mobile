const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

const compileModule = (relativePath, requireMock) => {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const loadedModule = { exports: {} }

  new Function('require', 'module', 'exports', compiled)(
    requireMock,
    loadedModule,
    loadedModule.exports,
  )
  return loadedModule.exports
}

test('token session persists only the refresh token before exposing the access token', async () => {
  const secureStoreCalls = []
  let storedRefreshToken = null
  let resolveWrite
  const writeGate = new Promise((resolve) => {
    resolveWrite = resolve
  })
  const SecureStore = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    getItemAsync: async () => storedRefreshToken,
    setItemAsync: async (key, value, options) => {
      secureStoreCalls.push({ operation: 'set', key, value, options })
      await writeGate
      storedRefreshToken = value
    },
    deleteItemAsync: async (key, options) => {
      secureStoreCalls.push({ operation: 'delete', key, options })
      storedRefreshToken = null
    },
  }
  const { authTokenSession } = compileModule('src/lib/auth/tokenSession.ts', (specifier) => {
    if (specifier === 'expo-secure-store') return SecureStore
    return require(specifier)
  })

  const install = authTokenSession.installTokenPair({
    accessToken: 'memory-only-access',
    refreshToken: 'persisted-refresh',
  })

  assert.equal(authTokenSession.getAccessToken(), null)
  assert.equal(secureStoreCalls.length, 1)
  assert.equal(secureStoreCalls[0].value, 'persisted-refresh')
  assert.notEqual(secureStoreCalls[0].value, 'memory-only-access')

  resolveWrite()
  await install

  assert.equal(authTokenSession.getAccessToken(), 'memory-only-access')
  assert.equal(await authTokenSession.getRefreshToken(), 'persisted-refresh')
  assert.equal(secureStoreCalls[0].key, 'velora.auth.refresh-token')
  assert.equal(
    secureStoreCalls[0].options.keychainAccessible,
    SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  )

  await authTokenSession.clear()
  assert.equal(authTokenSession.getAccessToken(), null)
  assert.equal(await authTokenSession.getRefreshToken(), null)
  assert.equal(secureStoreCalls.at(-1).operation, 'delete')
  assert.equal(secureStoreCalls.at(-1).key, 'velora.auth.refresh-token')
})

const loadAuthApi = ({ post, refreshToken = 'latest-refresh-token', refreshAccessToken }) => {
  const events = []
  let clearCalls = 0
  let hasAccessToken = false
  const installedPairs = []
  const authTokenSession = {
    getRefreshToken: async () => {
      events.push('read-refresh')
      return refreshToken
    },
    installTokenPair: async (pair) => {
      installedPairs.push(pair)
    },
    clear: async () => {
      clearCalls += 1
      events.push('clear')
    },
    hasAccessToken: () => hasAccessToken,
  }
  const apiClient = {
    post: async (...args) => post(...args),
    get: async () => ({ data: {} }),
  }
  const module = compileModule('src/api/auth.api.ts', (specifier) => {
    if (specifier === '../lib/auth/tokenSession') return { authTokenSession }
    if (specifier === './client') {
      return {
        apiClient,
        beginLogout: async () => {
          events.push('begin-logout')
        },
        endLogout: () => {
          events.push('end-logout')
        },
        refreshAccessToken: refreshAccessToken ?? (async () => null),
      }
    }
    return require(specifier)
  })

  return {
    authApi: module.authApi,
    events,
    getClearCalls: () => clearCalls,
    setHasAccessToken: (value) => {
      hasAccessToken = value
    },
    installedPairs,
  }
}

test('password and Google login use mobile endpoints and install returned token pairs', async () => {
  const calls = []
  const passwordPair = { accessToken: 'password-access', refreshToken: 'password-refresh' }
  const googlePair = { accessToken: 'google-access', refreshToken: 'google-refresh' }
  const { authApi, installedPairs } = loadAuthApi({
    post: async (url, body) => {
      calls.push({ url, body })
      return { data: url.includes('google') ? googlePair : passwordPair }
    },
  })

  await authApi.login({ email: 'user@example.com', password: 'secret' })
  await authApi.verifyGoogleToken({ idToken: 'google-id-token' })

  assert.deepEqual(
    calls.map((call) => call.url),
    ['/auth/mobile/login', '/auth/mobile/google/verify'],
  )
  assert.deepEqual(installedPairs, [passwordPair, googlePair])
})

test('logout waits first, sends the latest refresh token, then clears local credentials', async () => {
  let logoutBody
  const { authApi, events, getClearCalls } = loadAuthApi({
    refreshToken: 'rotated-refresh-token',
    post: async (url, body) => {
      events.push('post-logout')
      assert.equal(url, '/auth/mobile/logout')
      logoutBody = body
      return { data: { message: 'Logged out' } }
    },
  })

  await authApi.logout({
    pushTokens: [{ provider: 'fcm', token: 'push-token', lifecycleVersion: 7 }],
  })

  assert.equal(logoutBody.refreshToken, 'rotated-refresh-token')
  assert.equal(logoutBody.pushTokens[0].provider, 'fcm')
  assert.deepEqual(events, ['begin-logout', 'read-refresh', 'post-logout', 'clear', 'end-logout'])
  assert.equal(getClearCalls(), 1)
})

test('failed remote logout retains local auth credentials for retry', async () => {
  const remoteError = new Error('offline')
  const { authApi, events, getClearCalls } = loadAuthApi({
    post: async () => {
      events.push('post-logout')
      throw remoteError
    },
  })

  await assert.rejects(authApi.logout(), (error) => error === remoteError)

  assert.equal(getClearCalls(), 0)
  assert.deepEqual(events, ['begin-logout', 'read-refresh', 'post-logout', 'end-logout'])
})

test('session restoration skips rotation when an access token is already in memory', async () => {
  let refreshCalls = 0
  const loaded = loadAuthApi({
    post: async () => ({ data: {} }),
    refreshAccessToken: async () => {
      refreshCalls += 1
      return { accessToken: 'new-access', refreshToken: 'new-refresh' }
    },
  })
  loaded.setHasAccessToken(true)

  assert.equal(await loaded.authApi.restoreSession(), true)
  assert.equal(refreshCalls, 0)
})

test('session restoration reports a missing stored refresh token as logged out', async () => {
  const { authApi } = loadAuthApi({
    post: async () => ({ data: {} }),
    refreshAccessToken: async () => null,
  })

  assert.equal(await authApi.restoreSession(), false)
})
