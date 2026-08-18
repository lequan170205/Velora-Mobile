import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { getLocalMessagesPage } from '../database/messageRepository'
import {
  createPendingTextMessage,
  upsertRemoteMessage,
  upsertRemoteMessages,
} from '../database/messageSync'
import {
  buildRangeBoundaryFromMessages,
  getLatestMessageSyncRange,
  markRangeRemoteExhausted,
  upsertMessageSyncRange,
  type MessageSyncRangeBoundary,
  type MessageSyncRangeSnapshot,
} from '../database/messageSyncRangeRepository'
import {
  upsertConversationSummaryInCache,
  upsertMessageIntoConversationCache,
} from '../lib/chatMessageCache'
import { createClientMessageId } from '../lib/clientMessageId'
import { getMessageIdentityKey, mergeMessageCollectionByIdentity } from '../lib/messageIdentity'
import { buildReplyPreviewFromMessage, mergeReplyPreview } from '../lib/replyPreview'
import { useNetworkStatus } from '../providers/NetworkProvider'
import { useSocket } from '../providers/SocketProvider'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

import type { Conversation, Message } from '../types/conversation.types'

const ensureClientMessageId = (variables: { clientMessageId?: string }) => {
  if (!variables.clientMessageId) {
    variables.clientMessageId = createClientMessageId()
  }

  return variables.clientMessageId
}

const isPersistedMessage = (value: unknown): value is Message => {
  if (!value || typeof value !== 'object') {
    return false
  }

  return (
    typeof (value as Message).id === 'string' &&
    typeof (value as Message).conversationId === 'string' &&
    typeof (value as Message).createdAt === 'string' &&
    typeof (value as Message).updatedAt === 'string'
  )
}

interface SendMessageVariables {
  content: string
  media?: Message['media']
  type?: Message['type']
  replyToId?: string
  replyToMessage?: Message | null
  clientMessageId?: string
}

export const MESSAGE_QUERY_STALE_TIME_MS = 2 * 60 * 1000
export const MESSAGE_QUERY_GC_TIME_MS = 15 * 60 * 1000
export const MESSAGE_CACHE_WARMUP_LIMIT = 0
export const MESSAGE_PAGE_LIMIT = 15
export const MESSAGE_CACHE_RETAINED_PAGES = 8
export const MESSAGE_PREFETCH_ENABLED = true

const latestMessagesSyncedAtByConversation = new Map<string, number>()

const markLatestMessagesSynced = (conversationId: string) => {
  latestMessagesSyncedAtByConversation.set(conversationId, Date.now())
}

const shouldSyncLatestMessages = (conversationId: string) => {
  const lastSyncedAt = latestMessagesSyncedAtByConversation.get(conversationId) ?? 0
  return Date.now() - lastSyncedAt >= MESSAGE_QUERY_STALE_TIME_MS
}

const getMessageCreatedAtMs = (message: Message) => {
  const timestamp = new Date(message.createdAt).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

const sortMessagesNewestFirst = (messages: Message[]) => {
  return [...messages].sort((left, right) => {
    const delta = getMessageCreatedAtMs(right.createdAt) - getMessageCreatedAtMs(left.createdAt)

    if (delta !== 0) {
      return delta
    }

    return (right.id || right._id || '').localeCompare(left.id || left._id || '')
  })
}

const dedupeMessages = (messages: Message[]) => {
  return mergeMessageCollectionByIdentity(
    messages.filter((message) =>
      Boolean(getMessageIdentityKey(message) ?? message.id ?? message._id),
    ),
  )
}

const getOldestMessage = (messages: Message[]) => {
  if (!messages.length) return null

  return messages.reduce((oldest, current) => {
    const currentCreatedAtMs = getMessageCreatedAtMs(current)
    const oldestCreatedAtMs = getMessageCreatedAtMs(oldest)

    if (currentCreatedAtMs < oldestCreatedAtMs) {
      return current
    }

    if (currentCreatedAtMs > oldestCreatedAtMs) {
      return oldest
    }

    const currentId = current.id || current._id || ''
    const oldestId = oldest.id || oldest._id || ''

    return currentId.localeCompare(oldestId) < 0 ? current : oldest
  }, messages[0])
}

const isBoundaryOlderThan = (
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

const isMessageAtOrOlderThanExhaustedBoundary = (
  message: Message,
  latestSyncRange?: MessageSyncRangeSnapshot | null,
) => {
  if (!latestSyncRange?.remoteExhaustedOlder) {
    return false
  }

  const messageId = message.id || message._id || ''

  if (latestSyncRange.endCreatedAt === null || !latestSyncRange.endMessageId) {
    return latestSyncRange.lastCursor ? messageId === latestSyncRange.lastCursor : true
  }

  const messageCreatedAt = getMessageCreatedAtMs(message)

  if (messageCreatedAt !== latestSyncRange.endCreatedAt) {
    return messageCreatedAt < latestSyncRange.endCreatedAt
  }

  return messageId.localeCompare(latestSyncRange.endMessageId) <= 0
}

const isCursorAtExhaustedOlderBoundary = (
  cursor: string | undefined,
  latestSyncRange?: MessageSyncRangeSnapshot | null,
) => {
  if (!cursor || !latestSyncRange?.remoteExhaustedOlder) {
    return false
  }

  if (latestSyncRange.endMessageId) {
    return cursor === latestSyncRange.endMessageId
  }

  if (latestSyncRange.lastCursor) {
    return cursor === latestSyncRange.lastCursor
  }

  return true
}

const writeLatestRemoteSyncRangeMetadata = async ({
  conversationId,
  cursor,
  remotePage,
}: {
  conversationId: string
  cursor?: string
  remotePage: Message[]
}): Promise<MessageSyncRangeSnapshot | null> => {
  const syncedAt = Date.now()

  try {
    if (remotePage.length === 0) {
      if (!cursor) {
        return null
      }

      const exhaustedRange = await markRangeRemoteExhausted({
        conversationId,
        direction: 'older',
        exhaustedAt: syncedAt,
        rangeType: 'latest',
        source: 'remote_latest',
      })

      if (!exhaustedRange) {
        return await upsertMessageSyncRange({
          conversationId,
          isComplete: false,
          isContiguous: false,
          lastCursor: cursor,
          lastSyncedAt: syncedAt,
          rangeType: 'latest',
          remoteExhaustedOlder: true,
          source: 'remote_latest',
        })
      }

      return exhaustedRange
    }

    const pageBoundary = buildRangeBoundaryFromMessages(remotePage)
    const existingRange = await getLatestMessageSyncRange(conversationId)
    const nextBoundary: MessageSyncRangeBoundary = {
      startMessageId: existingRange?.startMessageId ?? pageBoundary.startMessageId,
      startCreatedAt: existingRange?.startCreatedAt ?? pageBoundary.startCreatedAt,
      endMessageId: pageBoundary.endMessageId,
      endCreatedAt: pageBoundary.endCreatedAt,
    }

    if (
      cursor &&
      existingRange &&
      !isBoundaryOlderThan(pageBoundary, {
        endCreatedAt: existingRange.endCreatedAt,
        endMessageId: existingRange.endMessageId,
      })
    ) {
      nextBoundary.endMessageId = existingRange.endMessageId
      nextBoundary.endCreatedAt = existingRange.endCreatedAt
    }

    return await upsertMessageSyncRange({
      boundary: nextBoundary,
      conversationId,
      isComplete: false,
      isContiguous: true,
      lastCursor: pageBoundary.endMessageId,
      lastSyncedAt: syncedAt,
      rangeType: 'latest',
      ...(cursor ? { remoteExhaustedOlder: false } : {}),
      source: 'remote_latest',
    })
  } catch (error) {
    console.warn('[Messages] Failed to persist latest sync range metadata', error)
    return null
  }
}

const getCachedConversation = (
  queryClient: QueryClient,
  conversationId: string,
): Conversation | null => {
  const cachedData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)

  const conversations: Conversation[] = Array.isArray(cachedData)
    ? cachedData
    : (cachedData as { pages?: Conversation[][] })?.pages?.flat() || []

  return conversations.find((conversation) => conversation.id === conversationId) ?? null
}

type MessagesQueryOptionsInput = {
  conversation?: Conversation | null
  conversationId: string
  currentUser?: ReturnType<typeof useAuthStore.getState>['user'] | null
  isOnline?: boolean
  isNetworkResolved?: boolean
  latestSyncRange?: MessageSyncRangeSnapshot | null | undefined
  onLatestSyncCompleted?: (() => void) | undefined
  onLatestSyncRangeUpdated?: ((range: MessageSyncRangeSnapshot) => void) | undefined
  queryClient?: QueryClient
}

type PrefetchMessagesOptions = {
  isNetworkResolved?: boolean
  isOnline?: boolean
}

export const getMessagesInfiniteQueryOptions = ({
  conversation,
  conversationId,
  currentUser,
  isOnline = true,
  isNetworkResolved = true,
  latestSyncRange,
  onLatestSyncCompleted,
  onLatestSyncRangeUpdated,
  queryClient,
}: MessagesQueryOptionsInput) => ({
  queryKey: queryKeys.conversations.messages(conversationId),

  queryFn: async ({ pageParam = undefined }: { pageParam?: unknown }) => {
    const cursor = pageParam ? String(pageParam) : undefined

    const localPage = await getLocalMessagesPage({
      conversation: conversation ?? null,
      conversationId,
      currentUser: currentUser ?? null,
      ...(cursor ? { cursor } : {}),
      limit: MESSAGE_PAGE_LIMIT,
    })

    if (localPage.length > 0) {
      if (cursor && queryClient && isNetworkResolved && isOnline) {
        void syncMessagesPageToLocalStore({
          conversation: conversation ?? null,
          conversationId,
          currentUser: currentUser ?? null,
          cursor,
          onLatestSyncRangeUpdated,
        })
          .then((remotePage) => {
            if (remotePage.length === 0) {
              return
            }

            return refreshMessagesPageFromLocalStore({
              conversation: conversation ?? null,
              conversationId,
              currentUser: currentUser ?? null,
              cursor,
              queryClient,
            })
          })
          .catch((error) => {
            console.warn('[Messages] Failed to sync older messages page', error)
          })
      }

      return sortMessagesNewestFirst(localPage)
    }

    if (isCursorAtExhaustedOlderBoundary(cursor, latestSyncRange)) {
      return []
    }

    if (!isNetworkResolved) {
      throw new Error('Cannot fetch remote messages before network state resolves')
    }

    if (!isOnline) {
      throw new Error('Cannot fetch remote messages while offline')
    }

    try {
      const remotePage = await syncMessagesPageToLocalStore({
        conversation: conversation ?? null,
        conversationId,
        currentUser: currentUser ?? null,
        ...(cursor ? { cursor } : {}),
        onLatestSyncCompleted,
        onLatestSyncRangeUpdated,
      })

      if (remotePage.length === 0) {
        return []
      }

      const refreshedLocalPage = await getLocalMessagesPage({
        conversation: conversation ?? null,
        conversationId,
        currentUser: currentUser ?? null,
        ...(cursor ? { cursor } : {}),
        limit: MESSAGE_PAGE_LIMIT,
      })

      if (refreshedLocalPage.length === 0) {
        return sortMessagesNewestFirst(remotePage)
      }

      return sortMessagesNewestFirst(dedupeMessages(refreshedLocalPage))
    } catch (error) {
      if (localPage.length > 0) {
        return sortMessagesNewestFirst(localPage)
      }

      throw error
    }
  },

  getNextPageParam: (lastPage: Message[]) => {
    if (!lastPage || lastPage.length === 0) return undefined

    const oldestMessage = getOldestMessage(lastPage)
    if (!oldestMessage) return undefined

    if (isMessageAtOrOlderThanExhaustedBoundary(oldestMessage, latestSyncRange)) {
      return undefined
    }

    return oldestMessage?.id
  },

  initialPageParam: undefined as string | undefined,
  networkMode: 'always' as const,
  staleTime: MESSAGE_QUERY_STALE_TIME_MS,
  gcTime: MESSAGE_QUERY_GC_TIME_MS,
})

export const prefetchMessages = async (
  queryClient: QueryClient,
  conversationId: string,
  options: PrefetchMessagesOptions = {},
) => {
  if (!MESSAGE_PREFETCH_ENABLED) {
    return
  }

  const existing = queryClient.getQueryData<InfiniteData<Message[]>>(
    queryKeys.conversations.messages(conversationId),
  )

  if (existing?.pages?.length) {
    return
  }

  await queryClient.prefetchInfiniteQuery(
    getMessagesInfiniteQueryOptions({
      conversation: getCachedConversation(queryClient, conversationId),
      conversationId,
      currentUser: useAuthStore.getState().user ?? null,
      isNetworkResolved: options.isNetworkResolved ?? false,
      isOnline: options.isOnline ?? false,
      queryClient,
    }),
  )
}

export const prefetchMessagesForConversations = async (
  queryClient: QueryClient,
  conversationIds: string[],
  options: PrefetchMessagesOptions = {},
) => {
  const uniqueConversationIds = Array.from(new Set(conversationIds.filter(Boolean)))

  await Promise.allSettled(
    uniqueConversationIds.map((conversationId) =>
      prefetchMessages(queryClient, conversationId, options),
    ),
  )
}

export const trimMessagesCache = (queryClient: QueryClient, conversationId: string) => {
  queryClient.setQueryData<InfiniteData<Message[]> | undefined>(
    queryKeys.conversations.messages(conversationId),
    (oldData) => {
      if (!oldData?.pages?.length) {
        return oldData
      }

      if (oldData.pages.length <= MESSAGE_CACHE_RETAINED_PAGES) {
        return oldData
      }

      return {
        ...oldData,
        pages: oldData.pages.slice(0, MESSAGE_CACHE_RETAINED_PAGES),
        pageParams: oldData.pageParams.slice(0, MESSAGE_CACHE_RETAINED_PAGES),
      }
    },
  )
}

async function syncMessagesPageToLocalStore({
  conversation,
  conversationId,
  currentUser,
  cursor,
  onLatestSyncCompleted,
  onLatestSyncRangeUpdated,
}: MessagesQueryOptionsInput & {
  cursor?: string
}) {
  const remotePage = await conversationApi.getMessages(conversationId, {
    limit: MESSAGE_PAGE_LIMIT,
    ...(cursor ? { cursor } : {}),
  })

  if (!cursor) {
    markLatestMessagesSynced(conversationId)
  }

  if (remotePage.length === 0) {
    void writeLatestRemoteSyncRangeMetadata({
      conversationId,
      ...(cursor ? { cursor } : {}),
      remotePage,
    }).then((range) => {
      if (range) {
        onLatestSyncRangeUpdated?.(range)
      }
    })
    if (!cursor) {
      onLatestSyncCompleted?.()
    }
    return remotePage
  }

  await upsertRemoteMessages({
    conversation: conversation ?? null,
    currentUser: currentUser ?? null,
    messages: remotePage,
  })

  void writeLatestRemoteSyncRangeMetadata({
    conversationId,
    ...(cursor ? { cursor } : {}),
    remotePage,
  }).then((range) => {
    if (range) {
      onLatestSyncRangeUpdated?.(range)
    }
  })

  if (!cursor) {
    onLatestSyncCompleted?.()
  }

  return remotePage
}

export const syncLatestMessagesToLocalStore = async (input: MessagesQueryOptionsInput) => {
  return syncMessagesPageToLocalStore(input)
}

async function refreshMessagesPageFromLocalStore({
  conversation,
  conversationId,
  currentUser,
  cursor,
  queryClient,
}: MessagesQueryOptionsInput & {
  cursor?: string
  queryClient: QueryClient
}) {
  const localPage = sortMessagesNewestFirst(
    await getLocalMessagesPage({
      conversation: conversation ?? null,
      conversationId,
      currentUser: currentUser ?? null,
      ...(cursor ? { cursor } : {}),
      limit: MESSAGE_PAGE_LIMIT,
    }),
  )

  queryClient.setQueryData<InfiniteData<Message[]> | undefined>(
    queryKeys.conversations.messages(conversationId),
    (oldData) => {
      if (!oldData?.pages?.length) {
        return localPage.length > 0
          ? {
              pages: [localPage],
              pageParams: [undefined],
            }
          : oldData
      }

      const pageIndex = cursor
        ? oldData.pageParams.findIndex((pageParam) => String(pageParam) === cursor)
        : 0

      if (pageIndex < 0) {
        return oldData
      }

      const pages = [...oldData.pages]
      pages[pageIndex] = localPage

      return {
        ...oldData,
        pages,
      }
    },
  )

  return localPage
}

export const refreshLatestMessagesPageFromLocalStore = async (
  input: MessagesQueryOptionsInput & {
    queryClient: QueryClient
  },
) => {
  return refreshMessagesPageFromLocalStore(input)
}

export function useMessages(conversationId: string) {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const [latestSyncRange, setLatestSyncRange] = useState<MessageSyncRangeSnapshot | null>(null)
  const needsLatestSyncOnEntryRef = useRef(true)
  const wasOnlineRef = useRef(isOnline)

  const handleLatestSyncRangeUpdated = useCallback(
    (range: MessageSyncRangeSnapshot) => {
      if (range.conversationId !== conversationId || range.rangeType !== 'latest') {
        return
      }

      setLatestSyncRange(range)
    },
    [conversationId],
  )
  const handleLatestSyncCompleted = useCallback(() => {
    needsLatestSyncOnEntryRef.current = false
  }, [])

  const conversation = useMemo(
    () => getCachedConversation(queryClient, conversationId),
    [queryClient, conversationId],
  )

  const query = useInfiniteQuery(
    getMessagesInfiniteQueryOptions({
      conversation,
      conversationId,
      currentUser,
      isNetworkResolved,
      isOnline,
      latestSyncRange,
      onLatestSyncCompleted: handleLatestSyncCompleted,
      onLatestSyncRangeUpdated: handleLatestSyncRangeUpdated,
      queryClient,
    }),
  )

  const hasLoadedMessagePages = Boolean(query.data?.pages.length)

  useEffect(() => {
    needsLatestSyncOnEntryRef.current = true
  }, [conversationId])

  useEffect(() => {
    let cancelled = false
    setLatestSyncRange(null)

    void getLatestMessageSyncRange(conversationId)
      .then((range) => {
        if (!cancelled) {
          setLatestSyncRange(range)
        }
      })
      .catch((error) => {
        console.warn('[Messages] Failed to load latest sync range metadata', error)
        if (!cancelled) {
          setLatestSyncRange(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [conversationId])

  useEffect(() => {
    if (!wasOnlineRef.current && isOnline) {
      needsLatestSyncOnEntryRef.current = true
    }

    wasOnlineRef.current = isOnline
  }, [isOnline])

  useEffect(() => {
    const shouldForceLatestSync = needsLatestSyncOnEntryRef.current

    if (
      !isOnline ||
      !isNetworkResolved ||
      !hasLoadedMessagePages ||
      query.isFetching ||
      (!shouldForceLatestSync && !shouldSyncLatestMessages(conversationId))
    ) {
      return
    }

    let cancelled = false

    const syncLatestMessages = async () => {
      try {
        await syncLatestMessagesToLocalStore({
          conversation,
          conversationId,
          currentUser,
          onLatestSyncCompleted: handleLatestSyncCompleted,
          onLatestSyncRangeUpdated: handleLatestSyncRangeUpdated,
        })

        if (cancelled) {
          return
        }

        await refreshLatestMessagesPageFromLocalStore({
          conversation,
          conversationId,
          currentUser,
          queryClient,
        })

        needsLatestSyncOnEntryRef.current = false
      } catch (error) {
        console.warn('[Messages] Failed to sync latest messages', error)
      }
    }

    void syncLatestMessages()

    return () => {
      cancelled = true
    }
  }, [
    conversation,
    conversationId,
    currentUser,
    handleLatestSyncCompleted,
    handleLatestSyncRangeUpdated,
    hasLoadedMessagePages,
    isNetworkResolved,
    isOnline,
    query.isFetching,
    queryClient,
  ])

  return query
}

export function useSendMessage(conversationId: string) {
  const { socket } = useSocket()
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const { addOptimisticMessage, enqueueOfflineMessage, markMessageFailed, replyToMessage } =
    useChatStore()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const currentConversation = useMemo(
    () => getCachedConversation(queryClient, conversationId),
    [queryClient, conversationId],
  )

  return useMutation({
    mutationFn: async (variables: SendMessageVariables) => {
      const { content, media, replyToId, replyToMessage: replyTargetFromVariables } = variables
      const resolvedClientMessageId = ensureClientMessageId(variables)
      const type = variables.type ?? 'text'
      const resolvedReplyToId = replyToId ?? replyTargetFromVariables?.id

      if (type !== 'text' || media) {
        return conversationApi.sendMessage(conversationId, {
          clientMessageId: resolvedClientMessageId,
          content,
          media,
          type,
          signalType: 0,
          ...(resolvedReplyToId ? { replyToId: resolvedReplyToId } : {}),
        })
      }

      if (!socket) {
        console.warn('[Socket] send_message queued: socket is not initialized')
        return { pending: true }
      }

      if (!socket.connected) {
        const canAttemptReconnect = isNetworkResolved && isOnline

        console.warn('[Socket] send_message queued: socket is disconnected', {
          socketId: socket.id,
          conversationId,
          canAttemptReconnect,
        })

        if (canAttemptReconnect && !socket.active) {
          socket.connect()
        }

        return { pending: true }
      }

      const payload: {
        conversationId: string
        content: string
        type: string
        signalType: number
        clientMessageId: string
        replyToId?: string
      } = {
        conversationId,
        content,
        type,
        signalType: 0,
        clientMessageId: resolvedClientMessageId,
      }

      if (resolvedReplyToId) payload.replyToId = resolvedReplyToId

      socket.emit('send_message', payload)

      return payload
    },
    onMutate: async (variables: SendMessageVariables) => {
      if (!user) return

      const { content, media, replyToId } = variables
      const now = new Date().toISOString()
      const tempId = ensureClientMessageId(variables)
      const type = variables.type ?? 'text'
      const resolvedReplyToMessage = variables.replyToMessage ?? replyToMessage
      const resolvedReplyToId = replyToId ?? resolvedReplyToMessage?.id

      let replyPreview: Message['replyPreview'] | undefined = undefined
      if (resolvedReplyToId && resolvedReplyToMessage) {
        replyPreview = buildReplyPreviewFromMessage({
          conversation: currentConversation ?? null,
          currentUserId: user.id,
          message: resolvedReplyToMessage,
        })
      }

      const tempMessage: Message = {
        id: tempId,
        conversationId,
        senderId: user.id,
        clientMessageId: tempId,
        sender: user,
        content,
        ...(media ? { media } : {}),
        type,
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
        ...(resolvedReplyToId ? { replyToId: resolvedReplyToId } : {}),
        ...(resolvedReplyToMessage ? { replyTo: resolvedReplyToMessage } : {}),
        ...(replyPreview && { replyPreview }),
      }

      addOptimisticMessage(conversationId, tempMessage)

      if (type === 'text' && !media) {
        void createPendingTextMessage({
          clientMessageId: tempId,
          content,
          conversation: currentConversation ?? null,
          conversationId,
          currentUser: user,
          replyPreview: replyPreview ?? null,
          replyToId: resolvedReplyToId ?? null,
        }).catch((error) => {
          console.warn('[Messages] Failed to persist pending text message locally', error)
        })

        enqueueOfflineMessage({
          id: tempId,
          conversationId,
          content,
          ...(resolvedReplyToId ? { replyToId: resolvedReplyToId } : {}),
        })
      }

      queryClient.setQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
        (oldData) => {
          if (!oldData) return oldData
          const sortConvs = (convs: Conversation[]) =>
            convs.sort(
              (a, b) =>
                new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime(),
            )
          if (Array.isArray(oldData)) {
            const target = oldData.find((c) => c.id === conversationId)
            const others = oldData.filter((c) => c.id !== conversationId)
            if (target) {
              const updated = { ...target, lastMessage: content, lastMessageAt: now }
              return sortConvs([updated, ...others])
            }
          }
          return oldData
        },
      )

      return { tempId, replyPreview }
    },
    onError: (_error, _variables, context) => {
      const { tempId } = context || {}
      if (tempId) {
        markMessageFailed(conversationId, tempId)
      }
    },
    onSuccess: (result, variables, context) => {
      if (!result || 'pending' in result || !isPersistedMessage(result)) {
        return
      }

      const tempId = context?.tempId
      const replyPreview = mergeReplyPreview(result.replyPreview, context?.replyPreview)
      let confirmedMessage: Message = {
        ...result,
        ...(replyPreview ? { replyPreview } : {}),
      }

      if (tempId) {
        const store = useChatStore.getState()
        const pendingMsgs = store.optimisticMessages[confirmedMessage.conversationId] || []
        const optimisticMatch = pendingMsgs.find((m) => m.id === tempId)

        if (
          optimisticMatch &&
          Array.isArray(optimisticMatch.readBy) &&
          optimisticMatch.readBy.length > 0
        ) {
          const existingReadBy = Array.isArray(confirmedMessage.readBy)
            ? [...confirmedMessage.readBy]
            : []

          optimisticMatch.readBy.forEach((optRead) => {
            if (!existingReadBy.some((r) => r.userId === optRead.userId)) {
              existingReadBy.push(optRead)
            }
          })

          confirmedMessage = {
            ...confirmedMessage,
            readBy: existingReadBy,
            status: existingReadBy.length > 0 ? 'READ' : confirmedMessage.status,
          }
        }

        store.confirmMessage(tempId, confirmedMessage)
        upsertMessageIntoConversationCache(queryClient, confirmedMessage)
        upsertConversationSummaryInCache(queryClient, {
          id: confirmedMessage.conversationId,
          lastMessage: confirmedMessage.content,
          lastMessageAt: confirmedMessage.createdAt,
          updatedAt: confirmedMessage.updatedAt,
        })
      }

      void upsertRemoteMessage({
        conversation: currentConversation ?? null,
        currentUser: user ?? null,
        message: confirmedMessage,
      }).catch((error) => {
        console.warn('[Messages] Failed to persist confirmed message locally', error)
      })

      if (
        (variables.type ?? 'text') === 'text' &&
        !variables.media &&
        confirmedMessage.clientMessageId
      ) {
        useChatStore.getState().dequeueOfflineMessage(confirmedMessage.clientMessageId)
      }
    },
  })
}
