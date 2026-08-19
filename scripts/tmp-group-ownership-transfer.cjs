const fs = require('node:fs')

const replaceOnce = (file, before, after) => {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes(before)) {
    throw new Error(`Expected source block not found in ${file}`)
  }
  fs.writeFileSync(file, source.replace(before, after))
}

const apiFile = 'src/api/conversation.api.ts'
replaceOnce(
  apiFile,
  "  leave: async (id: string) => {\n",
  "  transferOwnership: async (id: string, data: { userId: string }) => {\n    const response = await apiClient.patch<Conversation>(`/conversations/${id}/owner`, data)\n    return response.data\n  },\n  leave: async (id: string) => {\n",
)

const infoFile = 'app/conversation/[id]/info.tsx'
replaceOnce(
  infoFile,
  "  const leaveGroup = useMutation({\n",
  "  const transferOwnership = useMutation({\n    mutationFn: (userId: string) => conversationApi.transferOwnership(conversationId, { userId }),\n    onSuccess: (nextConversation) => {\n      applyConversation(nextConversation)\n    },\n    onError: (error) =>\n      Alert.alert(\n        'Unable to transfer ownership',\n        error instanceof Error ? error.message : 'Please try again.',\n      ),\n  })\n\n  const leaveGroup = useMutation({\n",
)

replaceOnce(
  infoFile,
  "  const confirmLeave = () => {\n",
  "  const confirmTransferOwnership = (member: ConversationMember) => {\n    const participant = participantById.get(member.userId)\n    const name =\n      participant?.name || participant?.fullName || participant?.email || member.user.email\n\n    Alert.alert(\n      'Transfer ownership?',\n      `${name} will become the group owner. You will stay in the group as a regular member.`,\n      [\n        { text: 'Cancel', style: 'cancel' },\n        {\n          text: 'Transfer',\n          onPress: () => transferOwnership.mutate(member.userId),\n        },\n      ],\n    )\n  }\n\n  const confirmLeave = () => {\n",
)

replaceOnce(
  infoFile,
  "              const canRemove = isOwner && !memberIsOwner && memberCount > 2\n",
  "              const canTransferOwnership = isOwner && !memberIsOwner\n              const canRemove = isOwner && !memberIsOwner && memberCount > 2\n",
)

replaceOnce(
  infoFile,
  "                  {canRemove ? (\n",
  "                  {canTransferOwnership ? (\n                    <SafeTouchableOpacity\n                      className=\"mr-2 h-9 w-9 items-center justify-center rounded-full bg-surface-input\"\n                      disabled={transferOwnership.isPending}\n                      onPress={() => confirmTransferOwnership(member)}\n                      accessibilityRole=\"button\"\n                      accessibilityLabel={`Transfer ownership to ${displayName}`}\n                    >\n                      <MaterialIcons name=\"swap-horiz\" size={19} color=\"#161616\" />\n                    </SafeTouchableOpacity>\n                  ) : null}\n                  {canRemove ? (\n",
)

replaceOnce(
  infoFile,
  "                Ownership transfer is not available yet, so the owner cannot leave the group.\n",
  "                Transfer ownership to another member before leaving the group.\n",
)

const testFile = 'tests/group-chat-ui-contract.test.cjs'
let testSource = fs.readFileSync(testFile, 'utf8')
if (!testSource.includes("const conversationApi = read('src/api/conversation.api.ts')")) {
  testSource = testSource.replace(
    "const messageBubble = read('src/components/chat/MessageBubbleImpl.tsx')\n",
    "const messageBubble = read('src/components/chat/MessageBubbleImpl.tsx')\nconst conversationApi = read('src/api/conversation.api.ts')\n",
  )
}
testSource = testSource.replace(
  "  assert.match(groupInfoScreen, /conversationApi\\.removeMember/)\n  assert.match(groupInfoScreen, /conversationApi\\.leave/)\n  assert.match(groupInfoScreen, /Ownership transfer is not available yet/)\n  assert.match(groupInfoScreen, /memberCount > 2/)\n",
  "  assert.match(groupInfoScreen, /conversationApi\\.removeMember/)\n  assert.match(groupInfoScreen, /conversationApi\\.transferOwnership/)\n  assert.match(groupInfoScreen, /confirmTransferOwnership/)\n  assert.match(groupInfoScreen, /swap-horiz/)\n  assert.match(groupInfoScreen, /conversationApi\\.leave/)\n  assert.match(groupInfoScreen, /Transfer ownership to another member before leaving the group/)\n  assert.doesNotMatch(groupInfoScreen, /Ownership transfer is not available yet/)\n  assert.match(groupInfoScreen, /memberCount > 2/)\n",
)
if (!testSource.includes("group ownership transfer uses the dedicated owner endpoint")) {
  testSource += "\n\ntest('group ownership transfer uses the dedicated owner endpoint', () => {\n  assert.match(conversationApi, /transferOwnership: async/)\n  assert.match(conversationApi, /apiClient\\.patch<Conversation>\\(`\\/conversations\\/\\$\\{id\\}\\/owner`, data\\)/)\n})\n"
}
fs.writeFileSync(testFile, testSource)
