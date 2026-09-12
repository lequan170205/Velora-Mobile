const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { loadTypeScriptModule, makeDescendingPage } = require('./chat-timeline-test-utils.cjs')

const useMessagesPath = path.resolve(__dirname, '../src/hooks/useMessages.ts')

const createHookHarness = ({ fetchNextPage }) => {
  const page = makeDescendingPage(100, 15)
  const queryClient = {
    getQueryData: () => undefined,
    setQueryData: () => undefined,
  }

  const query = {
    data: {
      pages: [page],
      pageParams: [undefined],
    },
    fetchNextPage,
    hasNextPage: true,
    isError: false,
    isFetching: false,
    isFetchingNextPage: false,
    isLoading: false,
  }

  const useAuthStore = (selector) => selector({ user: null })
  useAuthStore.getState = () => ({ user: null })

  const moduleExports = loadTypeScriptModule({
    filename: useMessagesPath,
    mocks: {
      '@tanstack/react-query': {
        useInfiniteQuery: () => query,
        useMutation: () => {
          throw new Error('useMutation is not used by this characterization test')
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
          getMessages: async () => [],
          sendMessage: async () => {
            throw new Error('sendMessage is not used by this characterization test')
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
      '../database/messageRepository': {
        getLocalMessagesPage: async () => [],
      },
      '../database/messageSync': {
        createPendingTextMessage: async () => null,
        upsertRemoteMessage: async () => undefined,
        upsertRemoteMessages: async () => undefined,
      },
      '../database/messageSyncRangeRepository': {
        buildRangeBoundaryFromMessages: () => ({
          startMessageId: null,
          startCreatedAt: null,
          endMessageId: null,
          endCreatedAt: null,
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

  return moduleExports.useMessages('conversation-1')
}

test('latest: a transient fetchNextPage failure allows retrying the same cursor', async () => {
  let callCount = 0
  const transientError = new Error('transient fetch failure')

  const hook = createHookHarness({
    fetchNextPage: async () => {
      callCount += 1
      if (callCount === 1) {
        throw transientError
      }

      return { isError: false }
    },
  })

  await assert.rejects(hook.fetchNextPage(), transientError)
  await hook.fetchNextPage()

  assert.equal(callCount, 2, 'same-cursor retry was suppressed after a transient failure')
})
