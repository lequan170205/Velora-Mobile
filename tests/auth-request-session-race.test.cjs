const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const axios = require('axios')

function createHarness() {
  let generation = 1,
    token = 'alice',
    transitioning = false,
    identity = 'alice',
    finishOriginal,
    refreshCalls = 0,
    calls = []
  const session = {
    getGeneration: () => generation,
    isTransitioning: () => transitioning,
    getIdentity: () => identity,
    getAccessToken: () => token,
    canRestore: () => true,
    waitForWrites: async () => {},
    getRefreshToken: async () => 'alice-refresh',
    getOrCreateRefreshRequestId: async () => 'id',
    rotateTokenPair: async (pair, expected) => {
      if (expected !== generation) return false
      token = pair.accessToken
      return true
    },
    clear: async () => {
      generation++
      token = null
    },
  }
  const adapter = (config) => {
    calls.push({ url: config.url, token: config.headers.get('Authorization') })
    if (config.url === '/auth/mobile/refresh') {
      refreshCalls++
      return Promise.resolve({
        data: { accessToken: 'alice-new', refreshToken: 'alice-next' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      })
    }
    if (calls.filter((x) => x.url === '/protected').length > 1)
      return Promise.resolve({
        data: 'retried',
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      })
    return new Promise((resolve, reject) => {
      finishOriginal = (status) =>
        status === 401
          ? reject({ config, response: { status: 401 } })
          : resolve({ data: 'private', status: 200, statusText: 'OK', headers: {}, config })
    })
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/api/client.ts'), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  const axiosMock = {
    create: (options) => axios.create({ ...options, adapter }),
    isAxiosError: axios.isAxiosError,
  }
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id === 'axios') return axiosMock
      if (id === '../lib/auth/tokenSession') return { authTokenSession: session }
      throw new Error(`Unexpected ${id}`)
    },
    module,
    module.exports,
  )
  return {
    client: module.exports.apiClient,
    finish: (status) => finishOriginal(status),
    switchAccount: () => {
      generation++
      token = 'bob'
    },
    closeSession: () => {
      generation++
      token = null
      identity = null
      transitioning = true
    },
    installUnverified: () => {
      token = 'bob'
      transitioning = false
    },
    getCalls: () => calls,
    getRefreshCalls: () => refreshCalls,
  }
}

test('delayed generic 401 cannot refresh or replay under a different account', async () => {
  const h = createHarness()
  const result = h.client.get('/protected')
  assert.equal(h.getCalls()[0].token, 'Bearer alice')
  h.switchAccount()
  h.finish(401)
  await assert.rejects(result, /Auth session changed/)
  assert.equal(h.getRefreshCalls(), 0)
  assert.equal(h.getCalls().length, 1)
})

test('delayed successful generic response is not delivered to the new session', async () => {
  const h = createHarness()
  const result = h.client.get('/protected')
  h.switchAccount()
  h.finish(200)
  await assert.rejects(result, /Auth session changed/)
})

test('generic requests still refresh and replay under the same session', async () => {
  const h = createHarness()
  const result = h.client.get('/protected')
  h.finish(401)
  assert.equal((await result).data, 'retried')
  assert.equal(h.getRefreshCalls(), 1)
  assert.deepEqual(
    h.getCalls().map((call) => call.token),
    ['Bearer alice', 'Bearer alice', 'Bearer alice-new'],
  )
})

test('protected calls fail closed during credential writes and before identity verification', async () => {
  const h = createHarness()
  h.closeSession()
  await assert.rejects(h.client.get('/protected'), /session changing/)
  assert.equal(h.getCalls().length, 0)
  h.installUnverified()
  await assert.rejects(h.client.get('/protected'), /identity not verified/)
  assert.equal(h.getCalls().length, 0)
})
