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

test('message reactions render as one grouped cluster with at most three top emojis', () => {
  assert.match(messageBubble, /const MAX_VISIBLE_REACTION_EMOJIS = 3/)
  assert.match(messageBubble, /getReactionDisplayMessage/)
  assert.match(messageBubble, /right\.count - left\.count/)
  assert.match(messageBubble, /\.slice\(0, MAX_VISIBLE_REACTION_EMOJIS\)/)
  assert.match(messageBubble, /\.join\(' '\)/)
  assert.match(messageBubble, /message=\{reactionDisplayMessage\}/)
})

test('grouped reaction cluster opens a dedicated reaction-details bottom sheet', () => {
  assert.match(messageBubble, /ReactionDetailsSheet/)
  assert.match(messageBubble, /setIsReactionDetailsOpen\(true\)/)
  assert.match(messageBubble, /isReactionDetailsOpen \? \(/)
  assert.match(reactionSheet, /sheetRef\.current\?\.present\(\)/)
  assert.match(reactionSheet, /<BottomSheetModal/)
  assert.match(reactionSheet, /enablePanDownToClose/)
})

test('reaction details always open on All and remain filterable by emoji', () => {
  assert.match(conversationApi, /getReactionDetails: async/)
  assert.match(conversationApi, /`\/messages\/\$\{messageId\}\/reactions`/)
  assert.match(reactionSheet, /useState\(ALL_FILTER\)/)
  assert.match(reactionSheet, /setSelectedFilter\(ALL_FILTER\)/)
  assert.doesNotMatch(reactionSheet, /initialEmoji/)
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

test('grouped presentation never replaces original reaction state for long-press mutations', () => {
  assert.match(messageBubble, /message: props\.message/)
  assert.match(messageActions, /useAddReaction/)
  assert.match(messageActions, /useRemoveReaction/)
  assert.doesNotMatch(reactionSheet, /useAddReaction|useRemoveReaction/)
})
