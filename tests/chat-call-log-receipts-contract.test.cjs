const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const read = (...parts) => readFileSync(join(__dirname, '..', ...parts), 'utf8')

test('a call row gets the same Sent / Seen marker as a message when it is the newest one', () => {
  const bubble = read('src', 'components', 'chat', 'MessageBubble.tsx')
  const callRow = bubble.slice(bubble.indexOf('<CallLogRow'), bubble.indexOf('/>', bubble.indexOf('<CallLogRow')))
  assert.match(callRow, /primaryStatusLabel=\{props\.primaryStatusLabel\}/)
  assert.match(callRow, /readReceiptParticipants=\{props\.readReceiptParticipants\}/)
})

test('the call row draws receipts with the message receipt renderer, with and without call details', () => {
  const impl = read('src', 'components', 'chat', 'MessageBubbleImpl.tsx')
  assert.match(impl, /^export function renderMessageReceiptContent\(/m)

  const row = read('src', 'components', 'chat', 'CallLogRow.tsx')
  assert.match(row, /import \{ renderMessageReceiptContent \} from '\.\/MessageBubbleImpl'/)
  assert.match(row, /renderMessageReceiptContent\(\{\s*primaryStatusLabel,\s*readReceiptParticipants,\s*visibleReceiptParticipants,/)
  assert.equal((row.match(/\{receipts \? <View className="-mx-4 mt-1 self-stretch">\{receipts\}<\/View> : null\}/g) ?? []).length, 2)
})
