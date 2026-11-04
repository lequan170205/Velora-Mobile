const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const load = (file, deps) => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  if (
    file === 'src/lib/auth/tokenSession.ts' &&
    !deps['@react-native-async-storage/async-storage']
  ) {
    const data = new Map()
    deps['@react-native-async-storage/async-storage'] = {
      getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => {
        data.set(key, value)
      },
      removeItem: async (key) => {
        data.delete(key)
      },
    }
  }
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (!(name in deps)) throw new Error(`Unexpected ${name}`)
      return deps[name]
    },
    module,
    module.exports,
  )
  return module.exports
}

async function setup() {
  const values = new Map()
  const storage = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value)
    },
    deleteItemAsync: async (key) => {
      values.delete(key)
    },
  }
  const { authTokenSession: session } = load('src/lib/auth/tokenSession.ts', {
    'expo-secure-store': storage,
    '../uuid': { createUuid: () => 'refresh-id' },
  })
  await session.installTokenPair({ accessToken: 'alice-old', refreshToken: 'alice-refresh' })
  assert.equal(session.bindIdentity('alice', session.getGeneration()), true)
  let viewer = 'alice',
    subscriber,
    requestInterceptor,
    responseError,
    resolveRefresh,
    rejectRefresh
  const retryRequests = []
  const client = async (config) => {
    requestInterceptor(config)
    retryRequests.push(config.headers.value)
    return { data: { items: [], nextCursor: null } }
  }
  client.interceptors = {
    request: {
      use: (handler) => {
        requestInterceptor = handler
      },
    },
    response: {
      use: (_, handler) => {
        responseError = handler
      },
    },
  }
  client.post = async (url) => {
    if (url !== '/auth/mobile/refresh') throw new Error('unexpected route')
    return new Promise((resolve, reject) => {
      resolveRefresh = resolve
      rejectRefresh = reject
    })
  }
  client.get = async () => ({ data: { items: [], nextCursor: null } })
  const clientModule = load('src/api/client.ts', {
    axios: { create: () => client, isAxiosError: (error) => !!error.isAxiosError },
    '../lib/auth/tokenSession': { authTokenSession: session },
  })
  const store = {
    getState: () => ({ user: viewer ? { id: viewer } : null }),
    subscribe: (fn) => {
      subscriber = fn
    },
  }
  const comments = load('src/api/reelComments.api.ts', {
    '../constants/queryKeys': {
      queryKeys: { reels: { allSeriesEpisodePages: (id) => ['reels', id, 'series-episodes'] } },
    },
    './client': clientModule,
    '../stores/authStore': { useAuthStore: store },
    '../lib/auth/tokenSession': { authTokenSession: session },
  })
  const scope = comments.commentScope('alice')
  const config = {
    url: '/content/reels/r/comments',
    commentSessionGuard: scope,
    headers: {
      set: (_, value) => {
        config.headers.value = value
      },
    },
  }
  const start401 = async () => {
    const request = responseError({ config, response: { status: 401 } })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(typeof resolveRefresh, 'function')
    return { request, resolveRefresh, rejectRefresh }
  }
  return {
    session,
    comments,
    scope,
    config,
    retryRequests,
    start401,
    switchViewer: (next) => {
      const previous = store.getState()
      viewer = next
      subscriber(store.getState(), previous)
    },
  }
}

test('same session rotations keep the comment scope and 401 refresh retries with the new token', async () => {
  const h = await setup()
  const generation = h.session.getGeneration()
  assert.equal(
    await h.session.rotateTokenPair(
      { accessToken: 'alice-rotated', refreshToken: 'alice-r2' },
      generation,
    ),
    true,
  )
  assert.equal(h.scope(), true)
  await h.comments.reelCommentsApi.list(h.scope, 'r', null)
  const { request, resolveRefresh } = await h.start401()
  resolveRefresh({ data: { accessToken: 'alice-new', refreshToken: 'alice-r3' } })
  await request
  assert.deepEqual(h.retryRequests, ['Bearer alice-new'])
  assert.equal(h.scope(), true)
})

test('login during refresh prevents stale credentials, retry, and account cache population', async () => {
  const h = await setup()
  const { request, resolveRefresh } = await h.start401()
  await h.session.installTokenPair({ accessToken: 'bob-token', refreshToken: 'bob-refresh' })
  h.switchViewer('bob')
  resolveRefresh({ data: { accessToken: 'alice-new', refreshToken: 'alice-r2' } })
  await assert.rejects(request)
  assert.equal(h.scope(), false)
  assert.deepEqual(h.retryRequests, [])
  assert.equal(h.session.getAccessToken(), 'bob-token')
  assert.equal(await h.session.getRefreshToken(), 'bob-refresh')
})

test('superseding login fences a refresh already writing secure storage', async () => {
  const values = new Map()
  let release, started
  const startedWrite = new Promise((resolve) => {
    started = resolve
  })
  const storage = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: async (key) => values.get(key) ?? null,
    deleteItemAsync: async (key) => {
      values.delete(key)
    },
    setItemAsync: async (key, value) => {
      if (value === 'alice-rotated') {
        started()
        await new Promise((resolve) => {
          release = resolve
        })
      }
      values.set(key, value)
    },
  }
  const { authTokenSession: session } = load('src/lib/auth/tokenSession.ts', {
    'expo-secure-store': storage,
    '../uuid': { createUuid: () => 'id' },
  })
  await session.installTokenPair({ accessToken: 'alice', refreshToken: 'alice-r' })
  const oldGeneration = session.getGeneration()
  const rotation = session.rotateTokenPair(
    { accessToken: 'alice-new', refreshToken: 'alice-rotated' },
    oldGeneration,
  )
  await startedWrite
  const login = session.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' })
  release()
  assert.equal(await rotation, false)
  await login
  assert.equal(session.getAccessToken(), 'bob')
  assert.equal(await session.getRefreshToken(), 'bob-r')
})

test('a stale unauthorized refresh cannot clear a newer login', async () => {
  const h = await setup()
  const { request, rejectRefresh } = await h.start401()
  await h.session.installTokenPair({ accessToken: 'bob-token', refreshToken: 'bob-refresh' })
  h.switchViewer('bob')
  rejectRefresh({ isAxiosError: true, response: { status: 401 } })
  await assert.rejects(request)
  assert.equal(h.session.getAccessToken(), 'bob-token')
  assert.equal(await h.session.getRefreshToken(), 'bob-refresh')
})

test('in-flight logout does not clear a newer login or report success', async () => {
  const values = new Map()
  const storage = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value)
    },
    deleteItemAsync: async (key) => {
      values.delete(key)
    },
  }
  const { authTokenSession: session } = load('src/lib/auth/tokenSession.ts', {
    'expo-secure-store': storage,
    '../uuid': { createUuid: () => 'id' },
  })
  await session.installTokenPair({ accessToken: 'alice', refreshToken: 'alice-r' })
  let finishLogout
  const apiClient = {
    post: async (url) => {
      assert.equal(url, '/auth/mobile/logout')
      return new Promise((resolve) => {
        finishLogout = resolve
      })
    },
  }
  const { authApi } = load('src/api/auth.api.ts', {
    '../lib/auth/tokenSession': { authTokenSession: session },
    './client': {
      apiClient,
      beginLogout: async () => {},
      endLogout: () => {},
      refreshAccessToken: async () => null,
    },
  })
  const logout = authApi.logout()
  await new Promise((resolve) => setImmediate(resolve))
  await session.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' })
  finishLogout({ data: { message: 'ok' } })
  await assert.rejects(logout, /session changed/)
  assert.equal(session.getAccessToken(), 'bob')
  assert.equal(await session.getRefreshToken(), 'bob-r')
})

test('delayed logout cleanup cannot clear the newer login from auth state', async () => {
  const h = await setup()
  const logoutGeneration = h.session.getGeneration()
  await h.session.clear(logoutGeneration)
  await h.session.installTokenPair({ accessToken: 'bob-token', refreshToken: 'bob-refresh' })
  let authCleared = false
  assert.equal(
    h.session.finishLogout(logoutGeneration, () => {
      authCleared = true
    }),
    false,
  )
  assert.equal(authCleared, false)
  assert.equal(h.session.getAccessToken(), 'bob-token')
})

test('completed logout clears auth state when no newer session exists', async () => {
  const h = await setup()
  const logoutGeneration = h.session.getGeneration()
  await h.session.clear(logoutGeneration)
  let authCleared = false
  assert.equal(
    h.session.finishLogout(logoutGeneration, () => {
      authCleared = true
    }),
    true,
  )
  assert.equal(authCleared, true)
})

test('same-user new login requires fresh identity proof and creates a usable new comment scope', async () => {
  const h = await setup()
  const oldScope = h.scope
  await h.session.installTokenPair({ accessToken: 'alice-login', refreshToken: 'alice-new-r' })
  assert.equal(oldScope(), false)
  assert.equal(h.comments.commentScope('alice')(), false)
  const { authApi } = load('src/api/auth.api.ts', {
    '../lib/auth/tokenSession': { authTokenSession: h.session },
    './client': {
      apiClient: {
        get: async () => ({
          data: {
            id: 'alice',
            email: 'alice@example.com',
            fullName: 'Alice',
            roles: [],
            isVerified: true,
          },
        }),
      },
      beginLogout: async () => {},
      endLogout: () => {},
      refreshAccessToken: async () => null,
    },
  })
  assert.equal((await authApi.me()).id, 'alice')
  const newScope = h.comments.commentScope('alice')
  assert.equal(newScope(), true)
  assert.notEqual(newScope.version, oldScope.version)
  assert.equal(oldScope(), false)
  await h.comments.reelCommentsApi.list(newScope, 'r', null)
})

test('an old me response cannot bind a newer account token to the old identity', async () => {
  const h = await setup()
  let resolveMe
  const { authApi } = load('src/api/auth.api.ts', {
    '../lib/auth/tokenSession': { authTokenSession: h.session },
    './client': {
      apiClient: {
        get: () =>
          new Promise((resolve) => {
            resolveMe = resolve
          }),
      },
      beginLogout: async () => {},
      endLogout: () => {},
      refreshAccessToken: async () => null,
    },
  })
  const pending = authApi.me()
  await h.session.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' })
  resolveMe({ data: { id: 'alice', email: 'a@example.com', roles: [] } })
  await assert.rejects(pending, /session changed/)
  assert.equal(h.session.getIdentity(), null)
  assert.equal(h.comments.commentScope('alice')(), false)
})

test('new login closes the old token immediately until secure storage commits', async () => {
  const values = new Map()
  let release, started
  const began = new Promise((resolve) => {
    started = resolve
  })
  const storage = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: async (key) => values.get(key) ?? null,
    deleteItemAsync: async (key) => {
      values.delete(key)
    },
    setItemAsync: async (key, value) => {
      if (value === 'bob-r') {
        started()
        await new Promise((resolve) => {
          release = resolve
        })
      }
      values.set(key, value)
    },
  }
  const { authTokenSession: session } = load('src/lib/auth/tokenSession.ts', {
    'expo-secure-store': storage,
    '../uuid': { createUuid: () => 'id' },
  })
  await session.installTokenPair({ accessToken: 'alice', refreshToken: 'alice-r' })
  assert.equal(session.bindIdentity('alice', session.getGeneration()), true)
  const login = session.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' })
  assert.equal(session.getAccessToken(), null)
  assert.equal(session.getIdentity(), null)
  assert.equal(session.isTransitioning(), true)
  await began
  assert.equal(session.getAccessToken(), null)
  release()
  await login
  assert.equal(session.getAccessToken(), 'bob')
  assert.equal(session.getIdentity(), null)
  assert.equal(session.isTransitioning(), false)
})

test('failed credential write releases transition and blocks stale restoration until a successful login', async () => {
  const values = new Map()
  let fail = false
  const storage = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: async (key) => values.get(key) ?? null,
    deleteItemAsync: async (key) => {
      values.delete(key)
    },
    setItemAsync: async (key, value) => {
      if (fail) throw new Error('disk failure')
      values.set(key, value)
    },
  }
  const { authTokenSession: session } = load('src/lib/auth/tokenSession.ts', {
    'expo-secure-store': storage,
    '../uuid': { createUuid: () => 'id' },
  })
  await session.installTokenPair({ accessToken: 'alice', refreshToken: 'alice-r' })
  fail = true
  await assert.rejects(
    session.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' }),
    /disk failure/,
  )
  assert.equal(session.isTransitioning(), false)
  assert.equal(session.getAccessToken(), null)
  assert.equal(session.getIdentity(), null)
  assert.equal(await session.canRestore(), false)
  let requests = 0
  let requestHandler
  const client = () => Promise.resolve({ data: {} })
  client.interceptors = {
    request: {
      use: (fn) => {
        requestHandler = fn
      },
    },
    response: { use: () => {} },
  }
  client.post = async () => {
    requests++
    return { data: {} }
  }
  const api = load('src/api/client.ts', {
    axios: { create: () => client, isAxiosError: () => false },
    '../lib/auth/tokenSession': { authTokenSession: session },
  })
  assert.equal(await api.refreshAccessToken(), null)
  assert.equal(requests, 0)
  const publicConfig = { url: '/auth/register', headers: { set: () => assert.fail('stale token') } }
  assert.equal(requestHandler(publicConfig), publicConfig)
  fail = false
  await session.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' })
  assert.equal(await session.canRestore(), true)
  assert.equal(session.getAccessToken(), 'bob')
})

test('failed credential deletion releases transition without restoring the previous token', async () => {
  const values = new Map()
  let fail = false
  const storage = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value)
    },
    deleteItemAsync: async (key) => {
      if (fail) throw new Error('delete failure')
      values.delete(key)
    },
  }
  const { authTokenSession: session } = load('src/lib/auth/tokenSession.ts', {
    'expo-secure-store': storage,
    '../uuid': { createUuid: () => 'id' },
  })
  await session.installTokenPair({ accessToken: 'alice', refreshToken: 'alice-r' })
  fail = true
  await assert.rejects(session.clear(), /delete failure/)
  assert.equal(session.isTransitioning(), false)
  assert.equal(await session.canRestore(), false)
  assert.equal(session.getAccessToken(), null)
  fail = false
  await session.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' })
  assert.equal(await session.canRestore(), true)
})

test('logout cleanup completes before a newer login can install credentials or data', async () => {
  const h = await setup()
  const previous = h.session.getGeneration()
  await h.session.clear(previous)
  let finishCleanup, cleanupStarted
  const started = new Promise((resolve) => {
    cleanupStarted = resolve
  })
  const events = []
  const cleanup = h.session.runLogoutCleanup(previous, async () => {
    events.push('cleanup-start')
    cleanupStarted()
    await new Promise((resolve) => {
      finishCleanup = resolve
    })
    events.push('cleanup-end')
  })
  await started
  let loginFinished = false
  const login = h.session
    .installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' })
    .then(() => {
      events.push('login-ready')
      loginFinished = true
    })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(loginFinished, false)
  assert.equal(h.session.getAccessToken(), null)
  finishCleanup()
  assert.equal(await cleanup, false)
  await login
  assert.deepEqual(events, ['cleanup-start', 'cleanup-end', 'login-ready'])
  assert.equal(h.session.getAccessToken(), 'bob')
})

test('logout cleanup is skipped if a newer login already started', async () => {
  const h = await setup()
  const previous = h.session.getGeneration()
  await h.session.clear(previous)
  await h.session.installTokenPair({ accessToken: 'bob', refreshToken: 'bob-r' })
  let called = false
  assert.equal(
    await h.session.runLogoutCleanup(previous, async () => {
      called = true
    }),
    false,
  )
  assert.equal(called, false)
})
