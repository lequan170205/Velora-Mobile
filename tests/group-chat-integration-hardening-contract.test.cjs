const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const useConversations = read('src/hooks/useConversations.ts')
const bootstrap = read('src/database/conversationBootstrap.ts')
const socketProvider = read('src/providers/SocketProvider.tsx')
const chatStore = read('src/stores/chatStore.ts')
const chatScreen = read('app/conversation/[id].tsx')
const groupInfo = read('app/conversation/[id]/info.tsx')
const messageIdentity = read('src/lib/messageIdentity.ts')
const messageMetadata = read('src/lib/messageMetadata.ts')
const messageBubble = read('src/components/chat/MessageBubble.tsx')

test('paginated conversation list is not treated as an authoritative deletion snapshot', () => {
  assert.doesNotMatch(useConversations, /reconcileConversationSnapshot/)
  assert.doesNotMatch(bootstrap, /remoteConversationIds/)
  assert.match(bootstrap, /export const getLocalConversationIds/)
})

test('socket reconnect rejoins locally stored conversations so missed revocations are reconciled by server auth', () => {
  assert.match(socketProvider, /getLocalConversationIds\(\)/)
  assert.match(socketProvider, /joinConversationRooms\(conversationIds\)/)
  assert.match(socketProvider, /markConversationRevoked\(conversationId\)/)
  assert.match(socketProvider, /clearConversationRevoked\(conversation\.id\)/)
})

test('revocation tombstones are session-only and clear scoped optimistic state', () => {
  assert.match(chatStore, /revokedConversationIds: Set<string>/)
  assert.match(chatStore, /markConversationRevoked/)
  assert.match(chatStore, /clearConversationRevoked/)
  const partialize = chatStore.slice(chatStore.indexOf('partialize:'), chatStore.indexOf('merge:'))
  assert.doesNotMatch(partialize, /revokedConversationIds/)
})

test('active chat and group info blank and exit immediately after revocation', () => {
  assert.match(chatScreen, /if \(isConversationRevoked\)/)
  assert.match(chatScreen, /router\.replace\('\/'\)/)
  assert.match(groupInfo, /if \(isConversationRevoked\)/)
  assert.match(groupInfo, /router\.replace\('\/'\)/)
})

test('explicit leave clears local, query, and offline state even if socket removal event is missed', () => {
  assert.match(groupInfo, /store\.markConversationRevoked\(conversationId\)/)
  assert.match(groupInfo, /store\.clearConversationState\(conversationId\)/)
  assert.match(groupInfo, /removeConversationLocalData\(conversationId\)/)
  assert.match(groupInfo, /cancelQueries/)
})

test('message merges preserve structured group activity and AI citation metadata', () => {
  assert.match(messageIdentity, /const citations =/)
  assert.match(messageIdentity, /existing\?\.citations/)
  assert.match(messageIdentity, /const groupActivity =/)
  assert.match(messageIdentity, /existing\?\.groupActivity/)
  assert.match(messageIdentity, /citations !== undefined \? \{ citations \} : \{\}/)
  assert.match(messageIdentity, /groupActivity !== undefined \? \{ groupActivity \} : \{\}/)
})

test('legacy group activity records keep their system kind even when the structured payload was lost', () => {
  assert.match(
    messageMetadata,
    /if \(rawKind === GROUP_SYSTEM_ACTIVITY_METADATA_KIND\)[\s\S]*kind: GROUP_SYSTEM_ACTIVITY_METADATA_KIND/,
  )
  assert.match(messageMetadata, /\.\.\.\(groupActivity \? \{ groupActivity \} : \{\}\)/)
})

test('group system rows stay centered even when an older local record lost activity payload', () => {
  assert.match(messageBubble, /metadata\?\.kind === 'group_system_activity'/)
  assert.match(messageBubble, /if \(!activity\) return props\.message\.content/)
  assert.doesNotMatch(
    messageBubble,
    /metadata\?\.kind === 'group_system_activity' &&\s*props\.message\.metadata\.groupActivity/,
  )
})

test('group photo picker is single-flight and launches the library without a permission round-trip', () => {
  assert.match(groupInfo, /const pictureMutationInFlightRef = useRef\(false\)/)
  assert.match(groupInfo, /pictureMutationInFlightRef\.current = true[\s\S]*launchImageLibraryAsync/)
  assert.match(groupInfo, /finally \{[\s\S]*pictureMutationInFlightRef\.current = false/)
  assert.doesNotMatch(groupInfo, /requestMediaLibraryPermissionsAsync/)
})
