const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const socketProvider = read('src/providers/SocketProvider.tsx')
const bootstrap = read('src/database/conversationBootstrap.ts')
const chatStore = read('src/stores/chatStore.ts')
const conversationApi = read('src/api/conversation.api.ts')
const conversationTypes = read('src/types/conversation.types.ts')
const useConversations = read('src/hooks/useConversations.ts')

test('unknown socket messages resolve canonical conversation metadata instead of fabricating membership', () => {
  assert.match(socketProvider, /const inFlightConversationFetches = new Map/)
  assert.match(socketProvider, /conversationApi\s*\.getById\(conversationId\)/)
  assert.match(
    socketProvider,
    /!isOwnMessage && shouldIncrementUnreadForMessageActivity\(message\)/,
  )
  assert.match(socketProvider, /syncConversationForMessage\(message, shouldIncrementUnread\)/)
  assert.match(socketProvider, /syncConversationForMessage\(message, false\)/)
  assert.doesNotMatch(socketProvider, /participantIds:\s*\[message\.senderId\]/)
})

test('group lifecycle events persist, join, and revoke conversation state', () => {
  assert.match(socketProvider, /newSocket\.on\('conversation_created'/)
  assert.match(socketProvider, /persistConversationMetadata\(conversation\)/)
  assert.match(socketProvider, /joinConversationRooms\(\[conversation\.id\]\)/)
  assert.match(socketProvider, /'conversation_removed'/)
  assert.match(socketProvider, /store\.clearConversationState\(conversationId\)/)
  assert.match(socketProvider, /removeConversationLocalData\(conversationId\)/)
  assert.match(
    socketProvider,
    /newSocket\.on\('new_message'[\s\S]*removedConversationIds\.has\(incomingMessage\.conversationId\)/,
  )
  assert.match(
    socketProvider,
    /newSocket\.on\('message_synced'[\s\S]*removedConversationIds\.has\(incomingMessage\.conversationId\)/,
  )
})

test('local persistence deletes revoked history without treating a paginated list as a deletion snapshot', () => {
  assert.match(bootstrap, /export const removeConversationLocalData/)
  assert.match(bootstrap, /TABLES\.messages/)
  assert.match(bootstrap, /TABLES\.messageSyncRanges/)
  assert.match(bootstrap, /prepareDestroyPermanently/)
  assert.match(bootstrap, /export const getLocalConversationIds/)
  assert.doesNotMatch(bootstrap, /export const reconcileConversationSnapshot/)
  assert.match(bootstrap, /conversation\?\.picture !== undefined/)
  assert.doesNotMatch(useConversations, /reconcileConversationSnapshot/)
})

test('conversation scoped Zustand state is fully cleared on membership revocation', () => {
  assert.match(chatStore, /clearConversationState: \(conversationId: string\) => void/)
  assert.match(chatStore, /offlineQueue: state\.offlineQueue\.filter/)
  assert.match(chatStore, /botConversationIds\.delete\(conversationId\)/)
})

test('mobile API and types expose the backend group contract without a schema migration', () => {
  assert.match(conversationApi, /updateGroup:/)
  assert.match(conversationApi, /\/conversations\/\$\{id\}\/leave/)
  assert.match(conversationTypes, /memberJoinedAt\?: Record<string, string>/)
  assert.match(socketProvider, /patch\.memberJoinedAt/)
  assert.match(conversationTypes, /name\?: string \| null/)
  assert.match(conversationTypes, /picture\?: string \| null/)
})
