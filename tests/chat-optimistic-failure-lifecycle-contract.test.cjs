const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const chatStorePath = path.resolve(__dirname, '../src/stores/chatStore.ts')

const getBlock = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)

  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)

  return source.slice(start, end)
}

const assertSettlesAnchors = (block) => {
  assert.match(block, /settleTextOptimisticSortAnchors\(nextMessages, currentAnchors\)/)
  assert.match(block, /buildNextOptimisticSortAnchors\(/)
}

test('failed optimistic sends settle the ordering domain in the same store transition', () => {
  const source = fs.readFileSync(chatStorePath, 'utf8')
  const failureBlock = getBlock(source, 'markMessageFailed:', 'setTyping:')

  assert.match(failureBlock, /status: 'FAILED' as const/)
  assertSettlesAnchors(failureBlock)
})

test('optimistic updates settle anchors so media failure cannot leave newer stale anchors', () => {
  const source = fs.readFileSync(chatStorePath, 'utf8')
  const updateBlock = getBlock(source, 'updateOptimisticMessage:', 'confirmMessage:')

  assertSettlesAnchors(updateBlock)
})

test('optimistic removal settles anchors so cancellation cannot leave an orphan ordering domain', () => {
  const source = fs.readFileSync(chatStorePath, 'utf8')
  const removeBlock = getBlock(source, 'removeOptimisticMessage:', 'updateOptimisticMessage:')

  assertSettlesAnchors(removeBlock)
})
