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

const patchUseMessages = () => {
  const file = 'src/hooks/useMessages.ts'
  let source = read(file)

  source = replaceExact(
    source,
    "import { createClientMessageId } from '../lib/clientMessageId'\n",
    "import { createChatTimelineTransactionId, traceChatTimeline } from '../lib/chatTimelineDiagnostics'\nimport { createClientMessageId } from '../lib/clientMessageId'\n",
    'useMessages diagnostics import',
  )

  const localBranch = `    if (localPage.length > 0) {
      const sortedLocalPage = sortMessagesNewestFirst(localPage)

      if (!cursor || !isNetworkResolved || !isOnline) {
        traceChatTimeline({
          conversationId,
          event: 'older-page-local-ready',
          mode: 'latest',
          cursor: cursor ?? null,
          source: 'local',
          count: sortedLocalPage.length,
        })
        return sortedLocalPage
      }

      const transactionId = createChatTimelineTransactionId('latest-older')
      traceChatTimeline({
        conversationId,
        event: 'older-page-transaction-start',
        mode: 'latest',
        cursor,
        source: 'local',
        trigger: 'edge',
        transactionId,
        count: sortedLocalPage.length,
      })

      try {
        const remotePage = await syncMessagesPageToLocalStore({
          conversation: conversation ?? null,
          conversationId,
          currentUser: currentUser ?? null,
          cursor,
          onLatestSyncRangeUpdated,
        })

        if (remotePage.length === 0) {
          traceChatTimeline({
            conversationId,
            event: 'older-page-transaction-complete',
            mode: 'latest',
            cursor,
            source: 'remote',
            transactionId,
            count: sortedLocalPage.length,
            details: { remoteCount: 0 },
          })
          return sortedLocalPage
        }

        const refreshedLocalPage = await getLocalMessagesPage({
          conversation: conversation ?? null,
          conversationId,
          currentUser: currentUser ?? null,
          cursor,
          limit: MESSAGE_PAGE_LIMIT,
        })
        const authoritativePage =
          refreshedLocalPage.length > 0
            ? sortMessagesNewestFirst(dedupeMessages(refreshedLocalPage))
            : sortMessagesNewestFirst(dedupeMessages([...localPage, ...remotePage]))

        traceChatTimeline({
          conversationId,
          event: 'older-page-transaction-complete',
          mode: 'latest',
          cursor,
          source: 'remote',
          transactionId,
          count: authoritativePage.length,
          details: {
            localCount: localPage.length,
            remoteCount: remotePage.length,
          },
        })

        return authoritativePage
      } catch (error) {
        console.warn('[Messages] Failed to sync older messages page; using local page', error)
        traceChatTimeline({
          conversationId,
          event: 'older-page-remote-fallback',
          mode: 'latest',
          cursor,
          source: 'local',
          trigger: 'retry',
          transactionId,
          count: sortedLocalPage.length,
        })
        return sortedLocalPage
      }
    }

`

  source = replaceBetween(
    source,
    '    if (localPage.length > 0) {',
    '    if (isCursorAtExhaustedOlderBoundary(cursor, latestSyncRange)) {',
    localBranch,
    'useMessages local/remote older transaction',
  )

  source = replaceExact(
    source,
    '  const failedOlderCursorRef = useRef<string | null>(null)\n',
    '  const olderFetchInFlightRef = useRef(false)\n',
    'useMessages failed cursor ref',
  )

  source = replaceExact(
    source,
    `  const nextOlderCursor = useMemo(
    () => getNextOlderCursorFromPages(query.data?.pages),
    [query.data?.pages],
  )

`,
    '',
    'useMessages next older cursor memo',
  )

  source = replaceExact(
    source,
    `  useEffect(() => {
    failedOlderCursorRef.current = null
    needsLatestSyncOnEntryRef.current = true
  }, [conversationId])
`,
    `  useEffect(() => {
    olderFetchInFlightRef.current = false
    needsLatestSyncOnEntryRef.current = true
  }, [conversationId])
`,
    'useMessages conversation reset',
  )

  source = replaceExact(
    source,
    `
  useEffect(() => {
    if (failedOlderCursorRef.current && failedOlderCursorRef.current !== nextOlderCursor) {
      failedOlderCursorRef.current = null
    }
  }, [nextOlderCursor])
`,
    '',
    'useMessages failed cursor reset effect',
  )

  source = replaceExact(
    source,
    `    if (!wasOnlineRef.current && isOnline) {
      failedOlderCursorRef.current = null
      needsLatestSyncOnEntryRef.current = true
    }
`,
    `    if (!wasOnlineRef.current && isOnline) {
      needsLatestSyncOnEntryRef.current = true
    }
`,
    'useMessages online reset',
  )

  source = replaceExact(
    source,
    `        failedOlderCursorRef.current = null
        needsLatestSyncOnEntryRef.current = false
`,
    `        needsLatestSyncOnEntryRef.current = false
`,
    'useMessages latest sync reset',
  )

  const fetchNextPageBlock = `  const fetchNextPage = useCallback(
    (...args: Parameters<typeof query.fetchNextPage>) => {
      if (olderFetchInFlightRef.current) {
        traceChatTimeline({
          conversationId,
          event: 'older-page-duplicate-trigger-suppressed',
          mode: 'latest',
          cursor: getNextOlderCursorFromPages(query.data?.pages),
          source: 'ui',
          trigger: 'edge',
        })
        return Promise.resolve(query as Awaited<ReturnType<typeof query.fetchNextPage>>)
      }

      const cursor = getNextOlderCursorFromPages(query.data?.pages)
      const transactionId = createChatTimelineTransactionId('latest-fetch-next')
      olderFetchInFlightRef.current = true

      traceChatTimeline({
        conversationId,
        event: 'older-page-fetch-requested',
        mode: 'latest',
        cursor,
        source: 'ui',
        trigger: 'edge',
        transactionId,
      })

      return query.fetchNextPage(...args).finally(() => {
        olderFetchInFlightRef.current = false
        traceChatTimeline({
          conversationId,
          event: 'older-page-fetch-settled',
          mode: 'latest',
          cursor,
          source: 'ui',
          trigger: 'edge',
          transactionId,
        })
      })
    },
    [conversationId, query],
  )
`

  source = replaceBetween(
    source,
    '  const fetchNextPage = useCallback(',
    '\n\n  return useMemo(',
    fetchNextPageBlock,
    'useMessages retryable fetchNextPage',
  )

  if (source.includes('failedOlderCursorRef')) {
    throw new Error('useMessages: permanent failedOlderCursorRef still present after patch')
  }

  write(file, source)
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

        // A transient remote failure must not advance the authoritative cursor.
        // Local data may still be shown, but the original cursor remains retryable.
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

  write(file, source)
}

const patchCharacterizationTests = () => {
  const file = 'tests/chat-timeline-characterization.test.cjs'
  let source = read(file)

  source = replaceExact(
    source,
    `test('latest timeline remains local-first with background remote refresh until hardening changes it intentionally', () => {
  const source = read('src/hooks/useMessages.ts')

  assert.match(source, /const localPage = await getLocalMessagesPage\\(/)
  assert.match(source, /if \\(localPage\\.length > 0\\)/)
  assert.match(source, /void syncMessagesPageToLocalStore\\(/)
  assert.match(source, /return sortMessagesNewestFirst\\(localPage\\)/)
  assert.match(source, /pages\\[pageIndex\\] = localPage/)
})

test('latest timeline currently contains an explicit failed older cursor guard', () => {
  const source = read('src/hooks/useMessages.ts')

  assert.match(source, /const failedOlderCursorRef = useRef<string \\| null>\\(null\\)/)
  assert.match(source, /failedOlderCursorRef\\.current === cursor/)
  assert.match(source, /failedOlderCursorRef\\.current = cursor/)
})
`,
    `test('latest older pagination treats local plus remote work as one fetch transaction', () => {
  const source = read('src/hooks/useMessages.ts')

  assert.match(source, /older-page-transaction-start/)
  assert.match(source, /const remotePage = await syncMessagesPageToLocalStore\\(/)
  assert.match(source, /const authoritativePage =/)
  assert.doesNotMatch(source, /void syncMessagesPageToLocalStore\\(\\{[\\s\\S]*Failed to sync older messages page/)
})

test('latest older pagination suppresses only concurrent work and remains retryable after failure', () => {
  const source = read('src/hooks/useMessages.ts')

  assert.match(source, /const olderFetchInFlightRef = useRef\\(false\\)/)
  assert.match(source, /olderFetchInFlightRef\\.current = true/)
  assert.match(source, /olderFetchInFlightRef\\.current = false/)
  assert.doesNotMatch(source, /failedOlderCursorRef/)
})
`,
    'characterization latest expectations',
  )

  source = replaceExact(
    source,
    `test('anchor timeline currently owns older work with an abort controller and cursor failure guard', () => {
  const source = read('src/hooks/useAnchoredMessages.ts')

  assert.match(source, /const olderAbortControllerRef = useRef<AbortController \\| null>\\(null\\)/)
  assert.match(source, /const failedAnchorCursorGuardRef = useRef<Set<string>>\\(new Set\\(\\)\\)/)
  assert.match(source, /olderAbortControllerRef\\.current\\?\\.abort\\(\\)/)
  assert.match(source, /failedAnchorCursorGuardRef\\.current\\.has\\(guardKey\\)/)
})
`,
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
    'characterization anchor expectations',
  )

  write(file, source)
}

patchUseMessages()
patchUseAnchoredMessages()
patchCharacterizationTests()

console.log('Applied guarded chat timeline hardening patch.')
