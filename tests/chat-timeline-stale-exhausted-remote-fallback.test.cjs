const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { loadTypeScriptModule, makeDescendingPage } = require('./chat-timeline-test-utils.cjs')

const useMessagesPath = path.resolve(__dirname, '../src/hooks/useMessages.ts')

const createHarness = ({ remotePage }) => {
  const localCalls = []
  const remoteCalls = []
  const queryClient = {
    getQueryData: () => undefined,
    setQueryData: () => undefined,
  }

  const getLocalMessagesPage = async (input) => {
    localCalls.push({ cursor: input.cursor, limit: input.limit })
    return []
  }

  const useAuthStore = () => null
  useAuthStore.getState = () => ({ user: null })

  const moduleExports = loadTypeScriptModule({
    filename: useMessagesPath,
    mocks: {
      '@tanstack/react-query': {
        useInfiniteQuery: () => {
          throw new Error('useInfiniteQuery is not used by query option tests')
        },
        useMutation: () => {
          throw new Error('useMutation is not used by query option tests')
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
      '../api/conversation.api': {
        conversationApi: {
          getMessages: async (conversationId, options) => {
            remoteCalls.push({ conversationId, options })
            return remotePage
          },
          sendMessage: async () => {
            throw new Error('sendMessage is not used by query option tests')
          },
        },
      },
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
        mergeMessageCollectionByIdentity: (messages) => messages,
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
    queryClient,
    remoteCalls,
  }
}

test('stale exhausted metadata cannot block remote older history when local cache is empty', async () => {
  const initialPage = makeDescendingPage(100, 15)
  const serverOlderPage = makeDescendingPage(85, 15)
  const harness = createHarness({ remotePage: serverOlderPage })

  const staleLatestSyncRange = {
    id: 'latest-range',
    conversationId: 'conversation-1',
    rangeType: 'latest',
    source: 'remote_latest',
    anchorTargetId: null,
    startMessageId: 'm100',
    startCreatedAt: Date.parse(initialPage[0].createdAt),
    endMessageId: 'm086',
    endCreatedAt: Date.parse(initialPage.at(-1).createdAt),
    remoteHasOlder: false,
    remoteHasNewer: false,
    remoteExhaustedOlder: true,
    remoteExhaustedNewer: false,
    isContiguous: true,
    isComplete: false,
    lastCursor: 'm086',
    lastSyncedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const options = harness.getMessagesInfiniteQueryOptions({
    conversationId: 'conversation-1',
    isNetworkResolved: true,
    isOnline: true,
    latestSyncRange: staleLatestSyncRange,
    queryClient: harness.queryClient,
  })

  const nextCursor = options.getNextPageParam(initialPage)
  assert.equal(nextCursor, 'm086')

  const olderPage = await options.queryFn({ pageParam: nextCursor })

  assert.deepEqual(
    olderPage.map((message) => message.id),
    serverOlderPage.map((message) => message.id),
  )
  assert.deepEqual(harness.localCalls, [
    { cursor: 'm086', limit: 15 },
    { cursor: 'm086', limit: 15 },
  ])
  assert.deepEqual(harness.remoteCalls, [
    {
      conversationId: 'conversation-1',
      options: { limit: 15, cursor: 'm086' },
    },
  ])
})
