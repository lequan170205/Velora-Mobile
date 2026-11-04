const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const compile = (file) =>
  ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
const load = (code, dependencies) => {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`)
      return dependencies[id]
    },
    module,
    module.exports,
  )
  return module.exports
}

function setup() {
  let viewer = 'alice'
  let token = 'alice-token'
  let generation = 0
  let subscriber
  const calls = []
  let respond = async () => ({ data: { items: [], nextCursor: null } })
  const client = Object.fromEntries(
    ['get', 'post', 'patch', 'delete'].map((method) => [
      method,
      async (...args) => {
        calls.push([method, ...args])
        return respond()
      },
    ]),
  )
  const store = {
    getState: () => ({ user: viewer ? { id: viewer } : null }),
    subscribe: (fn) => {
      subscriber = fn
    },
  }
  let identity = 'alice'
  const session = {
    getAccessToken: () => token,
    getGeneration: () => generation,
    getIdentity: () => identity,
  }
  const api = load(compile('src/api/reelComments.api.ts'), {
    '../constants/queryKeys': {
      queryKeys: { reels: { allSeriesEpisodePages: (id) => ['reels', id, 'series-episodes'] } },
    },
    './client': { apiClient: client },
    '../stores/authStore': { useAuthStore: store },
    '../lib/auth/tokenSession': { authTokenSession: session },
  })
  const switchViewer = (next) => {
    const previous = store.getState()
    viewer = next
    identity = next
    subscriber(store.getState(), previous)
  }
  return {
    api,
    calls,
    switchViewer,
    setToken: (value, newSession = false) => {
      token = value
      if (newSession) {
        generation++
        identity = null
      }
    },
    setResponse: (fn) => {
      respond = fn
    },
  }
}

test('unresolved creates survive unmount and unrelated edits until that create succeeds', () => {
  const { api } = setup()
  let sequence = 0
  const next = () => `id-${++sequence}`
  const first = api.pendingCommentId('alice', 'reel', null, 'hello', next)
  api.pendingCommentId('alice', 'reel', 'parent', 'other', next)
  assert.equal(api.pendingCommentId('alice', 'reel', null, 'hello', next), first)
  assert.notEqual(api.pendingCommentId('bob', 'reel', null, 'hello', next), first)
  api.completePendingComment('alice', 'reel', 'parent', 'other', 'id-2')
  assert.equal(api.pendingCommentId('alice', 'reel', null, 'hello', next), first)
  api.completePendingComment('alice', 'reel', null, 'hello', first)
  assert.notEqual(api.pendingCommentId('alice', 'reel', null, 'hello', next), first)
})

test('comment drafts enter the first page immediately, settle with the server row, and roll back on error', () => {
  const { api } = setup()
  const existing = { id: 'existing', text: 'Older comment' }
  const optimistic = { id: 'pending:request-1', text: 'New comment' }
  const data = { pages: [{ items: [existing], nextCursor: 'older' }], pageParams: [null] }

  const inserted = api.prependComment(data, optimistic)
  assert.deepEqual(inserted.pages[0].items, [optimistic, existing])
  assert.equal(inserted.pages[0].nextCursor, 'older')

  const created = { id: 'server-1', text: 'New comment' }
  const settled = api.replacePendingComment(inserted, optimistic.id, created)
  assert.deepEqual(settled.pages[0].items, [created, existing])
  assert.deepEqual(settled.pageParams, [null])

  const rolledBack = api.removePendingComment(inserted, optimistic.id)
  assert.deepEqual(rolledBack.pages[0].items, [existing])
})

test('comment requests encode routes, preserve ids and fence account switches before dispatch and response', async () => {
  const { api, calls, switchViewer, setResponse, setToken } = setup()
  const scope = api.commentScope('alice')
  await api.reelCommentsApi.list(scope, 'reel/1', null, 'cursor')
  assert.equal(calls[0][1], '/content/reels/reel%2F1/comments')
  assert.equal(calls[0][2].params.cursor, 'cursor')
  await api.reelCommentsApi.create(scope, 'reel/1', 'root/1', 'hello', 'request-id')
  assert.equal(calls[1][1], '/content/reels/reel%2F1/comments/root%2F1/replies')
  assert.equal(calls[1][2].clientRequestId, 'request-id')
  const guard = calls[1][3].commentSessionGuard
  assert.equal(guard(), true)
  setToken('bob-token', true)
  assert.equal(guard(), false)
  assert.equal(api.commentScope('alice')(), false)
  switchViewer('bob')
  setToken('alice-token', true)
  switchViewer('alice')
  const currentScope = api.commentScope('alice')
  let resolve
  setResponse(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const inFlight = api.reelCommentsApi.list(currentScope, 'reel', null)
  switchViewer('bob')
  switchViewer('alice')
  resolve({ data: { items: [{ text: 'private' }], nextCursor: null } })
  await assert.rejects(inFlight, /session changed/)
  await assert.rejects(api.reelCommentsApi.list(currentScope, 'reel', null), /session changed/)
})

test('comment 401 never invokes shared refresh or retries with the new account', async () => {
  let requestHandler,
    responseError,
    retries = 0,
    refreshes = 0
  const client = () => {
    retries++
    return Promise.resolve()
  }
  client.interceptors = {
    request: {
      use: (fn) => {
        requestHandler = fn
      },
    },
    response: {
      use: (_, fn) => {
        responseError = fn
      },
    },
  }
  client.post = () => {
    refreshes++
    return Promise.resolve({ data: {} })
  }
  const session = {
    getAccessToken: () => 'bob-token',
    getGeneration: () => 1,
    getIdentity: () => 'bob',
    isTransitioning: () => false,
  }
  load(compile('src/api/client.ts'), {
    axios: { create: () => client, isAxiosError: () => false },
    '../lib/auth/tokenSession': { authTokenSession: session },
  })
  const config = {
    url: '/content/reels/r/comments',
    commentSessionGuard: () => false,
    headers: { set: () => assert.fail('must not attach token') },
  }
  assert.throws(() => requestHandler(config), /session changed/)
  const error = { config, response: { status: 401 } }
  await assert.rejects(responseError(error), (actual) => actual === error)
  assert.equal(retries, 0)
  assert.equal(refreshes, 0)
})

test('reel owners can delete, only authors can edit, and fresh feed count beats cached detail', () => {
  const { api } = setup()
  const comment = { author: { id: 'author' }, deletedAt: null }
  assert.deepEqual(api.commentPermissions(comment, 'owner', 'owner'), { edit: false, delete: true })
  assert.deepEqual(api.commentPermissions(comment, 'author', 'owner'), { edit: true, delete: true })
  assert.deepEqual(api.commentPermissions(comment, 'other', 'owner'), {
    edit: false,
    delete: false,
  })
  assert.deepEqual(api.commentPermissions({ ...comment, deletedAt: 'now' }, 'owner', 'owner'), {
    edit: false,
    delete: false,
  })
  assert.equal(api.commentCount(2, 10), 2)
  assert.equal(api.commentCount(0, 10), 0)
  assert.equal(api.commentCount(undefined, 10), 10)
})

test('authoritative count updates every matching Series episode page and invalidates them', async () => {
  const { api, setResponse } = setup()
  const scope = api.commentScope('alice')
  setResponse(async () => ({ data: { commentCount: 7 } }))
  const pages = [
    {
      items: [
        { id: 'reel', commentCount: 2 },
        { id: 'other', commentCount: 1 },
      ],
    },
  ]
  let data = { pages, pageParams: [null] },
    invalidated
  const client = {
    setQueriesData: (filter, updater) => {
      assert.deepEqual(filter.queryKey, ['reels', 'alice', 'series-episodes'])
      data = updater(data)
    },
    invalidateQueries: async (filter) => {
      invalidated = filter.queryKey
    },
  }
  assert.equal(await api.refreshSeriesCommentCount(client, 'alice', 'reel', scope), 7)
  assert.equal(data.pages[0].items[0].commentCount, 7)
  assert.equal(data.pages[0].items[1].commentCount, 1)
  assert.deepEqual(invalidated, ['reels', 'alice', 'series-episodes'])
  assert.equal(api.commentCount(data.pages[0].items[0].commentCount, 7), 7)
})

test('failed Series count fetch still invalidates, while a switched account cannot update cache', async () => {
  const h = setup()
  const scope = h.api.commentScope('alice')
  let writes = 0,
    invalidations = 0
  const client = {
    setQueriesData: () => {
      writes++
    },
    invalidateQueries: async () => {
      invalidations++
    },
  }
  h.setResponse(async () => {
    throw new Error('offline')
  })
  await assert.rejects(h.api.refreshSeriesCommentCount(client, 'alice', 'reel', scope), /offline/)
  assert.equal(invalidations, 1)
  let resolve
  h.setResponse(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = h.api.refreshSeriesCommentCount(client, 'alice', 'reel', scope)
  h.switchViewer('bob')
  resolve({ data: { commentCount: 7 } })
  await assert.rejects(pending, /session changed/)
  assert.equal(writes, 0)
  assert.equal(invalidations, 1)
})
