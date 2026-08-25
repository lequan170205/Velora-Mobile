const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const socketProviderPath = path.resolve(__dirname, '../src/providers/SocketProvider.tsx')
const timelineControllerPath = path.resolve(
  __dirname,
  '../src/hooks/conversation/useConversationTimelineController.ts',
)

const readSource = (filename) => fs.readFileSync(filename, 'utf8')

const getBlock = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)

  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)

  return source.slice(start, end)
}

test('new_message upserts the latest query once and only reconciles anchored caches afterward', () => {
  const source = readSource(socketProviderPath)
  const block = getBlock(
    source,
    "newSocket.on('new_message'",
    "newSocket.on('conversation_updated'",
  )

  assert.match(block, /upsertMessageQuery\(message\)/)
  assert.match(block, /patchConversationAnchoredMessagesInCache\(/)
  assert.match(block, /patchExistingMessageAcrossConversationCaches\(queryClient, message\)/)

  const upsertIndex = block.indexOf('upsertMessageQuery(message)')
  const anchoredPatchIndex = block.indexOf('patchConversationAnchoredMessagesInCache(')
  const fallbackPatchIndex = block.indexOf(
    'patchExistingMessageAcrossConversationCaches(queryClient, message)',
  )

  assert.ok(anchoredPatchIndex > upsertIndex)
  assert.ok(fallbackPatchIndex > anchoredPatchIndex)
})

test('normal newest-message bottom follow does not wait two animation frames', () => {
  const source = readSource(timelineControllerPath)
  const block = getBlock(
    source,
    'if (newestMessageId && newestMessageId !== prevNewestMessageId.current)',
    'prevNewestMessageId.current = newestMessageId',
  )

  assert.match(block, /else \{\s*scrollToBottomForNewestMessage\(\)\s*\}/)
  assert.doesNotMatch(
    block,
    /requestAnimationFrame\(\(\) => \{\s*requestAnimationFrame\(\(\) => \{\s*scrollToBottomForNewestMessage\(\)/,
  )
})
