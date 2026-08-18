const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('latest older pagination treats local plus remote work as one fetch transaction', () => {
  const source = read('src/hooks/useMessages.ts')

  assert.match(source, /older-page-transaction-start/)
  assert.match(source, /const remotePage = await syncMessagesPageToLocalStore\(/)
  assert.match(source, /const authoritativePage =/)
  assert.match(source, /return authoritativePage/)
})

test('latest older pagination suppresses only concurrent work and remains retryable after failure', () => {
  const source = read('src/hooks/useMessages.ts')

  assert.match(source, /const olderFetchInFlightRef = useRef\(false\)/)
  assert.match(source, /olderFetchInFlightRef\.current = true/)
  assert.match(source, /olderFetchInFlightRef\.current = false/)
  assert.doesNotMatch(source, /failedOlderCursorRef/)
})

test('anchor older pagination keeps one authoritative transaction until remote reconciliation settles', () => {
  const source = read('src/hooks/useAnchoredMessages.ts')
  const olderBlock = source.slice(
    source.indexOf('const loadAnchorOlder = useCallback('),
    source.indexOf('const loadAnchorNewer = useCallback('),
  )

  assert.match(olderBlock, /isFetchingOlder: true/)
  assert.match(olderBlock, /await conversationApi\.getMessagesAnchorOlder/)
  assert.match(olderBlock, /current\.oldestCursor !== cursor/)
  assert.match(olderBlock, /hasOlder: true/)
  assert.doesNotMatch(olderBlock, /failedAnchorCursorGuardRef/)
})

test('anchor older remote failure keeps the original cursor retryable', () => {
  const source = read('src/hooks/useAnchoredMessages.ts')
  const olderBlock = source.slice(
    source.indexOf('const loadAnchorOlder = useCallback('),
    source.indexOf('const loadAnchorNewer = useCallback('),
  )
  const catchBlock = olderBlock.slice(olderBlock.lastIndexOf('} catch (error)'))

  assert.match(catchBlock, /hasOlder: true/)
  assert.match(catchBlock, /isFetchingOlder: false/)
  assert.doesNotMatch(catchBlock, /oldestCursor: localPage\.nextCursor/)
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

test('message identity dedupe uses indexed tokens instead of scanning the full merged history', () => {
  const source = read('src/lib/messageIdentity.ts')
  const mergeBlock = source.slice(
    source.indexOf('export const mergeMessageCollectionByIdentity'),
    source.indexOf('export const isMessageBeyondOptimisticReadFrontier'),
  )

  assert.match(mergeBlock, /indicesByIdentityToken = new Map/)
  assert.match(mergeBlock, /identityTokensByIndex/)
  assert.doesNotMatch(mergeBlock, /mergedMessages\.findIndex/)
})

test('message metadata merge preserves AI citations during dedupe', () => {
  const source = read('src/lib/messageIdentity.ts')
  const metadataBlock = source.slice(
    source.indexOf('export const mergeMessageMetadata'),
    source.indexOf('export const mergeMessageRecords'),
  )

  assert.match(metadataBlock, /hasOwnProperty\.call\(incoming, 'citations'\)/)
  assert.match(metadataBlock, /citations !== undefined \? \{ citations \} : \{\}/)
})

test('FlashList message bubbles do not key the heavy recycled subtree by message id', () => {
  const source = read('src/components/chat/MessageBubble.tsx')

  assert.match(source, /key=\{getCitationRenderKey\(props\)\}/)
  assert.doesNotMatch(source, /key=\{`\$\{props\.message\.id\}/)
})

test('timeline diagnostics never log message content by contract', () => {
  const source = read('src/lib/chatTimelineDiagnostics.ts')

  assert.match(source, /Intentionally never include message content/)
  assert.doesNotMatch(source, /content:/)
})
