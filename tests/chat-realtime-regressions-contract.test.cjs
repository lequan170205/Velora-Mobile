const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const socketProvider = fs.readFileSync(path.join(root, 'src/providers/SocketProvider.tsx'), 'utf8')

test('conversation list activity is delivered independently of conversation-room membership', () => {
  const activityStart = socketProvider.indexOf("'conversation_message_activity'")
  const activityEnd = socketProvider.indexOf("newSocket.on('conversation_updated'", activityStart)
  const activityBlock = socketProvider.slice(activityStart, activityEnd)

  assert.notEqual(activityStart, -1)
  assert.notEqual(activityEnd, -1)
  assert.match(
    activityBlock,
    /syncConversationForMessage\(incomingMessage, shouldIncrementUnread, conversation\)/,
  )
  assert.doesNotMatch(activityBlock, /upsertCreatedConversation\(conversation\)/)
})

test('new_message and account-room activity share a bounded message-identity unread dedupe', () => {
  assert.match(socketProvider, /processedConversationActivityKeys = new Set<string>\(\)/)
  assert.match(socketProvider, /MAX_PROCESSED_CONVERSATION_ACTIVITY_KEYS = 512/)
  assert.match(socketProvider, /shouldIncrementUnreadForMessageActivity\(message\)/)
  assert.match(socketProvider, /shouldIncrementUnreadForMessageActivity\(incomingMessage\)/)
  assert.match(socketProvider, /processedConversationActivityKeys\.delete\(oldestActivityKey\)/)
})

test('account-room activity applies canonical metadata and unread in one cache update', () => {
  assert.match(socketProvider, /conversationOverride\?: Conversation/)
  assert.match(
    socketProvider,
    /if \(conversationOverride\) \{\s*applyConversation\(conversationOverride\)/,
  )
})

test('message activity increments from cache instead of replaying the REST unread snapshot', () => {
  assert.match(
    socketProvider,
    /const \{ unreadCount: _snapshotUnreadCount, \.\.\.conversationWithoutUnreadCount \}\s*=\s*conversation/,
  )
  assert.match(
    socketProvider,
    /const conversationActivityPatch = incrementUnread\s*\? conversationWithoutUnreadCount\s*:\s*conversation/,
  )
  assert.match(socketProvider, /\.\.\.conversationActivityPatch/)
})
