const fs = require('node:fs')

const replaceOnce = (file, before, after) => {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes(before)) {
    throw new Error(`Expected source block not found in ${file}`)
  }
  fs.writeFileSync(file, source.replace(before, after))
}

replaceOnce(
  'src/database/messageSync.ts',
  `export const applyReadReceiptUpdate = async ({\n  at,\n  conversationId,\n  currentUserId,\n  frontierAnchorIdentityKey,\n  frontierCreatedAt,\n  messageId,\n  readByUserId,\n}: {\n  at?: string\n  conversationId: string\n  currentUserId: string\n  frontierAnchorIdentityKey?: string\n  frontierCreatedAt?: string\n  messageId?: string\n  readByUserId: string\n}) => {`,
  `export const applyReadReceiptUpdate = async ({\n  at,\n  conversationId,\n  frontierAnchorIdentityKey,\n  frontierCreatedAt,\n  messageId,\n  readByUserId,\n}: {\n  at?: string\n  conversationId: string\n  frontierAnchorIdentityKey?: string\n  frontierCreatedAt?: string\n  messageId?: string\n  readByUserId: string\n}) => {`,
)

replaceOnce(
  'src/database/messageSync.ts',
  `  const rawRecords = await messagesCollection\n    .query(\n      Q.where('conversation_id', conversationId),\n      Q.where('sender_id', currentUserId),\n      Q.where('created_at', Q.lte(frontierTimestamp)),\n    )\n    .fetch()`,
  `  const rawRecords = await messagesCollection\n    .query(\n      Q.where('conversation_id', conversationId),\n      // Mirror the server rule: a reader never reads their own message, but\n      // does read every other participant's message up to the frontier.\n      Q.where('sender_id', Q.notEq(readByUserId)),\n      Q.where('created_at', Q.lte(frontierTimestamp)),\n    )\n    .fetch()`,
)

const socketFile = 'src/providers/SocketProvider.tsx'
replaceOnce(
  socketFile,
  `            conversationId,\n            currentUserId,\n            messageId,`,
  `            conversationId,\n            messageId,`,
)
replaceOnce(
  socketFile,
  `          conversationId,\n          currentUserId,\n          messageId,`,
  `          conversationId,\n          messageId,`,
)

const testFile = 'tests/chat-realtime-regressions-contract.test.cjs'
let testSource = fs.readFileSync(testFile, 'utf8')
if (!testSource.includes("const messageSync = fs.readFileSync")) {
  testSource = testSource.replace(
    `const socketProvider = fs.readFileSync(path.join(root, 'src/providers/SocketProvider.tsx'), 'utf8')`,
    `const socketProvider = fs.readFileSync(path.join(root, 'src/providers/SocketProvider.tsx'), 'utf8')\nconst messageSync = fs.readFileSync(path.join(root, 'src/database/messageSync.ts'), 'utf8')`,
  )
}
if (!testSource.includes("read receipt persistence mirrors the group frontier across every other author")) {
  testSource += `\n\ntest('read receipt persistence mirrors the group frontier across every other author', () => {\n  const start = messageSync.indexOf('export const applyReadReceiptUpdate')\n  const block = messageSync.slice(start)\n\n  assert.notEqual(start, -1)\n  assert.match(block, /Q\\.where\\('sender_id', Q\\.notEq\\(readByUserId\\)\\)/)\n  assert.doesNotMatch(block, /Q\\.where\\('sender_id', currentUserId\\)/)\n})\n`
}
fs.writeFileSync(testFile, testSource)
