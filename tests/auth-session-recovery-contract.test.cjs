const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

const loadApiClient = ({ post }) => {
  const clientRequests = []
  let createConfig
  let responseErrorHandler

  const apiClient = (request) => {
    clientRequests.push(request)
    return Promise.resolve({ data: {} })
  }
  apiClient.post = post
  apiClient.interceptors = {
    response: {
      use: (_onFulfilled, onRejected) => {
        responseErrorHandler = onRejected
      },
    },
  }

  const source = fs.readFileSync(path.join(root, 'src', 'api', 'client.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const loadedModule = { exports: {} }
  const axiosMock = {
    create: (config) => {
      createConfig = config
      return apiClient
    },
  }

  new Function('require', 'module', 'exports', compiled)(
    (specifier) => (specifier === 'axios' ? axiosMock : require(specifier)),
    loadedModule,
    loadedModule.exports,
  )

  return {
    apiClientModule: loadedModule.exports,
    clientRequests,
    createConfig,
    responseErrorHandler,
  }
}

const loadAuthStore = ({ me, resumePushTokenRegistration }) => {
  let state
  const create = (initializer) => {
    const set = (partial) => {
      const nextState = typeof partial === 'function' ? partial(state) : partial
      state = { ...state, ...nextState }
    }

    state = initializer(set)
    const store = (selector) => selector(state)
    store.getState = () => state
    return store
  }
  const source = fs.readFileSync(path.join(root, 'src', 'stores', 'authStore.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const loadedModule = { exports: {} }

  new Function('require', 'module', 'exports', compiled)(
    (specifier) => {
      if (specifier === 'axios') {
        return { isAxiosError: (error) => Boolean(error?.isAxiosError) }
      }
      if (specifier === 'zustand') return { create }
      if (specifier === '../api/auth.api') return { authApi: { me } }
      if (specifier === '../lib/notifications/pushTokenOperationState') {
        return { resumePushTokenRegistration }
      }

      throw new Error(`Unexpected module: ${specifier}`)
    },
    loadedModule,
    loadedModule.exports,
  )

  return loadedModule.exports.useAuthStore
}

test('concurrent 401 responses share one refresh request before retrying', async () => {
  let refreshCalls = 0
  let resolveRefresh
  const refreshPromise = new Promise((resolve) => {
    resolveRefresh = resolve
  })
  const { clientRequests, responseErrorHandler } = loadApiClient({
    post: () => {
      refreshCalls += 1
      return refreshPromise
    },
  })
  const unauthorizedRequest = () => ({
    config: { url: '/conversations' },
    response: { status: 401 },
  })

  const firstRequest = responseErrorHandler(unauthorizedRequest())
  const secondRequest = responseErrorHandler(unauthorizedRequest())

  assert.equal(refreshCalls, 1)

  resolveRefresh({ data: {} })
  await Promise.all([firstRequest, secondRequest])

  assert.equal(clientRequests.length, 2)
})

test('concurrent session hydration shares one identity request and push-token resume', async () => {
  const meResolvers = []
  let meCalls = 0
  let resumePushTokenCalls = 0
  const session = {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'Velora',
    lastName: 'User',
    picture: null,
    role: 'USER',
    isEmailVerified: true,
  }
  const authStore = loadAuthStore({
    me: () => {
      meCalls += 1
      return new Promise((resolve) => meResolvers.push(resolve))
    },
    resumePushTokenRegistration: async () => {
      resumePushTokenCalls += 1
    },
  })

  const firstHydration = authStore.getState().hydrateAuth()
  const secondHydration = authStore.getState().hydrateAuth()

  assert.equal(meCalls, 1)

  meResolvers[0](session)
  await Promise.all([firstHydration, secondHydration])

  assert.equal(resumePushTokenCalls, 1)
  assert.deepEqual(authStore.getState().user, session)
  assert.equal(authStore.getState().isAuthenticated, true)
  assert.equal(authStore.getState().isLoading, false)

  const silentHydration = authStore.getState().hydrateAuth({ silent: true })
  assert.equal(meCalls, 2)
  assert.equal(authStore.getState().isLoading, false)

  const retryHydration = authStore.getState().hydrateAuth()
  assert.equal(meCalls, 2)
  assert.equal(authStore.getState().isLoading, true)

  meResolvers[1](session)
  await Promise.all([silentHydration, retryHydration])
  assert.equal(resumePushTokenCalls, 2)
})

test('logout invalidates an in-flight hydration before it can restore auth state', async () => {
  const meResolvers = []
  let resolvePushTokenResume
  let markPushTokenResumeStarted
  const pushTokenResumeStarted = new Promise((resolve) => {
    markPushTokenResumeStarted = resolve
  })
  const authStore = loadAuthStore({
    me: () => new Promise((resolve) => meResolvers.push(resolve)),
    resumePushTokenRegistration: () => {
      markPushTokenResumeStarted()
      return new Promise((resolve) => {
        resolvePushTokenResume = resolve
      })
    },
  })
  const session = {
    id: 'old-user',
    email: 'old@example.com',
    firstName: 'Old',
    lastName: 'User',
    picture: null,
    role: 'USER',
    isEmailVerified: true,
  }

  const hydration = authStore.getState().hydrateAuth({ silent: true })
  meResolvers[0](session)
  await pushTokenResumeStarted

  authStore.getState().clearAuth()
  resolvePushTokenResume()
  await hydration

  assert.equal(authStore.getState().user, null)
  assert.equal(authStore.getState().isAuthenticated, false)
  assert.equal(authStore.getState().isLoading, false)
})

test('a fresh profile hydration wins over an older in-flight response', async () => {
  const meResolvers = []
  let meCalls = 0
  let resumePushTokenCalls = 0
  const authStore = loadAuthStore({
    me: () => {
      meCalls += 1
      return new Promise((resolve) => meResolvers.push(resolve))
    },
    resumePushTokenRegistration: async () => {
      resumePushTokenCalls += 1
    },
  })
  const staleSession = {
    id: 'profile-user',
    email: 'profile@example.com',
    firstName: 'Profile',
    lastName: 'User',
    picture: 'first-image',
    role: 'USER',
    isEmailVerified: true,
  }
  const freshSession = { ...staleSession, picture: 'latest-image' }

  const olderHydration = authStore.getState().hydrateAuth({ silent: true })
  const freshHydration = authStore.getState().hydrateAuth({ silent: true, fresh: true })

  assert.equal(meCalls, 2)

  meResolvers[1](freshSession)
  await freshHydration
  meResolvers[0](staleSession)
  await olderHydration

  assert.equal(resumePushTokenCalls, 1)
  assert.equal(authStore.getState().user?.picture, 'latest-image')
})

test('logout waits for an active refresh and blocks later refresh attempts', async () => {
  let refreshCalls = 0
  let resolveRefresh
  const refreshPromise = new Promise((resolve) => {
    resolveRefresh = resolve
  })
  const { apiClientModule, responseErrorHandler } = loadApiClient({
    post: () => {
      refreshCalls += 1
      return refreshPromise
    },
  })
  const unauthorizedRequest = () => ({
    config: { url: '/conversations' },
    response: { status: 401 },
  })

  const requestAlreadyRefreshing = responseErrorHandler(unauthorizedRequest())
  const waitForRefreshBeforeLogout = apiClientModule.beginLogout()
  const requestDuringLogout = unauthorizedRequest()

  await assert.rejects(
    responseErrorHandler(requestDuringLogout),
    (error) => error === requestDuringLogout,
  )
  assert.equal(refreshCalls, 1)

  resolveRefresh({ data: {} })
  await Promise.all([requestAlreadyRefreshing, waitForRefreshBeforeLogout])
  apiClientModule.endLogout()
})

test('logout does not preflight /auth/me, which can re-create the access session', () => {
  const authApiSource = fs.readFileSync(path.join(root, 'src', 'api', 'auth.api.ts'), 'utf8')
  const logoutStart = authApiSource.indexOf('logout: async')
  const refreshStart = authApiSource.indexOf('refresh: async', logoutStart)
  const logoutSource = authApiSource.slice(logoutStart, refreshStart)

  assert.match(logoutSource, /await beginLogout\(\)/)
  assert.match(logoutSource, /finally \{\s*endLogout\(\)/)
  assert.doesNotMatch(logoutSource, /authApi\.me\(\)/)
})

test('API requests time out and session restoration always renders a visible state', () => {
  const { createConfig } = loadApiClient({ post: () => Promise.resolve({ data: {} }) })
  const authProvider = fs.readFileSync(
    path.join(root, 'src', 'providers', 'AuthProvider.tsx'),
    'utf8',
  )

  assert.equal(createConfig.timeout, 10_000)
  assert.match(authProvider, /function AuthLoadingScreen\(/)
  assert.match(authProvider, /function AuthNetworkErrorScreen/)
  assert.match(authProvider, /onRetry=\{\(\) => void hydrateAuth\(\)\}/)
  assert.doesNotMatch(authProvider, /return null \/\/ or a global loading splash screen/)
})

test('session recovery delays the visible check-in fallback across native and JavaScript reloads', () => {
  const rootLayout = fs.readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8')
  const authProvider = fs.readFileSync(
    path.join(root, 'src', 'providers', 'AuthProvider.tsx'),
    'utf8',
  )
  const loadingScreenStart = authProvider.indexOf('function AuthLoadingScreen')
  const networkErrorScreenStart = authProvider.indexOf('function AuthNetworkErrorScreen')
  const loadingScreen = authProvider.slice(loadingScreenStart, networkErrorScreenStart)

  assert.notEqual(loadingScreenStart, -1)
  assert.notEqual(networkErrorScreenStart, -1)
  assert.match(authProvider, /export const AUTH_LOADING_FALLBACK_DELAY_MS = 400/)
  assert.match(authProvider, /const isAuthPending = isLoading \|\| !rootNavigationState\?\.key/)
  assert.match(
    authProvider,
    /setTimeout\(\s*\(\) => setHasAuthLoadingDelayElapsed\(true\),\s*AUTH_LOADING_FALLBACK_DELAY_MS,?\s*\)/,
  )
  assert.match(
    authProvider,
    /if \(isAuthPending\) \{\s*return <AuthLoadingScreen showProgress=\{hasAuthLoadingDelayElapsed\} \/>\s*\}/,
  )
  assert.match(
    loadingScreen,
    /source=\{require\('\.\.\/\.\.\/assets\/images\/splash-icon\.png'\)\}/,
  )

  const progressStart = loadingScreen.indexOf('{showProgress ? (')
  const checkingTextStart = loadingScreen.indexOf('Checking your sign-in...')
  assert.ok(progressStart >= 0)
  assert.ok(loadingScreen.indexOf('<ActivityIndicator') > progressStart)
  assert.ok(checkingTextStart > progressStart)

  assert.match(
    rootLayout,
    /import \{ AUTH_LOADING_FALLBACK_DELAY_MS, AuthProvider \} from '\.\.\/src\/providers\/AuthProvider'/,
  )
  assert.doesNotMatch(rootLayout, /const AUTH_STARTUP_LOADING_DELAY_MS/)
  assert.match(rootLayout, /const isAuthLoading = useAuthStore\(\(state\) => state\.isLoading\)/)
  assert.match(
    rootLayout,
    /setTimeout\(\s*\(\) => setHasAuthStartupDelayElapsed\(true\),\s*AUTH_LOADING_FALLBACK_DELAY_MS,?\s*\)/,
  )
  assert.match(
    rootLayout,
    /isReelPlaybackVideoCacheReady &&\s*\(!isAuthLoading \|\| hasAuthStartupDelayElapsed\)/,
  )
})
