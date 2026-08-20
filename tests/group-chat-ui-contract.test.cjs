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
const conversationApi = read('src/api/conversation.api.ts')

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

test('group receipt avatars follow each participant newest activity or read frontier', () => {
  assert.match(
    chatScreen,
    /const groupParticipants = \(currentConversation\.participants \?\? \[\]\)/,
  )
  assert.match(chatScreen, /const newestReadMessage =/)
  assert.match(
    chatScreen,
    /Array\.isArray\(message\.readBy\)[\s\S]*message\.readBy\.some\(\(entry\) => entry\.userId === participant\.id\)/,
  )
  assert.doesNotMatch(
    chatScreen,
    /message\.senderId !== user\.id \|\| !Array\.isArray\(message\.readBy\)/,
  )
  assert.match(
    chatScreen,
    /orderedMessages\.find\(\(message\) => message\.senderId === participant\.id\)/,
  )
  assert.match(chatScreen, /shouldAnchorToParticipantActivity/)
  assert.match(
    chatScreen,
    /readReceiptMap\.set\(receiptIdentityKey, \[\.\.\.existingParticipants, participant\]\)/,
  )
  assert.match(messageBubble, /visibleReceiptParticipants = readReceiptParticipants\.slice\(0, 3\)/)
  assert.match(messageBubble, /hiddenReceiptCount/)
})

test('group info derives V2 permissions from projected roles and keeps owner-only controls separate', () => {
  assert.match(groupInfoScreen, /const currentMember = useMemo/)
  assert.match(groupInfoScreen, /const currentRole: ConversationMemberRole \| null/)
  assert.match(groupInfoScreen, /const isOwner = currentRole === 'OWNER'/)
  assert.match(groupInfoScreen, /const isAdmin = currentRole === 'ADMIN'/)
  assert.match(groupInfoScreen, /const canManageMetadata = isOwner \|\| isAdmin/)
  assert.match(groupInfoScreen, /const canAddMembers = isOwner \|\| isAdmin/)
  assert.match(groupInfoScreen, /conversationApi\.updateMemberRole/)
  assert.match(groupInfoScreen, /conversationApi\.transferOwnership/)
  assert.match(groupInfoScreen, /confirmTransferOwnership/)
  assert.match(groupInfoScreen, /conversationApi\.leave/)
  assert.match(groupInfoScreen, /Transfer ownership before leaving\./)
  assert.match(groupInfoScreen, /memberCount > 2/)
})

test('group info keeps member rows compact and uses a real bottom sheet for management actions', () => {
  assert.match(groupInfoScreen, /className="ml-3 min-w-0 flex-1"/)
  assert.match(groupInfoScreen, /className="min-w-0 flex-row items-center"/)
  assert.match(groupInfoScreen, /className="min-w-0 flex-1 font-medium text-text-primary"/)
  assert.match(groupInfoScreen, /name="more-vert"/)
  assert.match(groupInfoScreen, /from '@gorhom\/bottom-sheet'/)
  assert.match(groupInfoScreen, /<BottomSheetModal/)
  assert.match(groupInfoScreen, /memberActionsSheetRef\.current\?\.present\(\)/)
  assert.match(groupInfoScreen, /memberActionsSheetRef\.current\?\.dismiss\(\)/)
  assert.match(groupInfoScreen, /enablePanDownToClose/)
  assert.match(groupInfoScreen, /<BottomSheetBackdrop/)
  assert.doesNotMatch(groupInfoScreen, /<Modal\b/)
  assert.match(groupInfoScreen, /Remove from group/)
  assert.match(groupInfoScreen, /Transfer ownership/)
  assert.match(groupInfoScreen, /Make admin/)
})

test('group member actions wait for sheet dismissal before presenting confirmation UI', () => {
  assert.match(groupInfoScreen, /pendingMemberActionRef/)
  assert.match(groupInfoScreen, /onDismiss=\{handleMemberActionsDismiss\}/)
  assert.match(groupInfoScreen, /requestAnimationFrame\(\(\) => pendingAction\(\)\)/)
})

test('group info presents add-member and leave actions as dedicated rows instead of toolbar clutter', () => {
  assert.match(groupInfoScreen, />Add members</)
  assert.match(groupInfoScreen, />Leave group</)
  assert.match(groupInfoScreen, /name="person-add"/)
  assert.match(groupInfoScreen, /name="logout"/)
})

test('group member roster falls back to conversation participants when v2 projection is unavailable', () => {
  assert.match(conversationApi, /fallbackGroupMembersFromConversation/)
  assert.match(conversationApi, /conversation\.participantIds\.map/)
  assert.match(conversationApi, /userId === conversation\.creatorId \? 'OWNER' : 'MEMBER'/)
  assert.match(conversationApi, /Group V2 member projection unavailable; using roster fallback/)
  assert.match(
    conversationApi,
    /apiClient\.get<Conversation>\(`\/conversations\/\$\{id\}`\)/,
  )
})

test('group ownership transfer uses the dedicated owner endpoint', () => {
  assert.match(conversationApi, /transferOwnership: async/)
  assert.match(
    conversationApi,
    /apiClient\.patch<Conversation>\(`\/conversations\/\$\{id\}\/owner`, data\)/,
  )
})
