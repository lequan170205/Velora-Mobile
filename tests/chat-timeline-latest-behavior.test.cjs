const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const {
  createDeferred,
  loadTypeScriptModule,
  makeDescendingPage,
  mergeNewestFirst,
  waitForMicrotasks,
} = require('./chat-timeline-test-utils.cjs')

const useMessagesPath = path.resolve(__dirname, '../src/hooks/useMessages.ts')

const createLatestHarness = ({ getLocalPage, getRemoteMessages, queryClient }) => {
  const localCalls = []
  const remoteCalls = []

  const getLocalMessagesPage = async (input) => {
    localCalls.push({ cursor: input.cursor, limit: input.limit })
    return getLocalPage(input.cursor)
  }

  const conversationApi = {
    getMessages: async (conversationId, params) => {
      remoteCalls.push({ conversationId, params })
      return getRemoteMessages(conversationId, params)
    },
    sendMessage: async () => {
      throw new Error('sendMessage is not used by timeline characterization tests')
    },
  }

  const useAuthStore = () => null
  useAuthStore.getState = () => ({ user: null })

  const moduleExports = loadTypeScriptModule({
    filename: useMessagesPath,
    mocks: {
      '@tanstack/react-query': {
        useInfiniteQuery: () => {
          throw new Error('useInfiniteQuery is not used by query option characterization tests')
        },
        useMutation: () => {
          throw new Error('useMutation is not used by query option characterization tests')
        },
        useQueryClient: () => queryClient,
      },
      react: {
        useCallback: (callback) => callback,
        useEffect: () => undefined,
        useMemo: (factory) => factory(),
        useRef: (value) => ({ current: value }),
        useState: (value) => [typeof value === 'function' ? value() : value, () => undefined],
      },
      '../api/conversation.api': { conversationApi },
      '../constants/queryKeys': {
        queryKeys: {
          conversations: {
            all: ['conversations'],
            messages: (conversationId) => ['conversations', conversationId, 'messages'],
          },
        },
      },
      '../database/messageRepository': { getLocalMessagesPage },
      '../database/messageSync': {
        createPendingTextMessage: async () => null,
        upsertRemoteMessage: async () => undefined,
        upsertRemoteMessages: async () => undefined,
      },
      '../database/messageSyncRangeRepository': {
        buildRangeBoundaryFromMessages: (messages) => ({
          startMessageId: messages[0]?.id ?? null,
          startCreatedAt: messages[0] ? Date.parse(messages[0].createdAt) : null,
          endMessageId: messages.at(-1)?.id ?? null,
          endCreatedAt: messages.at(-1) ? Date.parse(messages.at(-1).createdAt) : null,
        }),
        getLatestMessageSyncRange: async () => null,
        markRangeRemoteExhausted: async () => null,
        upsertMessageSyncRange: async () => null,
      },
      '../lib/chatMessageCache': {
        upsertConversationSummaryInCache: () => undefined,
        upsertMessageIntoConversationCache: () => undefined,
      },
      '../lib/clientMessageId': { createClientMessageId: () => 'client-message-id' },
      '../lib/messageIdentity': {
        getMessageIdentityKey: (message) =>
          message?.clientMessageId ?? message?.id ?? message?._id ?? null,
        mergeMessageCollectionByIdentity: (messages) => mergeNewestFirst([], messages),
      },
      '../lib/replyPreview': {
        buildReplyPreviewFromMessage: () => undefined,
        mergeReplyPreview: (_existing, incoming) => incoming,
      },
      '../providers/NetworkProvider': {
        useNetworkStatus: () => ({ isNetworkResolved: true, isOnline: true }),
      },
      '../providers/SocketProvider': {
        useSocket: () => ({ socket: null }),
      },
      '../stores/authStore': { useAuthStore },
      '../stores/chatStore': { useChatStore: () => undefined },
    },
  })

  return {
    getMessagesInfiniteQueryOptions: moduleExports.getMessagesInfiniteQueryOptions,
    localCalls,
    remoteCalls,
  }
}

const createQueryClientStub = () => ({
  getQueryData: () => undefined,
  setQueryData: () => undefined,
})

test('latest older returns a cached local page without waiting for a slow remote backfill', async () => {
  const localPage = makeDescendingPage(85, 15)
  const remoteDeferred = createDeferred()
  const queryClient = createQueryClientStub()
  const harness = createLatestHarness({
    getLocalPage: (cursor) => (cursor === 'm086' ? localPage : []),
    getRemoteMessages: () => remoteDeferred.promise,
    queryClient,
  })

  const options = harness.getMessagesInfiniteQueryOptions({
    conversationId: 'conversation-1',
    isNetworkResolved: true,
    isOnline: true,
    queryClient,
  })

  const timeoutToken = Symbol('timeout')
  const result = await Promise.race([
    options.queryFn({ pageParam: 'm086' }),
    new Promise((resolve) => setTimeout(() => resolve(timeoutToken), 40)),
  ])

  assert.notEqual(result, timeoutToken, 'local older page became network-gated')
  assert.deepEqual(
    result.map((message) => message.id),
    localPage.map((message) => message.id),
  )
  assert.equal(harness.remoteCalls.length, 1, 'remote backfill should still start in background')

  remoteDeferred.resolve([])
  await waitForMicrotasks()
})

test('latest pagination advances the next cursor from the oldest message of each returned page', async () => {
  const page1 = makeDescendingPage(100, 15)
  const page2 = makeDescendingPage(85, 15)
  const page3 = makeDescendingPage(70, 15)
  const pagesByCursor = new Map([
    ['initial', page1],
    ['m086', page2],
    ['m071', page3],
  ])
  const queryClient = createQueryClientStub()
  const harness = createLatestHarness({
    getLocalPage: (cursor) => pagesByCursor.get(cursor ?? 'initial') ?? [],
    getRemoteMessages: async () => [],
    queryClient,
  })

  const options = harness.getMessagesInfiniteQueryOptions({
    conversationId: 'conversation-1',
    isNetworkResolved: true,
    isOnline: false,
    queryClient,
  })

  const returnedPage1 = await options.queryFn({ pageParam: undefined })
  const cursor1 = options.getNextPageParam(returnedPage1)
  const returnedPage2 = await options.queryFn({ pageParam: cursor1 })
  const cursor2 = options.getNextPageParam(returnedPage2)
  const returnedPage3 = await options.queryFn({ pageParam: cursor2 })
  const cursor3 = options.getNextPageParam(returnedPage3)

  assert.equal(cursor1, 'm086')
  assert.equal(cursor2, 'm071')
  assert.equal(cursor3, 'm056')
  assert.deepEqual(
    harness.localCalls.map((call) => call.cursor),
    [undefined, 'm086', 'm071'],
  )

  const allIds = [...returnedPage1, ...returnedPage2, ...returnedPage3].map(
    (message) => message.id,
  )
  assert.equal(new Set(allIds).size, allIds.length, 'characterized pages unexpectedly overlap')
})

test('latest older keeps cached history usable while offline', async () => {
  const localPage = makeDescendingPage(85, 15)
  const queryClient = createQueryClientStub()
  const harness = createLatestHarness({
    getLocalPage: (cursor) => (cursor === 'm086' ? localPage : []),
    getRemoteMessages: async () => {
      throw new Error('remote should not be called while offline with a cached page')
    },
    queryClient,
  })

  const options = harness.getMessagesInfiniteQueryOptions({
    conversationId: 'conversation-1',
    isNetworkResolved: true,
    isOnline: false,
    queryClient,
  })

  const result = await options.queryFn({ pageParam: 'm086' })

  assert.deepEqual(
    result.map((message) => message.id),
    localPage.map((message) => message.id),
  )
  assert.equal(harness.remoteCalls.length, 0)
})

test('latest older does not fail the visible local page when its background remote backfill fails', async () => {
  const localPage = makeDescendingPage(85, 15)
  const remoteDeferred = createDeferred()
  const queryClient = createQueryClientStub()
  const harness = createLatestHarness({
    getLocalPage: (cursor) => (cursor === 'm086' ? localPage : []),
    getRemoteMessages: () => remoteDeferred.promise,
    queryClient,
  })

  const options = harness.getMessagesInfiniteQueryOptions({
    conversationId: 'conversation-1',
    isNetworkResolved: true,
    isOnline: true,
    queryClient,
  })

  const result = await options.queryFn({ pageParam: 'm086' })
  assert.deepEqual(
    result.map((message) => message.id),
    localPage.map((message) => message.id),
  )

  const originalWarn = console.warn
  console.warn = () => undefined
  try {
    remoteDeferred.reject(new Error('transient remote failure'))
    await waitForMicrotasks()
  } finally {
    console.warn = originalWarn
  }
})

test.todo('latest: a transient fetchNextPage failure must allow retrying the same cursor')
