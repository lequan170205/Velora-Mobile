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

  return { clientRequests, createConfig, responseErrorHandler }
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

test('API requests time out and session restoration always renders a visible state', () => {
  const { createConfig } = loadApiClient({ post: () => Promise.resolve({ data: {} }) })
  const authProvider = fs.readFileSync(
    path.join(root, 'src', 'providers', 'AuthProvider.tsx'),
    'utf8',
  )

  assert.equal(createConfig.timeout, 10_000)
  assert.match(authProvider, /function AuthLoadingScreen\(\)/)
  assert.match(authProvider, /function AuthNetworkErrorScreen/)
  assert.match(authProvider, /onRetry=\{\(\) => void hydrateAuth\(\)\}/)
  assert.doesNotMatch(authProvider, /return null \/\/ or a global loading splash screen/)
})
