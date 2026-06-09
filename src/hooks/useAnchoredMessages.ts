import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'

import { conversationApi, type AnchorWindowResponse } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import {
  getLocalMessageWindowAroundId,
  type LocalMessageWindowAroundId,
} from '../database/messageRepository'
import { upsertRemoteMessages } from '../database/messageSync'
import { mergeMessageCollectionsNewestFirst } from '../lib/messageListState'
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

const getMessageDateLabel = (message?: Message | null) => {
  return message?.createdAt ?? null
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
  const [activeAnchorTargetId, setActiveAnchorTargetId] = useState<string | null>(null)
  const resolverTokenRef = useRef(0)
  const olderAbortControllerRef = useRef<AbortController | null>(null)
  const newerAbortControllerRef = useRef<AbortController | null>(null)

  const anchorQueryKey = useMemo(
    () =>
      activeAnchorTargetId
        ? queryKeys.conversations.messagesAround(conversationId, activeAnchorTargetId)
        : (['conversations', conversationId, 'messagesAround', 'idle'] as const),
    [activeAnchorTargetId, conversationId],
  )

  const anchorQuery = useQuery({
    queryKey: anchorQueryKey,
    enabled: Boolean(activeAnchorTargetId),
    queryFn: async ({ signal }) => {
      const targetMessageId = activeAnchorTargetId
      if (!targetMessageId) {
        throw new Error('Anchor target is not set')
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

      return normalizeAnchorWindowState(
        response,
        'remote',
        queryClient.getQueryData<AnchoredMessagesState>(anchorQueryKey),
      )
    },
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

      const cursorMessage =
        currentState.messages.find((message) => message.id === currentState.oldestCursor) ?? null

      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[AnchorPagination] loadAnchorOlder:start', {
          anchorTargetId,
          conversationId,
          cursor: currentState.oldestCursor,
          cursorDate: getMessageDateLabel(cursorMessage),
          trigger,
        })
      }

      olderAbortControllerRef.current?.abort()
      const controller = new AbortController()
      olderAbortControllerRef.current = controller

      updateCurrentAnchorState((current) => ({ ...current, isFetchingOlder: true }))

      try {
        const response = await conversationApi.getMessagesAnchorOlder(conversationId, {
          cursor: currentState.oldestCursor,
          limit: DEFAULT_ANCHOR_EXPANSION_LIMIT,
          signal: controller.signal,
        })

        await upsertRemoteMessages({
          conversation: conversation ?? null,
          currentUser: currentUser ?? null,
          messages: response.messages,
        })

        updateCurrentAnchorState((current) => {
          const { oldestCursor: _oldestCursor, ...rest } = current
          const mergedMessages = mergeMessageCollectionsNewestFirst(
            current.messages,
            response.messages,
          )

          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log('[AnchorPagination] loadAnchorOlder:success', {
              anchorTargetId,
              conversationId,
              cursor: currentState.oldestCursor,
              trigger,
              responseFirstDate: getMessageDateLabel(response.messages[0] ?? null),
              responseLastDate: getMessageDateLabel(
                response.messages[response.messages.length - 1] ?? null,
              ),
              mergedFirstDate: getMessageDateLabel(mergedMessages[0] ?? null),
              mergedLastDate: getMessageDateLabel(
                mergedMessages[mergedMessages.length - 1] ?? null,
              ),
            })
          }

          return {
            ...rest,
            messages: mergedMessages,
            hasOlder: response.hasMore,
            ...(response.nextCursor ? { oldestCursor: response.nextCursor } : {}),
            isFetchingOlder: false,
          }
        })
      } catch (error) {
        if ((error as Error).name === 'CanceledError' || controller.signal.aborted) {
          return
        }

        updateCurrentAnchorState((current) => ({ ...current, isFetchingOlder: false }))
      }
    },
    [
      activeAnchorTargetId,
      conversation,
      conversationId,
      currentUser,
      queryClient,
      updateCurrentAnchorState,
    ],
  )

  const loadAnchorNewer = useCallback(
    async (trigger: AnchorLoadTrigger = 'bottom') => {
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

      const cursorMessage =
        currentState.messages.find((message) => message.id === currentState.newestCursor) ?? null

      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[AnchorPagination] loadAnchorNewer:start', {
          anchorTargetId,
          conversationId,
          cursor: currentState.newestCursor,
          cursorDate: getMessageDateLabel(cursorMessage),
          trigger,
        })
      }

      newerAbortControllerRef.current?.abort()
      const controller = new AbortController()
      newerAbortControllerRef.current = controller

      updateCurrentAnchorState((current) => ({ ...current, isFetchingNewer: true }))

      try {
        const response = await conversationApi.getMessagesAnchorNewer(conversationId, {
          cursor: currentState.newestCursor,
          limit: DEFAULT_ANCHOR_EXPANSION_LIMIT,
          signal: controller.signal,
        })

        await upsertRemoteMessages({
          conversation: conversation ?? null,
          currentUser: currentUser ?? null,
          messages: response.messages,
        })

        updateCurrentAnchorState((current) => {
          const { newestCursor: _newestCursor, ...rest } = current
          const mergedMessages = mergeMessageCollectionsNewestFirst(
            current.messages,
            response.messages,
          )

          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log('[AnchorPagination] loadAnchorNewer:success', {
              anchorTargetId,
              conversationId,
              cursor: currentState.newestCursor,
              trigger,
              responseFirstDate: getMessageDateLabel(response.messages[0] ?? null),
              responseLastDate: getMessageDateLabel(
                response.messages[response.messages.length - 1] ?? null,
              ),
              mergedFirstDate: getMessageDateLabel(mergedMessages[0] ?? null),
              mergedLastDate: getMessageDateLabel(
                mergedMessages[mergedMessages.length - 1] ?? null,
              ),
            })
          }

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

        updateCurrentAnchorState((current) => ({ ...current, isFetchingNewer: false }))
      }
    },
    [
      activeAnchorTargetId,
      conversation,
      conversationId,
      currentUser,
      queryClient,
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
