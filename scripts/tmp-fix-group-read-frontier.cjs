const fs = require('node:fs')

const replaceOnce = (file, before, after) => {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes(before)) {
    throw new Error(`Expected source block not found in ${file}`)
  }
  fs.writeFileSync(file, source.replace(before, after))
}

replaceOnce(
  'src/providers/SocketProvider.tsx',
  `        patchConversationMessageCollectionsInCache(queryClient, conversationId, (msg) => {\n          if (msg.senderId !== currentUserId) {\n            return msg\n          }`,
  `        patchConversationMessageCollectionsInCache(queryClient, conversationId, (msg) => {\n          // Mirror the backend read rule exactly: the reader has seen every\n          // message from other participants up to the emitted frontier.\n          // This matters in groups because a read frontier can advance across\n          // messages authored by someone other than the current viewer.\n          if (msg.senderId === readByUserId) {\n            return msg\n          }`,
)

replaceOnce(
  'app/conversation/[id].tsx',
  `        const newestReadOutgoingMessage =\n          orderedMessages.find((message) => {\n            if (message.senderId !== user.id || !Array.isArray(message.readBy)) {\n              return false\n            }\n\n            return message.readBy.some((entry) => entry.userId === participant.id)\n          }) ?? null\n        const newestParticipantMessage =\n          orderedMessages.find((message) => message.senderId === participant.id) ?? null\n        const newestReadOutgoingIndex = newestReadOutgoingMessage\n          ? orderedMessages.indexOf(newestReadOutgoingMessage)\n          : -1\n        const newestParticipantMessageIndex = newestParticipantMessage\n          ? orderedMessages.indexOf(newestParticipantMessage)\n          : -1\n        const shouldAnchorToParticipantActivity =\n          newestParticipantMessageIndex >= 0 &&\n          (newestReadOutgoingIndex === -1 ||\n            newestParticipantMessageIndex < newestReadOutgoingIndex)\n        const receiptAnchorMessage = shouldAnchorToParticipantActivity\n          ? newestParticipantMessage\n          : newestReadOutgoingMessage`,
  `        const newestReadMessage =\n          orderedMessages.find(\n            (message) =>\n              Array.isArray(message.readBy) &&\n              message.readBy.some((entry) => entry.userId === participant.id),\n          ) ?? null\n        const newestParticipantMessage =\n          orderedMessages.find((message) => message.senderId === participant.id) ?? null\n        const newestReadMessageIndex = newestReadMessage\n          ? orderedMessages.indexOf(newestReadMessage)\n          : -1\n        const newestParticipantMessageIndex = newestParticipantMessage\n          ? orderedMessages.indexOf(newestParticipantMessage)\n          : -1\n        const shouldAnchorToParticipantActivity =\n          newestParticipantMessageIndex >= 0 &&\n          (newestReadMessageIndex === -1 ||\n            newestParticipantMessageIndex < newestReadMessageIndex)\n        const receiptAnchorMessage = shouldAnchorToParticipantActivity\n          ? newestParticipantMessage\n          : newestReadMessage`,
)

const realtimeTest = 'tests/chat-realtime-regressions-contract.test.cjs'
fs.appendFileSync(
  realtimeTest,
  `\n\ntest('group read receipts mirror the reader frontier across every other author', () => {\n  const seenStart = socketProvider.indexOf("'messages_seen'")\n  const seenEnd = socketProvider.indexOf('const flushingOfflineMessageIds', seenStart)\n  const seenBlock = socketProvider.slice(seenStart, seenEnd)\n\n  assert.notEqual(seenStart, -1)\n  assert.notEqual(seenEnd, -1)\n  assert.match(seenBlock, /if \\(msg\\.senderId === readByUserId\\)/)\n  assert.doesNotMatch(seenBlock, /if \\(msg\\.senderId !== currentUserId\\)/)\n})\n`,
)

const groupUiTest = 'tests/group-chat-ui-contract.test.cjs'
let groupUiSource = fs.readFileSync(groupUiTest, 'utf8')
groupUiSource = groupUiSource.replace(
  `  assert.match(\n    chatScreen,\n    /message\\.readBy\\.some\\(\\(entry\\) => entry\\.userId === participant\\.id\\)/,\n  )`,
  `  assert.match(chatScreen, /const newestReadMessage =/)\n  assert.match(\n    chatScreen,\n    /Array\\.isArray\\(message\\.readBy\\)[\\s\\S]*message\\.readBy\\.some\\(\\(entry\\) => entry\\.userId === participant\\.id\\)/,\n  )\n  assert.doesNotMatch(\n    chatScreen,\n    /message\\.senderId !== user\\.id \\|\\| !Array\\.isArray\\(message\\.readBy\\)/,\n  )`,
)
fs.writeFileSync(groupUiTest, groupUiSource)
