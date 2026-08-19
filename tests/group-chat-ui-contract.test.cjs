const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const conversationsScreen = read('app/(tabs)/index.tsx')
const chatScreen = read('app/conversation/[id].tsx')
const newGroupScreen = read('app/conversation/new-group.tsx')
const groupInfoScreen = read('app/conversation/[id]/info.tsx')
const messageBubble = read('src/components/chat/MessageBubbleImpl.tsx')

test('Messages exposes a dedicated new-group route without changing friendship state', () => {
  assert.match(conversationsScreen, /router\.push\('\/conversation\/new-group'\)/)
  assert.match(newGroupScreen, /useFriends\(\)/)
  assert.match(newGroupScreen, /type:\s*'GROUP'/)
  assert.match(newGroupScreen, /selectedIds\.size > 0/)
  assert.doesNotMatch(newGroupScreen, /sendRequest|acceptRequest|removeFriend/)
})

test('group header resolves real typers and opens group info while calls stay direct-only', () => {
  assert.match(chatScreen, /const groupTypingLabel = useMemo/)
  assert.match(chatScreen, /participant\?\.fullName/)
  assert.match(chatScreen, /pathname:\s*'\/conversation\/\[id\]\/info'/)
  assert.match(chatScreen, /!currentConversation\?\.isGroup && otherUserId/)
  assert.match(chatScreen, /currentConversation\.participantIds\.length/)
})

test('group read receipts derive per-member frontiers from existing readBy data', () => {
  assert.match(
    chatScreen,
    /const groupParticipants = \(currentConversation\.participants \?\? \[\]\)/,
  )
  assert.match(
    chatScreen,
    /message\.readBy\.some\(\(entry\) => entry\.userId === participant\.id\)/,
  )
  assert.match(
    chatScreen,
    /readReceiptMap\.set\(receiptIdentityKey, \[\.\.\.existingParticipants, participant\]\)/,
  )
  assert.match(messageBubble, /visibleReceiptParticipants = readReceiptParticipants\.slice\(0, 3\)/)
  assert.match(messageBubble, /hiddenReceiptCount/)
})

test('group info enforces owner-only management and non-owner leave UX', () => {
  assert.match(groupInfoScreen, /conversation\?\.creatorId === currentUserId/)
  assert.match(groupInfoScreen, /conversationApi\.updateGroup/)
  assert.match(groupInfoScreen, /conversationApi\.addMember/)
  assert.match(groupInfoScreen, /conversationApi\.removeMember/)
  assert.match(groupInfoScreen, /conversationApi\.leave/)
  assert.match(groupInfoScreen, /Ownership transfer is not available yet/)
  assert.match(groupInfoScreen, /memberCount > 2/)
})
