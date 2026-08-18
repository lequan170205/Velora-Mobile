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

const useAnchoredMessagesPath = path.resolve(__dirname, '../src/hooks/useAnchoredMessages.ts')

const serializeKey = (key) => JSON.stringify(key)

const createQueryClientState = (initialEntries) => {
  const state = new Map(initialEntries.map(([key, value]) => [serializeKey(key), value]))

  return {
    cancelQueries: async () => undefined,
    getQueryData: (key) => state.get(serializeKey(key)),
    removeQueries: ({ queryKey }) => state.delete(serializeKey(queryKey)),
    setQueryData: (key, updater) => {
      const serialized = serializeKey(key)
      const current = state.get(serialized)
      const next = typeof updater === 'function' ? updater(current) : updater
      if (next === undefined) {
        state.delete(serialized)
      } else {
        state.set(serialized, next)
      }
      return next
    },
  }
}

const createAnchorHarness = ({
  activeAnchorTargetId,
  initialState,
  isOnline = true,
  isNetworkResolved = true,
  getLocalOlderPage,
  getRemoteOlderPage,
}) => {
  const conversationId = 'conversation-1'
  const anchorKey = ['conversations', conversationId, 'messagesAround', activeAnchorTargetId]
  const queryClient = createQueryClientState([[anchorKey, initialState]])
  const remoteOlderCalls = []
  let refCallIndex = 0

  const queryKeys = {
    conversations: {
      messagesAround: (nextConversationId, targetId) => [
        'conversations',
        nextConversationId,
        'messagesAround',
        targetId,
      ],
      messagesAroundRoot: (nextConversationId) => [
        'conversations',
        nextConversationId,
        'messagesAround',
      ],
    },
  }

  const conversationApi = {
    getMessagesAround: async () => {
      throw new Error('getMessagesAround is not used by older characterization tests')
    },
    getMessagesAnchorNewer: async () => {
      throw new Error('getMessagesAnchorNewer is not used by older characterization tests')
    },
    getMessagesAnchorOlder: async (nextConversationId, params) => {
      remoteOlderCalls.push({ conversationId: nextConversationId, params })
      return getRemoteOlderPage(nextConversationId, params)
    },
  }

  const useAuthStore = (selector) => selector({ user: null })

  const moduleExports = loadTypeScriptModule({
    filename: useAnchoredMessagesPath,
    mocks: {
      '@tanstack/react-query': {
        useQuery: ({ queryKey }) => ({
          data: queryClient.getQueryData(queryKey),
          isFetching: false,
        }),
        useQueryClient: () => queryClient,
      },
      react: {
        useCallback: (callback) => callback,
        useEffect: () => undefined,
        useMemo: (factory) => factory(),
        useRef: (initialValue) => {
          refCallIndex += 1
          if (refCallIndex === 1) {
            return { current: activeAnchorTargetId }
          }
          return { current: initialValue }
        },
        useState: () => [activeAnchorTargetId, () => undefined],
      },
      '../api/conversation.api': { conversationApi },
      '../constants/queryKeys': { queryKeys },
      '../database/messageRepository': {
        getLocalMessageWindowAroundId: async () => null,
        getLocalMessagesNewerThanCursor: async () => ({
          messages: [],
          hasMore: false,
          source: 'local',
        }),
        getLocalMessagesOlderThanCursor: async (input) => getLocalOlderPage(input),
      },
      '../database/messageSync': {
        upsertRemoteMessages: async () => undefined,
      },
      '../database/messageSyncRangeRepository': {
        buildRangeBoundaryFromMessages: (messages) => ({
          startMessageId: messages[0]?.id ?? null,
          startCreatedAt: messages[0] ? Date.parse(messages[0].createdAt) : null,
          endMessageId: messages.at(-1)?.id ?? null,
          endCreatedAt: messages.at(-1) ? Date.parse(messages.at(-1).createdAt) : null,
        }),
        getAnchorMessageSyncRanges: async () => [],
        upsertMessageSyncRange: async () => null,
      },
      '../lib/messageListState': {
        mergeMessageCollectionsNewestFirst: mergeNewestFirst,
      },
      '../providers/NetworkProvider': {
        useNetworkStatus: () => ({ isNetworkResolved, isOnline }),
      },
      '../stores/authStore': { useAuthStore },
    },
  })

  const hook = moduleExports.useAnchoredMessages({
    conversation: null,
    conversationId,
  })

  return {
    anchorKey,
    hook,
    queryClient,
    remoteOlderCalls,
  }
}

test('anchor older commits a cached local page before a slow remote reconciliation finishes', async () => {
  const initialMessages = makeDescendingPage(100, 11)
  const localOlderMessages = makeDescendingPage(89, 10)
  const remoteDeferred = createDeferred()
  const initialState = {
    targetMessageId: 'anchor-1',
    messages: initialMessages,
    hasOlder: true,
    hasNewer: false,
    oldestCursor: 'm090',
    newestCursor: 'm100',
    isFetchingOlder: false,
    isFetchingNewer: false,
    source: 'local',
  }

  const harness = createAnchorHarness({
    activeAnchorTargetId: 'anchor-1',
    initialState,
    getLocalOlderPage: async ({ cursor }) => {
      assert.equal(cursor, 'm090')
      return {
        messages: localOlderMessages,
        hasMore: true,
        nextCursor: 'm080',
        source: 'local',
      }
    },
    getRemoteOlderPage: () => remoteDeferred.promise,
  })

  await harness.hook.loadAnchorOlder('edge')

  const stateAfterLocal = harness.queryClient.getQueryData(harness.anchorKey)
  assert.equal(stateAfterLocal.oldestCursor, 'm080')
  assert.equal(stateAfterLocal.isFetchingOlder, false)
  assert.equal(stateAfterLocal.hasOlder, true)
  assert.equal(harness.remoteOlderCalls.length, 1)

  const expectedIds = mergeNewestFirst(initialMessages, localOlderMessages).map(
    (message) => message.id,
  )
  assert.deepEqual(
    stateAfterLocal.messages.map((message) => message.id),
    expectedIds,
  )

  remoteDeferred.resolve({
    messages: localOlderMessages,
    hasMore: true,
    nextCursor: 'm080',
  })
  await waitForMicrotasks()
})

test('anchor older uses cached local history without calling remote while offline', async () => {
  const initialMessages = makeDescendingPage(100, 11)
  const localOlderMessages = makeDescendingPage(89, 10)
  const initialState = {
    targetMessageId: 'anchor-1',
    messages: initialMessages,
    hasOlder: true,
    hasNewer: false,
    oldestCursor: 'm090',
    newestCursor: 'm100',
    isFetchingOlder: false,
    isFetchingNewer: false,
    source: 'local',
  }

  const harness = createAnchorHarness({
    activeAnchorTargetId: 'anchor-1',
    initialState,
    isOnline: false,
    isNetworkResolved: true,
    getLocalOlderPage: async () => ({
      messages: localOlderMessages,
      hasMore: true,
      nextCursor: 'm080',
      source: 'local',
    }),
    getRemoteOlderPage: async () => {
      throw new Error('remote should not run while offline')
    },
  })

  await harness.hook.loadAnchorOlder('edge')

  const stateAfterLocal = harness.queryClient.getQueryData(harness.anchorKey)
  assert.equal(stateAfterLocal.oldestCursor, 'm080')
  assert.equal(stateAfterLocal.isFetchingOlder, false)
  assert.equal(harness.remoteOlderCalls.length, 0)
})

test.todo('anchor: a transient remote failure must allow retrying the same cursor')
test.todo('anchor: loading the next local page must not abort an older remote reconciliation and create a gap')
