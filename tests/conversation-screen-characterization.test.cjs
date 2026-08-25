const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const productionFiles = [
  'app/conversation/[id].tsx',
  'src/lib/conversation/conversationMessagePolicies.ts',
  'src/lib/conversation/conversationPresentationPolicies.ts',
  'src/components/chat/conversation/ConversationHeader.tsx',
  'src/components/chat/conversation/ConversationMessageRow.tsx',
  'src/components/chat/conversation/ConversationLoadingState.tsx',
  'src/hooks/conversation/useConversationMetadata.ts',
  'src/hooks/conversation/useConversationReceiptModel.ts',
  'src/hooks/conversation/useConversationPresence.ts',
  'src/hooks/conversation/useConversationSessionRuntime.ts',
  'src/hooks/conversation/useConversationKeyboardRuntime.ts',
  'src/hooks/conversation/useConversationContextMenuRuntime.ts',
  'src/hooks/conversation/useConversationMediaViewerRuntime.ts',
  'src/hooks/conversation/useConversationTimelineController.ts',
  'src/hooks/conversation/useConversationComposerRuntime.ts',
]

const sources = () =>
  productionFiles
    .map((relativePath) => ({
      relativePath,
      absolutePath: path.join(root, relativePath),
    }))
    .filter(({ absolutePath }) => fs.existsSync(absolutePath))
    .map(({ relativePath, absolutePath }) => ({
      relativePath,
      source: fs.readFileSync(absolutePath, 'utf8'),
    }))

const readBundle = () =>
  sources()
    .map(({ source }) => source)
    .join('\n')

const findBlock = (startMarker, endMarker) => {
  for (const { relativePath, source } of sources()) {
    const start = source.indexOf(startMarker)
    if (start === -1) continue
    const end = source.indexOf(endMarker, start + startMarker.length)
    assert.notEqual(end, -1, `${relativePath}: missing end marker ${endMarker}`)
    return source.slice(start, end)
  }

  assert.fail(`missing start marker: ${startMarker}`)
}

const assertOrdered = (source, markers, label) => {
  let previous = -1
  for (const marker of markers) {
    const index = source.indexOf(marker, previous + 1)
    assert.notEqual(index, -1, `${label}: missing ${marker}`)
    assert.ok(index > previous, `${label}: ${marker} is out of order`)
    previous = index
  }
}

const countMatches = (source, regex, valueAt = 1) => {
  const counts = {}
  for (const match of source.matchAll(regex)) {
    const value = match[valueAt]
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

test('conversation side-effect manifest remains stable across file moves', () => {
  const bundle = readBundle()
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'tests/conversation-screen-refactor-manifest.json'), 'utf8'),
  )

  assert.equal(
    (bundle.match(/requestAnimationFrame\(/g) ?? []).length,
    manifest.requestAnimationFrameCalls,
  )
  assert.deepEqual(countMatches(bundle, /\bsocket(?:\?)?\.emit\('([^']+)'/g), manifest.socketEmits)
  assert.deepEqual(
    countMatches(bundle, /setTimeout\([\s\S]*?,\s*([0-9_]+)\s*\)/g),
    manifest.timeoutsMs,
  )
  assert.deepEqual(
    countMatches(
      bundle,
      /\b(confirmMessage|dequeueOfflineMessage|setReplyToMessage|resetConversationUi|clearConversationInlinePlayback)\(/g,
    ),
    manifest.storeMutations,
  )
  assert.deepEqual(
    countMatches(
      bundle,
      /\b(queryClient\.(?:setQueryData|cancelQueries)|trimMessagesCache|syncLatestMessagesToLocalStore|refreshLatestMessagesPageFromLocalStore)\(/g,
    ),
    manifest.queryOperations,
  )
  assert.match(bundle, /setInterval\([\s\S]*?,\s*60 \* 1000\s*\)/)
})

test('latest timeline includes optimistic messages while anchor timeline excludes them', () => {
  const bundle = readBundle()

  assert.match(
    bundle,
    /timelineMode === 'anchor' \? \(anchorData\?\.messages \?\? EMPTY_MESSAGES\) : serverMessages/,
  )
  assert.match(
    bundle,
    /localOptimistic: timelineMode === 'latest' \? localOptimistic : EMPTY_MESSAGES/,
  )
  assert.match(bundle, /sortMessagesCanonicalNewestFirst\(/)
  assert.match(bundle, /mergeMessageCollectionByIdentity\(flattenedMessages\)/)
})

test('text optimistic confirmation remains delayed and excludes media', () => {
  const block = findBlock(
    'if (serverMessages.length === 0 || localOptimistic.length === 0) return',
    'const newestMessage = orderedMessages[0]',
  )

  assertOrdered(
    block,
    [
      'setTimeout(() =>',
      'message.clientMessageId &&',
      "message.type === 'text'",
      '!message.media',
      'confirmMessage(msg.clientMessageId, msg)',
      'dequeueOfflineMessage(msg.clientMessageId)',
      '}, 500)',
    ],
    'optimistic confirmation',
  )
})

test('own-send scroll intent is armed before text and media optimistic commits', () => {
  const textBlock = findBlock(
    'const handleSendText = useCallback',
    'const handleSendSuggestedQuery',
  )
  const mediaBlock = findBlock('const handleSendMedia = useCallback', 'const handleTyping')

  assertOrdered(
    textBlock,
    ["pendingOwnSendBottomScrollRef.current = 'animated'", 'sendMessage({'],
    'text send',
  )
  assertOrdered(
    mediaBlock,
    [
      "pendingOwnSendBottomScrollRef.current = 'animated'",
      'await enqueueMediaAssets(assets, {',
      'onWillCommitBatch: registerPendingOwnMediaBatchScrollTransaction',
    ],
    'media send',
  )
})

test('media batches scroll once and suppress confirmation scrolls until the batch clears', () => {
  const transactionBlock = findBlock(
    'const registerPendingOwnMediaBatchScrollTransaction = useCallback',
    'const scrollToBottom = useCallback',
  )
  const newestBlock = findBlock(
    'if (newestMessageId && newestMessageId !== prevNewestMessageId.current)',
    'prevNewestMessageId.current = newestMessageId',
  )

  assertOrdered(
    transactionBlock,
    [
      'pendingOwnMediaBatchScrollTransactionsRef.current.set',
      'pendingConfirmSuppressClientMessageIds: new Set(batch.clientMessageIds)',
      'pendingOwnMediaBatchByClientMessageIdRef.current.set',
      'transactions.delete(batchId)',
      'pendingOwnMediaBatchByClientMessageIdRef.current.delete',
    ],
    'media batch registry',
  )
  assertOrdered(
    newestBlock,
    [
      'newestBelongsToPendingOwnMediaBatch',
      'shouldSuppressPendingOwnMediaConfirmScroll',
      'pendingOwnMediaBatchScrollTransaction.initialScrollConsumed = true',
      'pendingConfirmSuppressClientMessageIds.delete',
      'clearPendingOwnMediaBatchScrollTransaction',
    ],
    'media batch newest-message handling',
  )
})

test('bottom follow preserves Android one-frame and reply/return two-frame scheduling', () => {
  const newestHelper = findBlock(
    'const scrollToBottomForNewestMessage = useCallback',
    'const handleComposerFocusChange',
  )
  const replyHelper = findBlock('const runReplyScroll = useCallback', 'const handleScrollToMessage')
  const returnEffect = findBlock(
    'const pendingAnchorTargetId = pendingAnchorScrollTargetIdRef.current',
    'useEffect(() => {\n    return () => {',
  )

  assert.equal((newestHelper.match(/requestAnimationFrame\(/g) ?? []).length, 1)
  assert.equal((replyHelper.match(/requestAnimationFrame\(/g) ?? []).length, 2)
  assert.match(newestHelper, /Platform\.OS === 'android'/)
  assert.equal((returnEffect.match(/requestAnimationFrame\(/g) ?? []).length, 2)
})

test('reply jumps prefer loaded messages and anchor only persisted remote targets', () => {
  const block = findBlock(
    'const handleScrollToMessage = useCallback',
    'const handleMessageViewportLayout',
  )

  assertOrdered(
    block,
    [
      'if (scrollToMessageById(replyToId))',
      'pendingAnchorScrollTargetIdRef.current === replyToId && isResolvingAnchor',
      'if (!isPersistedServerMessageId(replyToId))',
      'pendingAnchorScrollTargetIdRef.current = replyToId',
      'const started = await resolveAnchorTarget(replyToId)',
      'pendingAnchorScrollTargetIdRef.current = null',
      "setTimelineMode('anchor')",
    ],
    'reply jump',
  )
})

test('seen frontier is connected, deduplicated and limited to latest near-bottom mode', () => {
  const emitBlock = findBlock('const emitMarkSeenToFrontier = useCallback', 'useEffect(() => {')
  const effectBlock = findBlock(
    "timelineMode !== 'latest' ||\n      !isConnected ||\n      !isNearBottom",
    'useEffect(() => {\n    const wasConnected',
  )

  assertOrdered(
    emitBlock,
    [
      'if (!socket?.connected)',
      'lastSentSeenFrontierRef.current === frontierKey',
      "socket.emit('mark_seen'",
      'lastSentSeenFrontierRef.current = frontierKey',
      'clearConversationUnread(conversationId)',
    ],
    'mark seen',
  )
  assert.match(effectBlock, /timelineMode !== 'latest'/)
  assert.match(effectBlock, /!isNearBottom/)
  assert.match(effectBlock, /!latestSeenFrontierMessageId/)
})

test('join and reconnect effects retain delay, cancellation and local-first refresh order', () => {
  const bundle = readBundle()
  const reconnectBlock = findBlock(
    'const syncConversationAfterReconnect = async () => {',
    'const participantsMap = useMemo',
  )

  assert.match(bundle, /socket\.emit\('join_conversation', conversationId\)[\s\S]*}, 100\)/)
  assertOrdered(
    reconnectBlock,
    [
      'await syncLatestMessagesToLocalStore({',
      'if (cancelled)',
      'await refreshLatestMessagesPageFromLocalStore({',
      'return () => {',
      'cancelled = true',
    ],
    'reconnect sync',
  )
})

test('typing emits and cleanup preserve the two-second debounce', () => {
  const typingBlock = findBlock(
    'const handleTyping = useCallback',
    'const handleReply = useCallback',
  )
  const sendBlock = findBlock(
    'const handleSendText = useCallback',
    'const handleSendSuggestedQuery',
  )
  const cleanupBlock = findBlock(
    'useEffect(() => {\n    return () => {',
    'const currentOlderLoader',
  )

  assertOrdered(
    typingBlock,
    [
      'if (!text.trim())',
      "socket.emit('typing_stop'",
      "socket.emit('typing_start'",
      'typingTimeoutRef.current = setTimeout',
      "socket.emit('typing_stop'",
      '}, 2000)',
    ],
    'typing debounce',
  )
  assert.match(sendBlock, /socket\?\.emit\('typing_stop'/)
  assert.match(cleanupBlock, /socket\.emit\('typing_stop'/)
})

test('keyboard and context-menu ordering preserves focus and layout space', () => {
  const openBlock = findBlock(
    'const prepareContextMenuKeyboardPreservation = useCallback',
    'const { displayName, avatarUrl, otherUserId }',
  )

  assertOrdered(
    openBlock,
    [
      'preservedKeyboardOffset.value = activeKeyboardHeight',
      'setActiveContextMenu(payload)',
      'requestAnimationFrame(() => {',
      'messageInputRef.current?.blur()',
      'KeyboardController.dismiss()',
    ],
    'open context menu',
  )
  assertOrdered(
    openBlock,
    [
      'messageInputRef.current?.focus()',
      'setTimeout(() => {',
      'shouldRestoreComposerFocusRef.current = false',
      'releasePreservedKeyboardOffset()',
      '}, 280)',
    ],
    'close context menu',
  )
})

test('conversation change and unmount cleanup retain every owned resource action', () => {
  const changeBlock = findBlock(
    'setActiveContextMenu(null)\n    closeMediaViewer()',
    "if (timelineMode !== 'latest')",
  )
  const unmountBlock = findBlock(
    'useEffect(() => {\n    return () => {',
    'const currentOlderLoader',
  )

  for (const marker of [
    'clearConversationInlinePlayback(conversationId)',
    'pendingAnchorScrollTargetIdRef.current = null',
    'pendingReturnToLatestRef.current = false',
    "setTimelineMode('latest')",
    'clearAnchor()',
    'resetConversationUi(conversationId)',
  ]) {
    assert.match(changeBlock, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assertOrdered(
    unmountBlock,
    [
      'clearTimeout(typingTimeoutRef.current)',
      "socket.emit('typing_stop'",
      'clearTimeout(replyHighlightTimeoutRef.current)',
      'clearReplyJumpSettleTimeout()',
      'queryClient.cancelQueries',
      'trimMessagesCache(queryClient, conversationId)',
    ],
    'unmount cleanup',
  )
})

test('group receipts and direct-only call entry points remain distinct', () => {
  const bundle = readBundle()
  const receiptBlock = findBlock('const latestOutgoingMessage =', 'const latestOutgoingIndex =')

  assert.match(receiptBlock, /conversation\?\.isGroup/)
  assert.match(receiptBlock, /newestParticipantMessage/)
  assert.match(receiptBlock, /newestReadOutgoingMessage/)
  assert.match(receiptBlock, /readReceiptMap\.set/)
  assert.match(bundle, /if \(!otherUserId \|\| currentConversation\?\.isGroup\)/)
  assert.match(bundle, /startVoiceCall\(\{/)
  assert.match(bundle, /startVideoCall\(\{/)
})

test('FlashList parity keeps inversion and Android manual insert ownership', () => {
  const bundle = readBundle()

  assert.match(bundle, /<FlashList/)
  assert.match(bundle, /\binverted\b/)
  assert.match(
    bundle,
    /maintainVisibleContentPosition=\{\{ disabled: Platform\.OS === 'android' \}\}/,
  )
  assert.match(bundle, /keyboardDismissMode="none"/)
  assert.match(bundle, /removeClippedSubviews=\{false\}/)
})
