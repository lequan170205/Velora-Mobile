const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

// Mirrors src/lib/searchText.ts so the matching rule itself is exercised.
const normalizeSearchText = (value) =>
  (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim()

test('accent-insensitive search matches Vietnamese names typed without diacritics', () => {
  assert.equal(normalizeSearchText('đệ của anh quân 2').includes('quan'), true)
  assert.equal(normalizeSearchText('Nguyễn Tài').includes('nguyen tai'), true)
  assert.equal(normalizeSearchText('ĐỖ').includes('do'), true)
  assert.equal(normalizeSearchText(null), '')
})

test('the shared normalizer stays in sync with its test copy', () => {
  const source = read('src/lib/searchText.ts')
  assert.match(source, /\.normalize\('NFD'\)/)
  assert.match(source, /replace\(\/đ\/gi, 'd'\)/)
})

test('conversation list and new-group search use the accent-insensitive matcher', () => {
  assert.match(read('app/(tabs)/index.tsx'), /normalizeSearchText\(deferredSearchQuery\)/)
  assert.match(read('app/conversation/new-group.tsx'), /normalizeSearchText\(searchQuery\)/)
})

test('call history keeps the duration outside the truncating label', () => {
  const calls = read('app/(tabs)/calls.tsx')
  assert.match(calls, /\{presentation\.title\}/)
  assert.match(calls, /flex-shrink-0[^>]*>\s*\{` · \$\{presentation\.detail\}`\}/)
})

test('inbox keeps the skeleton while the first conversations fetch is paused offline', () => {
  const inbox = read('app/(tabs)/index.tsx')
  assert.match(inbox, /fetchStatus === 'paused'/)
  assert.match(inbox, /if \(isLoading \|\| isWaitingForFirstFetch\)/)
})

test('replying to your own message reads "You replied to yourself"', () => {
  const source = read('src/lib/replyPreview.ts')
  assert.match(source, /export const getReplyHeaderText/)
  assert.match(source, /'You replied to yourself'/)
  assert.match(read('src/components/chat/MessageBubbleImpl.tsx'), /getReplyHeaderText\(/)
  assert.match(
    read('src/components/chat/MessageContextMenu/MessageContextMenu.tsx'),
    /getReplyHeaderText\(/,
  )
  assert.doesNotMatch(read('src/components/chat/MessageBubbleImpl.tsx'), /\} replied to \{/)
})
