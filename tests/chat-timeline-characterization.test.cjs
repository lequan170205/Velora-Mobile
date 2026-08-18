const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('latest timeline remains local-first with background remote refresh until hardening changes it intentionally', () => {
  const source = read('src/hooks/useMessages.ts')

  assert.match(source, /const localPage = await getLocalMessagesPage\(/)
  assert.match(source, /if \(localPage\.length > 0\)/)
  assert.match(source, /void syncMessagesPageToLocalStore\(/)
  assert.match(source, /return sortMessagesNewestFirst\(localPage\)/)
  assert.match(source, /pages\[pageIndex\] = localPage/)
})

test('latest timeline currently contains an explicit failed older cursor guard', () => {
  const source = read('src/hooks/useMessages.ts')

  assert.match(source, /const failedOlderCursorRef = useRef<string \| null>\(null\)/)
  assert.match(source, /failedOlderCursorRef\.current === cursor/)
  assert.match(source, /failedOlderCursorRef\.current = cursor/)
})

test('anchor timeline currently owns older work with an abort controller and cursor failure guard', () => {
  const source = read('src/hooks/useAnchoredMessages.ts')

  assert.match(source, /const olderAbortControllerRef = useRef<AbortController \| null>\(null\)/)
  assert.match(source, /const failedAnchorCursorGuardRef = useRef<Set<string>>\(new Set\(\)\)/)
  assert.match(source, /olderAbortControllerRef\.current\?\.abort\(\)/)
  assert.match(source, /failedAnchorCursorGuardRef\.current\.has\(guardKey\)/)
})

test('ChatScreen keeps current inverted FlashList semantics during hardening', () => {
  const source = read('app/conversation/[id].tsx')

  assert.match(source, /<FlashList/)
  assert.match(source, /\binverted\b/)
  assert.match(source, /onEndReached=\{currentOlderLoader\}/)
  assert.match(source, /scrollToOffset\(\{ offset: 0, animated \}\)/)
})

test('ChatScreen has distinct scroll owners that must not be collapsed accidentally', () => {
  const source = read('app/conversation/[id].tsx')

  assert.match(source, /pendingOwnSendBottomScrollRef/)
  assert.match(source, /pendingOwnMediaBatchScrollTransactionsRef/)
  assert.match(source, /pendingAnchorScrollTargetIdRef/)
  assert.match(source, /pendingReturnToLatestRef/)
  assert.match(source, /isNearBottomRef/)
})

test('message ordering remains canonical newest-first before the inverted list renders it', () => {
  const source = read('src/lib/messageListState.ts')

  assert.match(source, /sortMessagesCanonicalNewestFirst/)
  assert.match(source, /getMessageCreatedAtMs\(right\.createdAt\) - getMessageCreatedAtMs\(left\.createdAt\)/)
  assert.match(source, /mergeMessageCollectionByIdentity/)
})
