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
  const prepareBlock = findBlock(
    'const prepareOwnSendBottomFollow = useCallback',
    'const cancelOwnSendBottomFollow',
  )

  assertOrdered(textBlock, ['prepareOwnSendBottomFollow()', 'sendMessage({'], 'text send')
  assertOrdered(
    mediaBlock,
    [
      'prepareOwnSendBottomFollow()',
      'await enqueueMediaAssets(assets, {',
      'onWillCommitBatch: registerPendingOwnMediaBatchScrollTransaction',
    ],
    'media send',
  )
  assertOrdered(
    prepareBlock,
    ["pendingOwnSendBottomScrollRef.current = 'animated'", 'returnToLatestTimeline(false)'],
    'own-send bottom-follow preparation',
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

test('timeline controller exposes the screen contract without changing hook APIs', () => {
  const timeline = sources().find(({ relativePath }) =>
    relativePath.endsWith('useConversationTimelineController.ts'),
  )?.source

  assert.ok(timeline)
  assert.match(timeline, /useMessages\(conversationId\)/)
  assert.match(timeline, /useAnchoredMessages\(\{[\s\S]*conversation,[\s\S]*conversationId/)
  assertOrdered(
    timeline,
    [
      'const { orderedMessages, layoutById, messageById, indexById } = useMemo',
      'layoutByIdRef.current = layoutById',
      'indexByIdRef.current = indexById',
    ],
    'synchronous timeline map publication',
  )
  assert.match(timeline, /\}, \[conversationId, socket\]\)/)
  assert.match(timeline, /cancelOwnSendBottomFollow/)
  for (const field of [
    'currentOlderLoader',
    'handleScrollToMessage',
    'hasLoadedLatestMessagePages',
    'latestSeenFrontierMessageId',
    'prepareOwnSendBottomFollow',
    'registerPendingOwnMediaBatchScrollTransaction',
    'timestampRevealGesture',
  ]) {
    assert.match(timeline, new RegExp(`\\b${field},`))
  }
})

test('bottom follow preserves Android one-frame and reply/return two-frame scheduling', () => {
  const newestHelper = findBlock(
    'const scrollToBottomForNewestMessage = useCallback',
    'const loadOlderMessages',
  )
  const replyHelper = findBlock('const runReplyScroll = useCallback', 'const handleScrollToMessage')
  const returnEffect = findBlock(
    'const pendingAnchorTargetId = pendingAnchorScrollTargetIdRef.current',
    'const currentOlderLoader',
  )

  assert.equal((newestHelper.match(/requestAnimationFrame\(/g) ?? []).length, 1)
  assert.equal((replyHelper.match(/requestAnimationFrame\(/g) ?? []).length, 2)
  assert.match(newestHelper, /Platform\.OS === 'android'/)
  assert.equal((returnEffect.match(/requestAnimationFrame\(/g) ?? []).length, 2)
})

test('reply jumps prefer loaded messages and anchor only persisted remote targets', () => {
  const block = findBlock(
    'const handleScrollToMessage = useCallback',
    "useEffect(() => {\n    if (\n      timelineMode === 'anchor' &&",
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
    'return { transitionDone }',
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

test('session runtime owns the transition, seen frontier and query lifecycle only', () => {
  const session = sources().find(({ relativePath }) =>
    relativePath.endsWith('useConversationSessionRuntime.ts'),
  )?.source

  assert.ok(session)
  assertOrdered(
    session,
    [
      'InteractionManager.runAfterInteractions',
      'setTransitionDone(true)',
      'return () => handle.cancel()',
    ],
    'transition gate',
  )
  assert.match(session, /const lastSentSeenFrontierRef = useRef<string \| null>\(null\)/)
  assert.match(session, /const previousIsConnectedRef = useRef\(isConnected\)/)
  assert.match(session, /lastSentSeenFrontierRef\.current = null/)
  assert.match(session, /queryClient\.setQueryData<[\s\S]*queryKeys\.conversations\.all/)
  assert.match(session, /queryKeys\.conversations\.messages\(conversationId\)/)
  assert.doesNotMatch(
    session,
    /typingTimeoutRef|replyHighlightTimeoutRef|replyJumpSettleTimeoutRef/,
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
    'if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)',
    'const handleSendMedia = useCallback',
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

test('composer publishes timeline actions synchronously without changing cleanup order', () => {
  const screen = sources().find(
    ({ relativePath }) => relativePath === 'app/conversation/[id].tsx',
  )?.source

  assert.ok(screen)
  assertOrdered(
    screen,
    [
      '} = useConversationComposerRuntime({',
      '} = useConversationTimelineController({',
      'composerTimelineActionsRef.current = {',
      'cancelOwnSendBottomFollow,',
      'prepareOwnSendBottomFollow,',
      'registerPendingOwnMediaBatchScrollTransaction,',
      'resetTimestampRevealForReply,',
      'useConversationSessionRuntime({',
    ],
    'composer timeline bridge',
  )

  const composer = sources().find(({ relativePath }) =>
    relativePath.endsWith('useConversationComposerRuntime.ts'),
  )?.source
  assert.ok(composer)
  assert.match(composer, /const requireTimelineActions =/)
  assert.doesNotMatch(composer, /if \(!timeline\) return/)
})

test('keyboard and context-menu ordering preserves focus and layout space', () => {
  const keyboard = sources().find(({ relativePath }) =>
    relativePath.endsWith('useConversationKeyboardRuntime.ts'),
  )?.source
  const contextMenu = sources().find(({ relativePath }) =>
    relativePath.endsWith('useConversationContextMenuRuntime.ts'),
  )?.source

  assert.ok(keyboard)
  assert.ok(contextMenu)

  assertOrdered(
    contextMenu,
    [
      'prepareContextMenuKeyboardPreservation()',
      'setActiveContextMenu(payload)',
      'dismissKeyboardForContextMenu()',
    ],
    'open context menu',
  )
  assertOrdered(
    keyboard,
    [
      'shouldRestoreComposerFocusRef.current = true',
      'preservedKeyboardOffset.value = activeKeyboardHeight',
    ],
    'preserve keyboard space',
  )
  assertOrdered(
    keyboard,
    [
      'const dismissKeyboardForContextMenu = useCallback',
      'requestAnimationFrame(() => {',
      'messageInputRef.current?.blur()',
      'KeyboardController.dismiss()',
    ],
    'dismiss context-menu keyboard',
  )
  assertOrdered(
    keyboard,
    [
      'messageInputRef.current?.focus()',
      'setTimeout(() => {',
      'shouldRestoreComposerFocusRef.current = false',
      'releasePreservedKeyboardOffset()',
      '}, 280)',
    ],
    'close context menu',
  )
  assert.match(keyboard, /withTiming\(0, \{ duration: 120 \}\)/)
  assert.match(keyboard, /withTiming\(0, \{ duration: 160 \}\)/)
})

test('context menu and media runtimes retain live message and bounded gallery behavior', () => {
  const contextMenu = sources().find(({ relativePath }) =>
    relativePath.endsWith('useConversationContextMenuRuntime.ts'),
  )?.source
  const media = sources().find(({ relativePath }) =>
    relativePath.endsWith('useConversationMediaViewerRuntime.ts'),
  )?.source

  assert.ok(contextMenu)
  assert.ok(media)
  assert.match(
    contextMenu,
    /messageById\.get\(activeContextMenuMessageId\) \?\? activeContextMenuMessage/,
  )
  assert.match(contextMenu, /layoutById\.get\(currentMessage\.id\)/)
  assert.match(contextMenu, /currentMessage\.senderId === currentUserId/)
  assert.match(media, /buildConversationMediaGalleryItems\(orderedMessages\)/)
  assert.match(media, /getConversationMediaViewerItems\(\{/)
  assert.match(media, /if \(sourceIndex < 0\)/)
  assert.match(media, /onSave: handleSaveMedia/)
})

test('conversation change and unmount cleanup retain every owned resource action', () => {
  const mediaChangeBlock = findBlock(
    'clearActiveContextMenu()\n    closeMediaViewer()',
    'return {\n    closeMediaViewer',
  )
  const timelineChangeBlock = findBlock(
    'resetConversationKeyboard()\n    timestampRevealOffset.value = 0',
    "if (timelineMode !== 'latest')",
  )
  const unmountBlock = findBlock(
    'if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)',
    'const handleSendMedia = useCallback',
  )
  const timelineUnmountBlock = findBlock(
    'if (replyHighlightTimeoutRef.current) clearTimeout(replyHighlightTimeoutRef.current)',
    'const serverMessages = useMemo',
  )
  const sessionCleanupBlock = findBlock(
    'const messagesQueryKey = queryKeys.conversations.messages(conversationId)',
    'return { transitionDone }',
  )

  for (const marker of ['clearConversationInlinePlayback(conversationId)']) {
    assert.match(mediaChangeBlock, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assertOrdered(
    mediaChangeBlock,
    [
      'clearActiveContextMenu()',
      'closeMediaViewer()',
      'clearConversationInlinePlayback(conversationId)',
      'return () => {',
      'closeMediaViewer()',
      'clearConversationInlinePlayback(conversationId)',
    ],
    'media conversation cleanup',
  )
  for (const marker of [
    'resetConversationKeyboard()',
    'clearConversationInlinePlayback(conversationId)',
    'pendingAnchorScrollTargetIdRef.current = null',
    'pendingReturnToLatestRef.current = false',
    "setTimelineMode('latest')",
    'clearAnchor()',
    'resetConversationUi(conversationId)',
  ]) {
    if (marker === 'clearConversationInlinePlayback(conversationId)') continue
    assert.match(timelineChangeBlock, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assertOrdered(
    unmountBlock,
    ['clearTimeout(typingTimeoutRef.current)', "socket.emit('typing_stop'"],
    'composer unmount cleanup',
  )
  assertOrdered(
    timelineUnmountBlock,
    [
      'clearTimeout(replyHighlightTimeoutRef.current)',
      'clearTimeout(replyJumpSettleTimeoutRef.current)',
    ],
    'timeline unmount cleanup',
  )
  assertOrdered(
    sessionCleanupBlock,
    ['queryClient.cancelQueries', 'trimMessagesCache(queryClient, conversationId)'],
    'session query cleanup',
  )

  const screen = sources().find(
    ({ relativePath }) => relativePath === 'app/conversation/[id].tsx',
  )?.source
  assert.ok(screen)
  const composerCleanupRegistration = screen.indexOf('} = useConversationComposerRuntime({')
  const timelineRegistration = screen.indexOf('useConversationTimelineController({')
  const sessionRegistration = screen.indexOf('useConversationSessionRuntime({')
  assert.ok(
    composerCleanupRegistration < timelineRegistration &&
      timelineRegistration < sessionRegistration,
    'composer/timeline cleanup must register before session query cleanup',
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

test('metadata, receipt and presence hooks preserve their original ownership boundaries', () => {
  const metadata = sources().find(({ relativePath }) =>
    relativePath.endsWith('useConversationMetadata.ts'),
  )?.source
  const receipt = sources().find(({ relativePath }) =>
    relativePath.endsWith('useConversationReceiptModel.ts'),
  )?.source
  const presence = sources().find(({ relativePath }) =>
    relativePath.endsWith('useConversationPresence.ts'),
  )?.source

  assert.ok(metadata)
  assert.ok(receipt)
  assert.ok(presence)

  assert.match(metadata, /queryKey: queryKeys\.conversations\.all/)
  assert.match(metadata, /allConversations\.find/)
  assert.match(metadata, /getConversationHeaderIdentity/)
  assert.match(metadata, /currentConversation\?\.participants\?\.forEach/)
  assert.match(metadata, /participant\.id !== currentUserId/)

  assert.match(receipt, /buildConversationReceiptModel\(\{/)
  assert.match(receipt, /\[conversation, currentUserId, orderedMessages, otherParticipant\]/)

  assertOrdered(
    presence,
    [
      'if (!transitionDone) return',
      'if (!isConnected || !otherUserId || isGroup) return',
      'requestPresence([otherUserId], { conversationId })',
    ],
    'presence request',
  )
  assert.match(
    presence,
    /setInterval\(\(\) => \{[\s\S]*setPresenceTick\(Date\.now\(\)\)[\s\S]*60 \* 1000/,
  )
  assert.match(presence, /return \(\) => clearInterval\(intervalId\)/)
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
