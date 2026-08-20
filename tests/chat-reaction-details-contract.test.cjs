const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const conversationApi = read('src/api/conversation.api.ts')
const messageBubble = read('src/components/chat/MessageBubble.tsx')
const reactionSheet = read('src/components/chat/ReactionDetailsSheet.tsx')
const socketProvider = read('src/providers/SocketProvider.tsx')
const messageActions = read('src/hooks/useMessageActions.ts')

test('reaction chips open a dedicated reaction-details bottom sheet', () => {
  assert.match(messageBubble, /ReactionDetailsSheet/)
  assert.match(messageBubble, /setActiveReactionEmoji\(emoji\)/)
  assert.match(messageBubble, /activeReactionEmoji \? \(/)
  assert.match(reactionSheet, /sheetRef\.current\?\.present\(\)/)
  assert.match(reactionSheet, /<BottomSheetModal/)
  assert.match(reactionSheet, /enablePanDownToClose/)
})

test('reaction details are fetched lazily and filterable by emoji', () => {
  assert.match(conversationApi, /getReactionDetails: async/)
  assert.match(conversationApi, /`\/messages\/\$\{messageId\}\/reactions`/)
  assert.match(messageBubble, /activeReactionEmoji \? \(/)
  assert.match(reactionSheet, /All \{data\?\.total \?\? 0\}/)
  assert.match(reactionSheet, /setSelectedFilter\(emoji\)/)
})

test('reaction actors preserve historical identity fallbacks and identify the current user', () => {
  assert.match(reactionSheet, /reaction\.userId === currentUserId\) return 'Bạn'/)
  assert.match(reactionSheet, /reaction\.user\?\.fullName/)
  assert.match(reactionSheet, /reaction\.user\?\.username/)
  assert.match(reactionSheet, /return 'Người dùng'/)
})

test('open reaction details refresh when realtime reaction state changes', () => {
  assert.match(socketProvider, /message_reaction_updated/)
  assert.match(messageBubble, /reactionSignature/)
  assert.match(reactionSheet, /reactionSignature/)
  assert.match(reactionSheet, /void refetch\(\)/)
})

test('long-press reaction mutation remains separate from tapping reaction details', () => {
  assert.match(messageActions, /useAddReaction/)
  assert.match(messageActions, /useRemoveReaction/)
  assert.doesNotMatch(reactionSheet, /useAddReaction|useRemoveReaction/)
})
