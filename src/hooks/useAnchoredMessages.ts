import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  conversationApi,
  type AnchorExpansionResponse,
  type AnchorWindowResponse,
} from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import {
  getLocalMessageWindowAroundId,
  getLocalMessagesNewerThanCursor,
  getLocalMessagesOlderThanCursor,
  type LocalMessageWindowAroundId,
} from '../database/messageRepository'
import { upsertRemoteMessages } from '../database/messageSync'
import {
  buildRangeBoundaryFromMessages,
  getAnchorMessageSyncRanges,
  upsertMessageSyncRange,
  type MessageSyncRangeBoundary,
  type MessageSyncRangeSnapshot,
} from '../database/messageSyncRangeRepository'
import { createChatTimelineTransactionId, traceChatTimeline } from '../lib/chatTimelineDiagnostics'
import { mergeMessageCollectionsNewestFirst } from '../lib/messageListState'
import { useNetworkStatus } from '../providers/NetworkProvider'
import { useAuthStore } from '../stores/authStore'

import type { Conversation, Message } from '../types/conversation.types'

const DEFAULT_ANCHOR_BEFORE = 30
const DEFAULT_ANCHOR_AFTER = 30
const DEFAULT_ANCHOR_EXPANSION_LIMIT = 30

export interface AnchoredMessagesState {
  targetMessageId: string
  messages: Message[]
  hasOlder: boolean
  hasNewer: boolean
  oldestCursor?: string
  newestCursor?: string
  isFetchingOlder: boolean
  isFetchingNewer: boolean
  source: 'local' | 'remote'
}

type AnchorLoadTrigger = 'edge' | 'bottom'

const isPersistedServerMessageId = (messageId?: string | null): messageId is string => {
  return Boolean(messageId && !messageId.startsWith('temp-'))
}

const normalizeAnchorWindowState = (
  value: AnchorWindowResponse | LocalMessageWindowAroundId,
  source: 'local' | 'remote',
  existing?: AnchoredMessagesState,
): AnchoredMessagesState => ({
  targetMessageId: value.targetMessageId,
  messages: value.messages,
  hasOlder: value.hasOlder ?? false,
  hasNewer: value.hasNewer ?? false,
  ...(value.oldestCursor ? { oldestCursor: value.oldestCursor } : {}),
  ...(value.newestCursor ? { newestCursor: value.newestCursor } : {}),
  isFetchingOlder: existing?.isFetchingOlder ?? false,
  isFetchingNewer: existing?.isFetchingNewer ?? false,
  source,
})

const mergeAnchorWindowMessagesWithRemoteMetadata = (
  localWindow: LocalMessageWindowAroundId | null,
  remoteWindow: AnchorWindowResponse,
): AnchorWindowResponse => ({
  ...remoteWindow,
  messages: localWindow
    ? mergeMessageCollectionsNewestFirst(localWindow.messages, remoteWindow.messages)
    : remoteWindow.messages,
  hasOlder: remoteWindow.hasOlder,
  hasNewer: remoteWindow.hasNewer,
  ...(remoteWindow.oldestCursor ? { oldestCursor: remoteWindow.oldestCursor } : {}),
  ...(remoteWindow.newestCursor ? { newestCursor: remoteWindow.newestCursor } : {}),
})

const getMergedCursorMetadata = ({
  currentCursor,
  currentHasMore,
  localHasMore,
  localNextCursor,
  remoteHasMore,
  remoteNextCursor,
  shouldUseRemote,
}: {
  currentCursor: string | undefined
  currentHasMore: boolean
  localHasMore: boolean
  localNextCursor: string | undefined
  remoteHasMore: boolean | undefined
  remoteNextCursor: string | undefined
  shouldUseRemote: boolean
}) => {
  if (shouldUseRemote && remoteHasMore !== undefined) {
    return {
      hasMore: remoteHasMore,
      nextCursor: remoteNextCursor,
    }
  }

  return {
    hasMore: localHasMore ? true : currentHasMore,
    nextCursor: localNextCursor ?? currentCursor,
  }
}

const getAnchorCursorGuardKey = ({
  anchorTargetId,
  conversationId,
  cursor,
  direction,
}: {
  anchorTargetId: string
  conversationId: string
  cursor: string
  direction: 'older' | 'newer'
}) => `${conversationId}:${anchorTargetId}:${direction}:${cursor}`

const getAnchorSyncRangeId = ({
  anchorTargetId,
  conversationId,
}: {
  anchorTargetId: string
  conversationId: string
}) => {
  return [
    'message-sync-anchor',
    encodeURIComponent(conversationId),
    encodeURIComponent(anchorTargetId),
  ].join(':')
}

const getUnifiedAnchorSyncRange = async ({
  anchorTargetId,
  conversationId,
}: {
  anchorTargetId: string
  conversationId: string
}) => {
  const rangeId = getAnchorSyncRangeId({ anchorTargetId, conversationId })
  const ranges = await getAnchorMessageSyncRanges(conversationId, anchorTargetId)
  return ranges.find((range) => range.id === rangeId) ?? null
}

const isStartBoundaryNewerThan = (
  candidate: Pick<MessageSyncRangeBoundary, 'startCreatedAt' | 'startMessageId'>,
  existing: Pick<MessageSyncRangeBoundary, 'startCreatedAt' | 'startMessageId'>,
) => {
  if (candidate.startCreatedAt === null || !candidate.startMessageId) {
    return false
  }

  if (existing.startCreatedAt === null || !existing.startMessageId) {
    return true
  }

  if (candidate.startCreatedAt !== existing.startCreatedAt) {
    return candidate.startCreatedAt > existing.startCreatedAt
  }

  return candidate.startMessageId.localeCompare(existing.startMessageId) > 0
}

const isEndBoundaryOlderThan = (
  candidate: Pick<MessageSyncRangeBoundary, 'endCreatedAt' | 'endMessageId'>,
  existing: Pick<MessageSyncRangeBoundary, 'endCreatedAt' | 'endMessageId'>,
) => {
  if (candidate.endCreatedAt === null || !candidate.endMessageId) {
    return false
  }

  if (existing.endCreatedAt === null || !existing.endMessageId) {
    return true
  }

  if (candidate.endCreatedAt !== existing.endCreatedAt) {
    return candidate.endCreatedAt < existing.endCreatedAt
  }

  return candidate.endMessageId.localeCompare(existing.endMessageId) < 0
}

const writeAnchorAroundSyncRangeMetadata = async ({
  anchorTargetId,
  conversationId,
  response,
}: {
  anchorTargetId: string
  conversationId: string
  response: AnchorWindowResponse
}) => {
  try {
    const boundary = buildRangeBoundaryFromMessages(response.messages)
    const syncedAt = Date.now()

    return await upsertMessageSyncRange({
      anchorTargetId,
      boundary,
      conversationId,
      id: getAnchorSyncRangeId({ anchorTargetId, conversationId }),
      isComplete: response.hasOlder === false && response.hasNewer === false,
      isContiguous: true,
      lastCursor: response.oldestCursor ?? response.newestCursor ?? boundary.endMessageId,
      lastSyncedAt: syncedAt,
      rangeType: 'anchor',
      remoteExhaustedNewer: response.hasNewer === false,
      remoteExhaustedOlder: response.hasOlder === false,
      remoteHasNewer: response.hasNewer,
      remoteHasOlder: response.hasOlder,
      source: 'remote_anchor_around',
    })
  } catch (error) {
    console.warn('[AnchorMetadata] Failed to persist anchor around sync range', error)
    return null
  }
}

const writeAnchorOlderSyncRangeMetadata = async ({
  anchorTargetId,
  conversationId,
  response,
}: {
  anchorTargetId: string
  conversationId: string
  response: AnchorExpansionResponse
}) => {
  try {
    const boundary = buildRangeBoundaryFromMessages(response.messages)
    const existingRange = await getUnifiedAnchorSyncRange({ anchorTargetId, conversationId })
    const syncedAt = Date.now()
    const nextBoundary: MessageSyncRangeBoundary = {
      startMessageId: existingRange?.startMessageId ?? boundary.startMessageId,
      startCreatedAt: existingRange?.startCreatedAt ?? boundary.startCreatedAt,
      endMessageId: existingRange?.endMessageId ?? boundary.endMessageId,
      endCreatedAt: existingRange?.endCreatedAt ?? boundary.endCreatedAt,
    }

    if (isEndBoundaryOlderThan(boundary, existingRange ?? emptySyncRangeBoundary)) {
      nextBoundary.endMessageId = boundary.endMessageId
      nextBoundary.endCreatedAt = boundary.endCreatedAt
    }

    return await upsertMessageSyncRange({
      anchorTargetId,
      boundary: nextBoundary,
      conversationId,
      id: getAnchorSyncRangeId({ anchorTargetId, conversationId }),
      isComplete: response.hasMore === false && existingRange?.remoteExhaustedNewer === true,
      lastCursor: response.nextCursor ?? boundary.endMessageId ?? existingRange?.lastCursor ?? null,
      lastSyncedAt: syncedAt,
      rangeType: 'anchor',
      remoteExhaustedOlder: response.hasMore === false,
      remoteHasOlder: response.hasMore,
      ...(response.messages.length > 0 ? { isContiguous: true } : {}),
      source: 'remote_anchor_older',
    })
  } catch (error) {
    console.warn('[AnchorMetadata] Failed to persist anchor older sync range', error)
    return null
  }
}

const writeAnchorNewerSyncRangeMetadata = async ({
  anchorTargetId,
  conversationId,
  response,
}: {
  anchorTargetId: string
  conversationId: string
  response: AnchorExpansionResponse
}) => {
  try {
    const boundary = buildRangeBoundaryFromMessages(response.messages)
    const existingRange = await getUnifiedAnchorSyncRange({ anchorTargetId, conversationId })
    const syncedAt = Date.now()
    const nextBoundary: MessageSyncRangeBoundary = {
      startMessageId: existingRange?.startMessageId ?? boundary.startMessageId,
      startCreatedAt: existingRange?.startCreatedAt ?? boundary.startCreatedAt,
      endMessageId: existingRange?.endMessageId ?? boundary.endMessageId,
      endCreatedAt: existingRange?.endCreatedAt ?? boundary.endCreatedAt,
    }

    if (isStartBoundaryNewerThan(boundary, existingRange ?? emptySyncRangeBoundary)) {
      nextBoundary.startMessageId = boundary.startMessageId
      nextBoundary.startCreatedAt = boundary.startCreatedAt
    }

    return await upsertMessageSyncRange({
      anchorTargetId,
      boundary: nextBoundary,
      conversationId,
      id: getAnchorSyncRangeId({ anchorTargetId, conversationId }),
      isComplete: response.hasMore === false && existingRange?.remoteExhaustedOlder === true,
      lastCursor:
        response.nextCursor ?? boundary.startMessageId ?? existingRange?.lastCursor ?? null,
      lastSyncedAt: syncedAt,
      rangeType: 'anchor',
      remoteExhaustedNewer: response.hasMore === false,
      remoteHasNewer: response.hasMore,
      ...(response.messages.length > 0 ? { isContiguous: true } : {}),
      source: 'remote_anchor_newer',
    })
  } catch (error) {
    console.warn('[AnchorMetadata] Failed to persist anchor newer sync range', error)
    return null
  }
}

const emptySyncRangeBoundary: MessageSyncRangeBoundary = {
  endCreatedAt: null,
  endMessageId: null,
  startCreatedAt: null,
  startMessageId: null,
}

export function useAnchoredMessages({
  conversation,
  conversationId,
}: {
  conversation?: Conversation | null
  conversationId: string
}) {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const [activeAnchorTargetId, setActiveAnchorTargetId] = useState<string | null>(null)
  const activeAnchorTargetIdRef = useRef<string | null>(null)
  const resolverTokenRef = useRef(0)
  const olderAbortControllerRef = useRef<AbortController | null>(null)
  const newerAbortControllerRef = useRef<AbortController | null>(null)
  const failedAnchorCursorGuardRef = useRef<Set<string>>(new Set())
  const activeAnchorSyncRangeRef = useRef<MessageSyncRangeSnapshot | null>(null)
  const canFetchRemote = isNetworkResolved && isOnline

  const anchorQueryKey = useMemo(
    () =>
      activeAnchorTargetId
        ? queryKeys.conversations.messagesAround(conversationId, activeAnchorTargetId)
        : (['conversations', conversationId, 'messagesAround', 'idle'] as const),
    [activeAnchorTargetId, conversationId],
  )

  const applyAnchorMetadataToCurrentState = useCallback(
    (anchorTargetId: string, range: MessageSyncRangeSnapshot | null) => {
      if (!range || range.anchorTargetId !== anchorTargetId) {
        return
      }

      queryClient.setQueryData<AnchoredMessagesState | undefined>(
        queryKeys.conversations.messagesAround(conversationId, anchorTargetId),
        (current) => {
          if (!current || current.targetMessageId !== anchorTargetId) {
            return current
          }

          const shouldRestoreOlder =
            range.remoteHasOlder && !range.remoteExhaustedOlder && Boolean(current.oldestCursor)
          const shouldRestoreNewer =
            range.remoteHasNewer && !range.remoteExhaustedNewer && Boolean(current.newestCursor)

          if (!shouldRestoreOlder && !shouldRestoreNewer) {
            return current
          }

          const nextHasOlder = shouldRestoreOlder ? true : current.hasOlder
          const nextHasNewer = shouldRestoreNewer ? true : current.hasNewer

          if (nextHasOlder === current.hasOlder && nextHasNewer === current.hasNewer) {
            return current
          }

          return {
            ...current,
            hasOlder: nextHasOlder,
            hasNewer: nextHasNewer,
          }
        },
      )
    },
    [conversationId, queryClient],
  )

  useEffect(() => {
    activeAnchorTargetIdRef.current = activeAnchorTargetId

    if (!activeAnchorTargetId) {
      activeAnchorSyncRangeRef.current = null
    }
  }, [activeAnchorTargetId])

  useEffect(() => {
    if (!activeAnchorTargetId) {
      activeAnchorSyncRangeRef.current = null
      return
    }

    let isCanceled = false
    const targetMessageId = activeAnchorTargetId

    void getUnifiedAnchorSyncRange({
      anchorTargetId: targetMessageId,
      conversationId,
    })
      .then((range) => {
        if (isCanceled || activeAnchorTargetIdRef.current !== targetMessageId) {
          return
        }

        activeAnchorSyncRangeRef.current = range
        applyAnchorMetadataToCurrentState(targetMessageId, range)
      })
      .catch(() => {
        if (isCanceled || activeAnchorTargetIdRef.current !== targetMessageId) {
          return
        }

        activeAnchorSyncRangeRef.current = null
      })

    return () => {
      isCanceled = true
    }
  }, [activeAnchorTargetId, applyAnchorMetadataToCurrentState, conversationId])

  useEffect(() => {
    failedAnchorCursorGuardRef.current.clear()
  }, [activeAnchorTargetId, conversationId])

  useEffect(() => {
    if (canFetchRemote) {
      failedAnchorCursorGuardRef.current.clear()
    }
  }, [canFetchRemote])

  const updateActiveAnchorSyncRangeFromWrite = useCallback(
    (anchorTargetId: string, metadataWrite: Promise<MessageSyncRangeSnapshot | null>) => {
      void metadataWrite.then((range) => {
        if (!range || activeAnchorTargetIdRef.current !== anchorTargetId) {
          return
        }

        activeAnchorSyncRangeRef.current = range
        applyAnchorMetadataToCurrentState(anchorTargetId, range)
      })
    },
    [applyAnchorMetadataToCurrentState],
  )

  const syncAnchorWindowFromRemote = useCallback(
    async ({
      queryKey,
      signal,
      targetMessageId,
    }: {
      queryKey: ReturnType<typeof queryKeys.conversations.messagesAround>
      signal?: AbortSignal
      targetMessageId: string
    }) => {
      const response = await conversationApi.getMessagesAround(conversationId, targetMessageId, {
        before: DEFAULT_ANCHOR_BEFORE,
        after: DEFAULT_ANCHOR_AFTER,
        ...(signal ? { signal } : {}),
      })

      await upsertRemoteMessages({
        conversation: conversation ?? null,
        currentUser: currentUser ?? null,
        messages: response.messages,
      })

      updateActiveAnchorSyncRangeFromWrite(
        targetMessageId,
        writeAnchorAroundSyncRangeMetadata({
          anchorTargetId: targetMessageId,
          conversationId,
          response,
        }),
      )

      const refreshedLocalWindow = await getLocalMessageWindowAroundId(
        conversationId,
        targetMessageId,
        {
          before: DEFAULT_ANCHOR_BEFORE,
          after: DEFAULT_ANCHOR_AFTER,
          currentUser: currentUser ?? null,
          conversation: conversation ?? null,
        },
      )

      const currentActiveTargetId = activeAnchorTargetIdRef.current
      if (currentActiveTargetId !== targetMessageId) {
        return
      }

      queryClient.setQueryData<AnchoredMessagesState | undefined>(queryKey, (current) => {
        if (!current || current.targetMessageId !== targetMessageId) {
          return current
        }

        return normalizeAnchorWindowState(
          mergeAnchorWindowMessagesWithRemoteMetadata(refreshedLocalWindow, response),
          refreshedLocalWindow ? 'local' : 'remote',
          current,
        )
      })
    },
    [conversation, conversationId, currentUser, queryClient, updateActiveAnchorSyncRangeFromWrite],
  )

  const anchorQuery = useQuery({
    queryKey: anchorQueryKey,
    enabled: Boolean(activeAnchorTargetId),
    queryFn: async ({ signal }) => {
      const targetMessageId = activeAnchorTargetId
      if (!targetMessageId) {
        throw new Error('Anchor target is not set')
      }

      const localWindow = await getLocalMessageWindowAroundId(conversationId, targetMessageId, {
        before: DEFAULT_ANCHOR_BEFORE,
        after: DEFAULT_ANCHOR_AFTER,
        currentUser: currentUser ?? null,
        conversation: conversation ?? null,
      })

      const existingAnchorState = queryClient.getQueryData<AnchoredMessagesState>(anchorQueryKey)

      if (localWindow) {
        if (canFetchRemote) {
          void syncAnchorWindowFromRemote({
            queryKey: anchorQueryKey,
            signal,
            targetMessageId,
          }).catch(() => undefined)
        }

        return normalizeAnchorWindowState(localWindow, 'local', existingAnchorState)
      }

      if (!canFetchRemote) {
        return (
          existingAnchorState ?? {
            targetMessageId,
            messages: [],
            hasOlder: false,
            hasNewer: false,
            isFetchingOlder: false,
            isFetchingNewer: false,
            source: 'local',
          }
        )
      }

      const response = await conversationApi.getMessagesAround(conversationId, targetMessageId, {
        before: DEFAULT_ANCHOR_BEFORE,
        after: DEFAULT_ANCHOR_AFTER,
        signal,
      })

      await upsertRemoteMessages({
        conversation: conversation ?? null,
        currentUser: currentUser ?? null,
        messages: response.messages,
      })

      updateActiveAnchorSyncRangeFromWrite(
        targetMessageId,
        writeAnchorAroundSyncRangeMetadata({
          anchorTargetId: targetMessageId,
          conversationId,
          response,
        }),
      )

      const refreshedLocalWindow = await getLocalMessageWindowAroundId(
        conversationId,
        targetMessageId,
        {
          before: DEFAULT_ANCHOR_BEFORE,
          after: DEFAULT_ANCHOR_AFTER,
          currentUser: currentUser ?? null,
          conversation: conversation ?? null,
        },
      )

      return normalizeAnchorWindowState(
        mergeAnchorWindowMessagesWithRemoteMetadata(refreshedLocalWindow, response),
        refreshedLocalWindow ? 'local' : 'remote',
        existingAnchorState,
      )
    },
    networkMode: 'always',
    staleTime: 0,
    gcTime: 15 * 60 * 1000,
  })

  const resolveAnchorTarget = useCallback(
    async (messageId?: string | null) => {
      if (!isPersistedServerMessageId(messageId)) {
        return false
      }

      const targetMessageId = messageId
      resolverTokenRef.current += 1
      const currentToken = resolverTokenRef.current
      olderAbortControllerRef.current?.abort()
      newerAbortControllerRef.current?.abort()
      await queryClient.cancelQueries({
        queryKey: queryKeys.conversations.messagesAroundRoot(conversationId),
      })

      const nextQueryKey = queryKeys.conversations.messagesAround(conversationId, targetMessageId)
      const localWindow = await getLocalMessageWindowAroundId(conversationId, targetMessageId, {
        before: DEFAULT_ANCHOR_BEFORE,
        after: DEFAULT_ANCHOR_AFTER,
        currentUser: currentUser ?? null,
        conversation: conversation ?? null,
      })

      if (resolverTokenRef.current !== currentToken) {
        return false
      }

      if (localWindow) {
        queryClient.setQueryData<AnchoredMessagesState>(
          nextQueryKey,
          normalizeAnchorWindowState(localWindow, 'local'),
        )
      } else {
        queryClient.removeQueries({ queryKey: nextQueryKey, exact: true })
      }

      setActiveAnchorTargetId(targetMessageId)
      return true
    },
    [conversation, conversationId, currentUser, queryClient],
  )

  const updateCurrentAnchorState = useCallback(
    (updater: (current: AnchoredMessagesState) => AnchoredMessagesState) => {
      if (!activeAnchorTargetId) {
        return
      }

      queryClient.setQueryData<AnchoredMessagesState | undefined>(
        queryKeys.conversations.messagesAround(conversationId, activeAnchorTargetId),
        (current) => {
          if (!current) {
            return current
          }

          return updater(current)
        },
      )
    },
    [activeAnchorTargetId, conversationId, queryClient],
  )

  const loadAnchorOlder = useCallback(
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

  const loadAnchorNewer = useCallback(
    async (_trigger: AnchorLoadTrigger = 'bottom') => {
      const anchorTargetId = activeAnchorTargetId
      if (!anchorTargetId) {
        return
      }

      const currentState = queryClient.getQueryData<AnchoredMessagesState>(
        queryKeys.conversations.messagesAround(conversationId, anchorTargetId),
      )

      if (!currentState?.hasNewer || !currentState.newestCursor || currentState.isFetchingNewer) {
        return
      }

      const cursor = currentState.newestCursor
      const guardKey = getAnchorCursorGuardKey({
        anchorTargetId,
        conversationId,
        cursor,
        direction: 'newer',
      })
      newerAbortControllerRef.current?.abort()
      const controller = new AbortController()
      newerAbortControllerRef.current = controller

      updateCurrentAnchorState((current) => ({ ...current, isFetchingNewer: true }))

      const localPage = await getLocalMessagesNewerThanCursor({
        conversation: conversation ?? null,
        conversationId,
        currentUser: currentUser ?? null,
        cursor,
        limit: DEFAULT_ANCHOR_EXPANSION_LIMIT,
      })

      if (localPage.messages.length > 0) {
        updateCurrentAnchorState((current) => {
          if (current.targetMessageId !== anchorTargetId || current.newestCursor !== cursor) {
            return current
          }

          const { newestCursor: _newestCursor, ...rest } = current
          const metadata = getMergedCursorMetadata({
            currentCursor: current.newestCursor,
            currentHasMore: current.hasNewer,
            localHasMore: localPage.hasMore,
            localNextCursor: localPage.nextCursor,
            remoteHasMore: undefined,
            remoteNextCursor: undefined,
            shouldUseRemote: false,
          })

          return {
            ...rest,
            messages: mergeMessageCollectionsNewestFirst(current.messages, localPage.messages),
            hasNewer: metadata.hasMore,
            ...(metadata.nextCursor ? { newestCursor: metadata.nextCursor } : {}),
            isFetchingNewer: false,
          }
        })

        if (!canFetchRemote || failedAnchorCursorGuardRef.current.has(guardKey)) {
          return
        }

        void conversationApi
          .getMessagesAnchorNewer(conversationId, {
            cursor,
            limit: DEFAULT_ANCHOR_EXPANSION_LIMIT,
            signal: controller.signal,
          })
          .then(async (response) => {
            await upsertRemoteMessages({
              conversation: conversation ?? null,
              currentUser: currentUser ?? null,
              messages: response.messages,
            })

            updateActiveAnchorSyncRangeFromWrite(
              anchorTargetId,
              writeAnchorNewerSyncRangeMetadata({
                anchorTargetId,
                conversationId,
                response,
              }),
            )

            failedAnchorCursorGuardRef.current.delete(guardKey)

            if (activeAnchorTargetIdRef.current !== anchorTargetId) {
              return
            }

            updateCurrentAnchorState((current) => {
              if (current.targetMessageId !== anchorTargetId) {
                return current
              }

              const { newestCursor: _newestCursor, ...rest } = current
              const shouldUpdateCursor = current.newestCursor === localPage.nextCursor
              const metadata = getMergedCursorMetadata({
                currentCursor: current.newestCursor,
                currentHasMore: current.hasNewer,
                localHasMore: localPage.hasMore,
                localNextCursor: localPage.nextCursor,
                remoteHasMore: response.hasMore,
                remoteNextCursor: response.nextCursor,
                shouldUseRemote: shouldUpdateCursor,
              })
              const mergedMessages = mergeMessageCollectionsNewestFirst(
                current.messages,
                response.messages,
              )

              return {
                ...rest,
                messages: mergedMessages,
                hasNewer: metadata.hasMore,
                ...(metadata.nextCursor ? { newestCursor: metadata.nextCursor } : {}),
                isFetchingNewer: false,
              }
            })
          })
          .catch((error) => {
            if ((error as Error).name === 'CanceledError' || controller.signal.aborted) {
              return
            }

            failedAnchorCursorGuardRef.current.add(guardKey)
          })

        return
      }

      const activeAnchorSyncRange = activeAnchorSyncRangeRef.current
      if (
        activeAnchorSyncRange?.anchorTargetId === anchorTargetId &&
        activeAnchorSyncRange.remoteExhaustedNewer
      ) {
        updateCurrentAnchorState((current) => {
          if (current.targetMessageId !== anchorTargetId || current.newestCursor !== cursor) {
            return current
          }

          return {
            ...current,
            hasNewer: false,
            isFetchingNewer: false,
          }
        })
        return
      }

      if (!canFetchRemote || failedAnchorCursorGuardRef.current.has(guardKey)) {
        updateCurrentAnchorState((current) => ({ ...current, isFetchingNewer: false }))
        return
      }

      try {
        const response = await conversationApi.getMessagesAnchorNewer(conversationId, {
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
          writeAnchorNewerSyncRangeMetadata({
            anchorTargetId,
            conversationId,
            response,
          }),
        )

        updateCurrentAnchorState((current) => {
          if (current.targetMessageId !== anchorTargetId) {
            return current
          }

          const { newestCursor: _newestCursor, ...rest } = current
          const mergedMessages = mergeMessageCollectionsNewestFirst(
            current.messages,
            response.messages,
          )

          failedAnchorCursorGuardRef.current.delete(guardKey)

          return {
            ...rest,
            messages: mergedMessages,
            hasNewer: response.hasMore,
            ...(response.nextCursor ? { newestCursor: response.nextCursor } : {}),
            isFetchingNewer: false,
          }
        })
      } catch (error) {
        if ((error as Error).name === 'CanceledError' || controller.signal.aborted) {
          return
        }

        failedAnchorCursorGuardRef.current.add(guardKey)
        updateCurrentAnchorState((current) => ({ ...current, isFetchingNewer: false }))
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

  const clearAnchor = useCallback(async () => {
    resolverTokenRef.current += 1
    olderAbortControllerRef.current?.abort()
    newerAbortControllerRef.current?.abort()
    await queryClient.cancelQueries({
      queryKey: queryKeys.conversations.messagesAroundRoot(conversationId),
    })
    setActiveAnchorTargetId(null)
  }, [conversationId, queryClient])

  return {
    activeAnchorTargetId,
    anchorData: anchorQuery.data,
    clearAnchor,
    isResolvingAnchor: anchorQuery.isFetching,
    loadAnchorNewer,
    loadAnchorOlder,
    resolveAnchorTarget,
  }
}
