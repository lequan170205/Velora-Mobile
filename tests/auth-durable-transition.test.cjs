const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

function load(file, deps) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`)
      return deps[name]
    },
    module,
    module.exports,
  )
  return module.exports
}

function harness() {
  const secure = new Map(),
    markers = new Map()
  let failSecureSet = false,
    failSecureDelete = false,
    failMarkerWrite = false,
    failMarkerRead = false
  const storage = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: async (key) => secure.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (failSecureSet) throw new Error('secure write failed')
      secure.set(key, value)
    },
    deleteItemAsync: async (key) => {
      if (failSecureDelete) throw new Error('secure delete failed')
      secure.delete(key)
    },
  }
  const markerStorage = {
    getItem: async (key) => {
      if (failMarkerRead) throw new Error('marker read failed')
      return markers.get(key) ?? null
    },
    setItem: async (key, value) => {
      if (failMarkerWrite) throw new Error('marker write failed')
      markers.set(key, value)
    },
    removeItem: async (key) => {
      markers.delete(key)
    },
  }
  const session = () =>
    load('src/lib/auth/tokenSession.ts', {
      'expo-secure-store': storage,
      '@react-native-async-storage/async-storage': markerStorage,
      '../uuid': { createUuid: () => 'id' },
    }).authTokenSession
  return {
    session,
    secure,
    markers,
    setSecureSetFailure: (value) => {
      failSecureSet = value
    },
    setSecureDeleteFailure: (value) => {
      failSecureDelete = value
    },
    setMarkerWriteFailure: (value) => {
      failMarkerWrite = value
    },
    setMarkerReadFailure: (value) => {
      failMarkerRead = value
    },
  }
}

test('failed replacement leaves a durable marker that blocks old credentials after restart', async () => {
  const h = harness(),
    first = h.session()
  await first.installTokenPair({ accessToken: 'alice', refreshToken: 'alice-r' })
  h.setSecureSetFailure(true)
  await assert.rejects(
    first.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' }),
    /secure write failed/,
  )
  assert.equal(await first.canRestore(), false)
  assert.equal(await h.session().canRestore(), false)
  assert.equal(h.secure.get('velora.auth.refresh-token'), 'alice-r')
  h.setSecureSetFailure(false)
  const recovered = h.session()
  await recovered.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' })
  assert.equal(await h.session().canRestore(), true)
  assert.equal(h.secure.get('velora.auth.refresh-token'), 'bob-r')
})

test('successful remote logout clears visible auth despite deletion failure and blocks restart restoration', async () => {
  const h = harness(),
    session = h.session()
  await session.installTokenPair({ accessToken: 'alice', refreshToken: 'alice-r' })
  const generation = session.getGeneration()
  h.setSecureDeleteFailure(true)
  const { authApi } = load('src/api/auth.api.ts', {
    '../lib/auth/tokenSession': { authTokenSession: session },
    './client': {
      apiClient: { post: async () => ({ data: { message: 'ok' } }) },
      beginLogout: async () => {},
      endLogout: () => {},
      refreshAccessToken: async () => null,
    },
  })
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal((await authApi.logout()).message, 'ok')
  } finally {
    console.warn = warn
  }
  let visible = true
  assert.equal(
    session.finishLogout(generation, () => {
      visible = false
    }),
    true,
  )
  assert.equal(visible, false)
  assert.equal(session.getAccessToken(), null)
  assert.equal(await h.session().canRestore(), false)
})

test('failed transition marker write stays blocked after restart while marker reads work', async () => {
  const h = harness(),
    session = h.session()
  await session.installTokenPair({ accessToken: 'alice', refreshToken: 'alice-r' })
  h.setMarkerWriteFailure(true)
  await assert.rejects(
    session.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' }),
    /marker write failed/,
  )
  assert.equal(session.getAccessToken(), null)
  assert.equal(await session.canRestore(), false)
  assert.equal(h.secure.get('velora.auth.refresh-token'), 'alice-r')
  assert.equal(h.markers.has('velora.auth.transition-pending'), false)
  assert.equal(h.secure.get('velora.auth.transition-pending-secure'), '1')
  assert.equal(await h.session().canRestore(), false)
  h.setMarkerReadFailure(true)
  assert.equal(await h.session().canRestore(), false)
  h.setMarkerReadFailure(false)
  h.setMarkerWriteFailure(false)
  const recovered = h.session()
  await recovered.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' })
  assert.equal(await h.session().canRestore(), true)
  assert.equal(h.secure.has('velora.auth.transition-pending-secure'), false)
})

test('a delayed older login response cannot overwrite the latest login', async () => {
  const h = harness()
  const session = h.session()
  const responses = []
  const { authApi } = load('src/api/auth.api.ts', {
    '../lib/auth/tokenSession': { authTokenSession: session },
    './client': {
      apiClient: {
        post: () => new Promise((resolve) => responses.push(resolve)),
        get: async () => ({ data: {} }),
      },
      beginLogout: async () => {},
      endLogout: () => {},
      refreshAccessToken: async () => null,
    },
  })

  const olderLogin = authApi.login({ email: 'older@example.com' })
  const latestLogin = authApi.login({ email: 'latest@example.com' })
  responses[1]({ data: { accessToken: 'latest-access', refreshToken: 'latest-refresh' } })
  await latestLogin
  responses[0]({ data: { accessToken: 'older-access', refreshToken: 'older-refresh' } })

  await assert.rejects(olderLogin, /Login attempt superseded/)
  assert.equal(session.getAccessToken(), 'latest-access')
  assert.equal(await session.getRefreshToken(), 'latest-refresh')
})
