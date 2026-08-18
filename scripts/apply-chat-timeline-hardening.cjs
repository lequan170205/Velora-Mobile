const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content)

const replaceExact = (source, search, replacement, label) => {
  const count = source.split(search).length - 1
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`)
  }
  return source.replace(search, replacement)
}

const replaceBetween = (source, startMarker, endMarker, replacement, label) => {
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`${label}: start marker not found`)
  const secondStart = source.indexOf(startMarker, start + startMarker.length)
  if (secondStart >= 0) throw new Error(`${label}: start marker is not unique`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (end < 0) throw new Error(`${label}: end marker not found`)
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`
}

const patchUseAnchoredMessages = () => {
  const file = 'src/hooks/useAnchoredMessages.ts'
  let source = read(file)

  source = replaceExact(
    source,
    "import { mergeMessageCollectionsNewestFirst } from '../lib/messageListState'\n",
    "import { createChatTimelineTransactionId, traceChatTimeline } from '../lib/chatTimelineDiagnostics'\nimport { mergeMessageCollectionsNewestFirst } from '../lib/messageListState'\n",
    'useAnchoredMessages diagnostics import',
  )

  const olderBlock = `  const loadAnchorOlder = useCallback(
    async (trigger: AnchorLoadTrigger = 'edge') => {
      const anchorTargetId = activeAnchorTargetId
      if (!anchorTargetId) {
        return
      }

      const currentState = queryClient.getQueryData<AnchoredMessagesState>(
        queryKeys.conversations.messagesAround(conversationId, anchorTargetId),
      )

      if (!currentState?.hasOlder || !currentState.oldestCursor || currentState.isFetchingOlder) {
        return
      }

      const cursor = currentState.oldestCursor
      const transactionId = createChatTimelineTransactionId('anchor-older')
      olderAbortControllerRef.current?.abort()
      const controller = new AbortController()
      olderAbortControllerRef.current = controller

      updateCurrentAnchorState((current) => ({ ...current, isFetchingOlder: true }))
      traceChatTimeline({
        conversationId,
        event: 'anchor-older-transaction-start',
        mode: 'anchor',
        cursor,
        source: 'ui',
        trigger,
        transactionId,
      })

      const localPage = await getLocalMessagesOlderThanCursor({
        conversation: conversation ?? null,
        conversationId,
        currentUser: currentUser ?? null,
        cursor,
        limit: DEFAULT_ANCHOR_EXPANSION_LIMIT,
      })

      if (controller.signal.aborted || activeAnchorTargetIdRef.current !== anchorTargetId) {
        return
      }

      traceChatTimeline({
        conversationId,
        event: 'anchor-older-local-ready',
        mode: 'anchor',
        cursor,
        source: 'local',
        trigger,
        transactionId,
        count: localPage.messages.length,
      })

      if (!canFetchRemote) {
        updateCurrentAnchorState((current) => {
          if (current.targetMessageId !== anchorTargetId || current.oldestCursor !== cursor) {
            return current
          }

          const { oldestCursor: _oldestCursor, ...rest } = current
          return {
            ...rest,
            messages: mergeMessageCollectionsNewestFirst(current.messages, localPage.messages),
            hasOlder: localPage.hasMore,
            ...(localPage.nextCursor ? { oldestCursor: localPage.nextCursor } : {}),
            isFetchingOlder: false,
          }
        })
        return
      }

      const activeAnchorSyncRange = activeAnchorSyncRangeRef.current
      if (
        localPage.messages.length === 0 &&
        activeAnchorSyncRange?.anchorTargetId === anchorTargetId &&
        activeAnchorSyncRange.remoteExhaustedOlder
      ) {
        updateCurrentAnchorState((current) => {
          if (current.targetMessageId !== anchorTargetId || current.oldestCursor !== cursor) {
            return current
          }

          return {
            ...current,
            hasOlder: false,
            isFetchingOlder: false,
          }
        })
        return
      }

      try {
        const response = await conversationApi.getMessagesAnchorOlder(conversationId, {
          cursor,
          limit: DEFAULT_ANCHOR_EXPANSION_LIMIT,
          signal: controller.signal,
        })

        await upsertRemoteMessages({
          conversation: conversation ?? null,
          currentUser: currentUser ?? null,
          messages: response.messages,
        })

        updateActiveAnchorSyncRangeFromWrite(
          anchorTargetId,
          writeAnchorOlderSyncRangeMetadata({
            anchorTargetId,
            conversationId,
            response,
          }),
        )

        if (controller.signal.aborted || activeAnchorTargetIdRef.current !== anchorTargetId) {
          return
        }

        updateCurrentAnchorState((current) => {
          if (current.targetMessageId !== anchorTargetId || current.oldestCursor !== cursor) {
            return current
          }

          const { oldestCursor: _oldestCursor, ...rest } = current
          const mergedMessages = mergeMessageCollectionsNewestFirst(
            mergeMessageCollectionsNewestFirst(current.messages, localPage.messages),
            response.messages,
          )

          return {
            ...rest,
            messages: mergedMessages,
            hasOlder: response.hasMore,
            ...(response.nextCursor ? { oldestCursor: response.nextCursor } : {}),
            isFetchingOlder: false,
          }
        })

        traceChatTimeline({
          conversationId,
          event: 'anchor-older-transaction-complete',
          mode: 'anchor',
          cursor,
          source: 'remote',
          trigger,
          transactionId,
          count: response.messages.length,
          details: { localCount: localPage.messages.length, hasMore: response.hasMore },
        })
      } catch (error) {
        if ((error as Error).name === 'CanceledError' || controller.signal.aborted) {
          return
        }

        // Local messages may be rendered as fallback, but the original cursor
        // remains authoritative so the next edge trigger retries the same gap.
        updateCurrentAnchorState((current) => {
          if (current.targetMessageId !== anchorTargetId || current.oldestCursor !== cursor) {
            return current
          }

          return {
            ...current,
            messages: mergeMessageCollectionsNewestFirst(current.messages, localPage.messages),
            hasOlder: true,
            isFetchingOlder: false,
          }
        })

        traceChatTimeline({
          conversationId,
          event: 'anchor-older-remote-fallback',
          mode: 'anchor',
          cursor,
          source: 'local',
          trigger: 'retry',
          transactionId,
          count: localPage.messages.length,
        })
      }
    },
    [
      activeAnchorTargetId,
      conversation,
      conversationId,
      currentUser,
      canFetchRemote,
      queryClient,
      updateActiveAnchorSyncRangeFromWrite,
      updateCurrentAnchorState,
    ],
  )
`

  source = replaceBetween(
    source,
    '  const loadAnchorOlder = useCallback(',
    '\n\n  const loadAnchorNewer = useCallback(',
    olderBlock,
    'useAnchoredMessages authoritative older transaction',
  )

  const patchedOlderBlock = source.slice(
    source.indexOf('  const loadAnchorOlder = useCallback('),
    source.indexOf('  const loadAnchorNewer = useCallback('),
  )
  if (patchedOlderBlock.includes('failedAnchorCursorGuardRef')) {
    throw new Error('anchor older flow still contains permanent failed cursor guard')
  }

  write(file, source)
}

const patchCharacterizationTests = () => {
  const file = 'tests/chat-timeline-characterization.test.cjs'
  let source = read(file)

  source = replaceBetween(
    source,
    "test('latest timeline remains local-first with background remote refresh until hardening changes it intentionally'",
    "\ntest('anchor timeline currently owns older work with an abort controller and cursor failure guard'",
    `test('latest older pagination treats local plus remote work as one fetch transaction', () => {
  const source = read('src/hooks/useMessages.ts')

  assert.match(source, /older-page-transaction-start/)
  assert.match(source, /const remotePage = await syncMessagesPageToLocalStore\\(/)
  assert.match(source, /const authoritativePage =/)
})

test('latest older pagination suppresses only concurrent work and remains retryable after failure', () => {
  const source = read('src/hooks/useMessages.ts')

  assert.match(source, /const olderFetchInFlightRef = useRef\\(false\\)/)
  assert.match(source, /olderFetchInFlightRef\\.current = true/)
  assert.match(source, /olderFetchInFlightRef\\.current = false/)
  assert.doesNotMatch(source, /failedOlderCursorRef/)
})
`,
    'latest characterization expectations',
  )

  source = replaceBetween(
    source,
    "test('anchor timeline currently owns older work with an abort controller and cursor failure guard'",
    "\ntest('ChatScreen keeps current inverted FlashList semantics during hardening'",
    `test('anchor older pagination keeps one authoritative transaction until remote reconciliation settles', () => {
  const source = read('src/hooks/useAnchoredMessages.ts')
  const olderBlock = source.slice(
    source.indexOf('const loadAnchorOlder = useCallback('),
    source.indexOf('const loadAnchorNewer = useCallback('),
  )

  assert.match(olderBlock, /isFetchingOlder: true/)
  assert.match(olderBlock, /await conversationApi\\.getMessagesAnchorOlder/)
  assert.match(olderBlock, /oldestCursor !== cursor/)
  assert.match(olderBlock, /hasOlder: true/)
  assert.doesNotMatch(olderBlock, /failedAnchorCursorGuardRef/)
})
`,
    'anchor characterization expectations',
  )

  write(file, source)
}

patchUseAnchoredMessages()
patchCharacterizationTests()
console.log('Applied guarded anchor older hardening patch.')
