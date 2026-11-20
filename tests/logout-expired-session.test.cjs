const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

global.__DEV__ = false

const root = path.resolve(__dirname, '..')
const load = (file, mocks) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS },
    fileName: file,
  }).outputText
  const result = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    (name) => (Object.hasOwn(mocks, name) ? mocks[name] : require(name)),
    result,
    result.exports,
  )
  return result.exports
}

class MissingRefreshTokenError extends Error {}

const logoutHarness = (logoutError) => {
  const storage = new Map()
  const calls = []
  let generation = 7
  const authTokenSession = {
    getGeneration: () => generation,
    clear: async (expected) => {
      calls.push(['clear', expected])
      if (expected !== generation) throw new Error('Auth session changed')
      generation += 1
    },
  }
  const { performLogoutPushTokenCleanup, getPendingLogoutPushTokenCleanup } = load(
    'src/lib/notifications/pushTokenLifecycle.ts',
    {
      '../../api/auth.api': {
        MissingRefreshTokenError,
        authApi: {
          logout: async () => {
            calls.push(['logout'])
            throw logoutError
          },
        },
      },
      '../../utils/storage': {
        save: async (key, value) => storage.set(key, value),
        getValueFor: async (key) => storage.get(key) ?? null,
        deleteValueFor: async (key) => storage.delete(key),
      },
      '../auth/tokenSession': { authTokenSession },
      '../systemCalls/veloraSystemCalls': {
        veloraSystemCalls: { getVoipRegistrationState: () => ({ token: null }) },
      },
      './fcm': {
        getCurrentFcmToken: async () => 'fcm-token',
        deleteCurrentFcmToken: async () => calls.push(['delete-local-fcm']),
        maskNotificationToken: () => 'masked',
      },
      './pushTokenOperationState': {
        blockPushTokenRegistration: async () => {},
        getOrCreatePushTokenInstallationId: async () => 'device-1',
        nextPushTokenLifecycleVersion: async () => 1,
      },
    },
  )
  return {
    calls,
    getGeneration: () => generation,
    performLogoutPushTokenCleanup,
    getPendingLogoutPushTokenCleanup,
  }
}

const axiosError = (status) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: status === undefined ? undefined : { status },
  })

for (const [label, error] of [
  ['the server rejects the expired session (401)', axiosError(401)],
  ['the server forbids the revoked session (403)', axiosError(403)],
  ['no refresh token is stored any more', new MissingRefreshTokenError()],
]) {
  test(`sign-out clears the local session when ${label}`, async () => {
    const harness = logoutHarness(error)
    const result = await harness.performLogoutPushTokenCleanup()

    assert.equal(result.ok, true)
    assert.deepEqual(harness.calls, [['delete-local-fcm'], ['logout'], ['clear', 7]])
    // finishLogout() in Settings needs exactly one generation bump.
    assert.equal(harness.getGeneration(), 8)
    // Without a session the server can never take the cleanup; the local FCM
    // token is already deleted, so no retry loop is left behind.
    assert.equal(await harness.getPendingLogoutPushTokenCleanup(), null)
  })
}

test('sign-out stays retryable when the logout request never reached the server', async () => {
  const harness = logoutHarness(axiosError(undefined))
  const result = await harness.performLogoutPushTokenCleanup()

  assert.equal(result.ok, false)
  assert.deepEqual(harness.calls, [['delete-local-fcm'], ['logout']])
  assert.equal(harness.getGeneration(), 7)
  assert.equal((await harness.getPendingLogoutPushTokenCleanup())?.fcmToken, 'fcm-token')
})

test('sign-out stays retryable on a server error', async () => {
  const harness = logoutHarness(axiosError(503))
  const result = await harness.performLogoutPushTokenCleanup()

  assert.equal(result.ok, false)
  assert.equal(harness.getGeneration(), 7)
})
