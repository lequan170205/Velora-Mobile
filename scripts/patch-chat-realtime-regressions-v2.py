from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text()
    if old not in source:
        raise SystemExit(f"missing patch target in {path}: {old[:160]!r}")
    file_path.write_text(source.replace(old, new, 1))


socket_path = "src/providers/SocketProvider.tsx"
messages_path = "src/hooks/useMessages.ts"
realtime_test_path = "tests/chat-realtime-regressions-contract.test.cjs"
android_test_path = "tests/chat-android-bottom-follow-contract.test.cjs"

# Incoming activity must increment from the locally cached unread count. Do not
# let the REST snapshot's unreadCount suppress the message-derived increment.
replace_once(
    socket_path,
    """      const applyConversation = (conversation: Conversation) => {\n        persistSocketMessage(message, {\n          conversation,\n          incrementUnread,\n        })\n        upsertConversationSummary(\n          {\n            ...conversation,\n            lastMessage: message.content ?? null,\n            lastMessageAt: message.createdAt || new Date().toISOString(),\n            updatedAt: message.updatedAt || message.createdAt || new Date().toISOString(),\n          },\n          { allowPlaceholder: true, incrementUnread },\n        )\n      }\n""",
    """      const applyConversation = (conversation: Conversation) => {\n        persistSocketMessage(message, {\n          conversation,\n          incrementUnread,\n        })\n\n        const { unreadCount: _snapshotUnreadCount, ...conversationWithoutUnreadCount } = conversation\n        const conversationActivityPatch = incrementUnread\n          ? conversationWithoutUnreadCount\n          : conversation\n\n        upsertConversationSummary(\n          {\n            ...conversationActivityPatch,\n            lastMessage: message.content ?? null,\n            lastMessageAt: message.createdAt || new Date().toISOString(),\n            updatedAt: message.updatedAt || message.createdAt || new Date().toISOString(),\n          },\n          { allowPlaceholder: true, incrementUnread },\n        )\n      }\n""",
)

# Text optimistic messages need the same server-frontier ordering contract that
# media already uses. Client wall clocks are not authoritative ordering data.
replace_once(
    messages_path,
    """import { useChatStore } from '../stores/chatStore'\n\nimport type { Conversation, Message } from '../types/conversation.types'\n""",
    """import { useChatStore } from '../stores/chatStore'\n\nimport type { OptimisticSortAnchor } from '../stores/chatStore'\nimport type { Conversation, Message } from '../types/conversation.types'\n""",
)

replace_once(
    messages_path,
    """const getCachedConversation = (\n  queryClient: QueryClient,\n  conversationId: string,\n): Conversation | null => {\n  const cachedData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)\n\n  const conversations: Conversation[] = Array.isArray(cachedData)\n    ? cachedData\n    : (cachedData as { pages?: Conversation[][] })?.pages?.flat() || []\n\n  return conversations.find((conversation) => conversation.id === conversationId) ?? null\n}\n\n""",
    """const getCachedConversation = (\n  queryClient: QueryClient,\n  conversationId: string,\n): Conversation | null => {\n  const cachedData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)\n\n  const conversations: Conversation[] = Array.isArray(cachedData)\n    ? cachedData\n    : (cachedData as { pages?: Conversation[][] })?.pages?.flat() || []\n\n  return conversations.find((conversation) => conversation.id === conversationId) ?? null\n}\n\nconst getLatestPersistedServerFrontier = ({\n  conversation,\n  conversationId,\n  queryClient,\n}: {\n  conversation?: Conversation | null\n  conversationId: string\n  queryClient: QueryClient\n}) => {\n  const cachedMessages = queryClient.getQueryData<InfiniteData<Message[]> | Message[] | undefined>(\n    queryKeys.conversations.messages(conversationId),\n  )\n  const flattenedMessages = Array.isArray(cachedMessages)\n    ? cachedMessages\n    : (cachedMessages?.pages?.flat() ?? [])\n  const latestPersistedMessage =\n    sortMessagesNewestFirst(\n      flattenedMessages.filter(\n        (message) => Boolean(message.id) && !message.id.startsWith('temp-'),\n      ),\n    )[0] ?? null\n\n  if (latestPersistedMessage?.id) {\n    return {\n      frontierCreatedAtMs: getMessageCreatedAtMs(latestPersistedMessage),\n      frontierMessageId: latestPersistedMessage.id,\n    }\n  }\n\n  const fallbackCreatedAtMs = Date.parse(\n    conversation?.lastMessageAt ?? conversation?.updatedAt ?? conversation?.createdAt ?? '',\n  )\n\n  return {\n    frontierCreatedAtMs: Number.isFinite(fallbackCreatedAtMs) ? fallbackCreatedAtMs : 0,\n    frontierMessageId: null,\n  }\n}\n\nconst getNextOptimisticSequenceForFrontier = ({\n  anchorsByMessageId,\n  frontierCreatedAtMs,\n  frontierMessageId,\n}: {\n  anchorsByMessageId: Record<string, OptimisticSortAnchor>\n  frontierCreatedAtMs: number\n  frontierMessageId: string | null\n}) =>\n  Object.values(anchorsByMessageId).reduce((maxSequence, anchor) => {\n    if (\n      anchor.frontierCreatedAtMs !== frontierCreatedAtMs ||\n      (anchor.frontierMessageId ?? null) !== frontierMessageId\n    ) {\n      return maxSequence\n    }\n\n    return Math.max(maxSequence, anchor.sequence)\n  }, 0)\n\n""",
)

replace_once(
    messages_path,
    """  const { addOptimisticMessage, enqueueOfflineMessage, markMessageFailed, replyToMessage } =\n    useChatStore()\n""",
    """  const { addOptimisticMessages, enqueueOfflineMessage, markMessageFailed, replyToMessage } =\n    useChatStore()\n""",
)

replace_once(
    messages_path,
    """      addOptimisticMessage(conversationId, tempMessage)\n\n      if (type === 'text' && !media) {\n""",
    """      const existingSortAnchors =\n        useChatStore.getState().optimisticSortAnchors[conversationId] ?? {}\n      const frontier = getLatestPersistedServerFrontier({\n        conversation: currentConversation,\n        conversationId,\n        queryClient,\n      })\n      const nextSequence =\n        getNextOptimisticSequenceForFrontier({\n          anchorsByMessageId: existingSortAnchors,\n          frontierCreatedAtMs: frontier.frontierCreatedAtMs,\n          frontierMessageId: frontier.frontierMessageId,\n        }) + 1\n\n      addOptimisticMessages(conversationId, [tempMessage], {\n        [tempId]: {\n          frontierCreatedAtMs: frontier.frontierCreatedAtMs,\n          frontierMessageId: frontier.frontierMessageId,\n          sequence: nextSequence,\n        },\n      })\n\n      if (type === 'text' && !media) {\n""",
)

# Once the server has supplied an authoritative timestamp, release the text
# optimistic anchor after reconciliation.
replace_once(
    socket_path,
    """          store.confirmMessage(message.clientMessageId, message)\n          store.dequeueOfflineMessage(message.clientMessageId)\n          flushOfflineQueueRef.current(newSocket)\n""",
    """          store.confirmMessage(message.clientMessageId, message)\n          store.removeOptimisticSortAnchors(message.conversationId, [message.clientMessageId])\n          store.dequeueOfflineMessage(message.clientMessageId)\n          flushOfflineQueueRef.current(newSocket)\n""",
)

# Lock the exact unread regression: incrementing activity must strip snapshot
# unreadCount before calling the summary updater.
replace_once(
    realtime_test_path,
    """test('account-room activity applies canonical metadata and unread in one cache update', () => {\n  assert.match(socketProvider, /conversationOverride\\?: Conversation/)\n  assert.match(\n    socketProvider,\n    /if \\(conversationOverride\\) \\{\\s*applyConversation\\(conversationOverride\\)/,\n  )\n})\n""",
    """test('account-room activity applies canonical metadata and unread in one cache update', () => {\n  assert.match(socketProvider, /conversationOverride\\?: Conversation/)\n  assert.match(\n    socketProvider,\n    /if \\(conversationOverride\\) \\{\\s*applyConversation\\(conversationOverride\\)/,\n  )\n})\n\ntest('message activity increments from cache instead of replaying the REST unread snapshot', () => {\n  assert.match(\n    socketProvider,\n    /const \\{ unreadCount: _snapshotUnreadCount, \\.\\.\\.conversationWithoutUnreadCount \\} = conversation/,\n  )\n  assert.match(\n    socketProvider,\n    /const conversationActivityPatch = incrementUnread\\s*\\? conversationWithoutUnreadCount\\s*:\\s*conversation/,\n  )\n  assert.match(socketProvider, /\\.\\.\\.conversationActivityPatch/)\n})\n""",
)

# Android stability now comes from server-frontier ordering, not from trusting
# the device clock for the optimistic row.
android_test_source = Path(android_test_path).read_text()
android_test_source = android_test_source.replace(
    "const chatScreenPath = path.resolve(__dirname, '../app/conversation/[id].tsx')\nconst readSource = () => fs.readFileSync(chatScreenPath, 'utf8')\n",
    "const chatScreenPath = path.resolve(__dirname, '../app/conversation/[id].tsx')\nconst messagesHookPath = path.resolve(__dirname, '../src/hooks/useMessages.ts')\nconst socketProviderPath = path.resolve(__dirname, '../src/providers/SocketProvider.tsx')\nconst readSource = () => fs.readFileSync(chatScreenPath, 'utf8')\n",
    1,
)
android_test_source += """\n\ntest('text optimistic messages anchor to the latest persisted server frontier', () => {\n  const source = fs.readFileSync(messagesHookPath, 'utf8')\n\n  assert.match(source, /const getLatestPersistedServerFrontier =/)\n  assert.match(source, /optimisticSortAnchors\\[conversationId\\] \\?\\? \\{\\}/)\n  assert.match(source, /getNextOptimisticSequenceForFrontier/)\n  assert.match(\n    source,\n    /addOptimisticMessages\\(conversationId, \\[tempMessage\\], \\{[\\s\\S]*frontierCreatedAtMs:[\\s\\S]*frontierMessageId:[\\s\\S]*sequence: nextSequence/,\n  )\n  assert.doesNotMatch(source, /addOptimisticMessage\\(conversationId, tempMessage\\)/)\n})\n\ntest('server sync releases the text optimistic ordering anchor after confirmation', () => {\n  const source = fs.readFileSync(socketProviderPath, 'utf8')\n  const syncStart = source.indexOf("newSocket.on('message_synced'")\n  const syncEnd = source.indexOf("newSocket.on(\\n      'message_failed'", syncStart)\n  const syncBlock = source.slice(syncStart, syncEnd)\n\n  assert.notEqual(syncStart, -1)\n  assert.notEqual(syncEnd, -1)\n  assert.match(syncBlock, /store\\.confirmMessage\\(message\\.clientMessageId, message\\)/)\n  assert.match(\n    syncBlock,\n    /store\\.removeOptimisticSortAnchors\\(message\\.conversationId, \\[message\\.clientMessageId\\]\\)/,\n  )\n})\n"""
Path(android_test_path).write_text(android_test_source)

print('chat realtime regression v2 patch applied')
