import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { getLocalMessagesPage } from '../database/messageRepository'
import {
  createPendingTextMessage,
  upsertRemoteMessage,
  upsertRemoteMessages,
} from '../database/messageSync'
import { getResolvedMediaPosterUri, getResolvedMediaUri } from '../lib/chatMedia'
import {
  upsertConversationSummaryInCache,
  upsertMessageIntoConversationCache,
} from '../lib/chatMessageCache'
import { createClientMessageId } from '../lib/clientMessageId'
import { getMessageIdentityKey, mergeMessageCollectionByIdentity } from '../lib/messageIdentity'
import { getReplyPreviewSenderName } from '../lib/replyPreview'
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

const getReplyPreviewThumbnailUri = (message?: Message | null) => {
  if (!message || (message.type !== 'image' && message.type !== 'video')) {
    return undefined
  }

  if (message.type === 'video') {
    return getResolvedMediaPosterUri(message.media) ?? undefined
  }

  return getResolvedMediaUri(message.media) ?? undefined
}

const getReplyPreviewMediaSize = (message?: Message | null) => {
  const mediaWidth = message?.media?.width ?? message?.media?.displayWidth ?? undefined
  const mediaHeight = message?.media?.height ?? message?.media?.displayHeight ?? undefined

  return {
    ...(mediaWidth ? { mediaWidth } : {}),
    ...(mediaHeight ? { mediaHeight } : {}),
  }
}

const mergeReplyPreview = (
  remoteReplyPreview?: Message['replyPreview'],
  localReplyPreview?: Message['replyPreview'],
): Message['replyPreview'] | undefined => {
  if (!remoteReplyPreview) {
    return localReplyPreview
  }

  if (!localReplyPreview) {
    return remoteReplyPreview
  }

  if (typeof remoteReplyPreview === 'string' || typeof localReplyPreview === 'string') {
    return remoteReplyPreview
  }

  if (remoteReplyPreview.thumbnailUri || !localReplyPreview.thumbnailUri) {
    return {
      ...remoteReplyPreview,
      ...(remoteReplyPreview.senderId ? {} : { senderId: localReplyPreview.senderId }),
      ...(remoteReplyPreview.mediaWidth ? {} : { mediaWidth: localReplyPreview.mediaWidth }),
      ...(remoteReplyPreview.mediaHeight ? {} : { mediaHeight: localReplyPreview.mediaHeight }),
    }
  }

  return {
    ...remoteReplyPreview,
    thumbnailUri: localReplyPreview.thumbnailUri,
    ...(remoteReplyPreview.senderId ? {} : { senderId: localReplyPreview.senderId }),
    ...(remoteReplyPreview.mediaWidth ? {} : { mediaWidth: localReplyPreview.mediaWidth }),
    ...(remoteReplyPreview.mediaHeight ? {} : { mediaHeight: localReplyPreview.mediaHeight }),
  }
}

const sortMessagesNewestFirst = (messages: Message[]) => {
  return [...messages].sort((left, right) => {
    const delta = getMessageCreatedAtMs(right) - getMessageCreatedAtMs(left)

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
}

export const getMessagesInfiniteQueryOptions = ({
  conversation,
  conversationId,
  currentUser,
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

    if (!cursor && localPage.length >= MESSAGE_PAGE_LIMIT) {
      return sortMessagesNewestFirst(localPage)
    }

    try {
      const remotePage = await conversationApi.getMessages(conversationId, {
        limit: MESSAGE_PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      })

      if (!cursor) {
        markLatestMessagesSynced(conversationId)
      }

      if (remotePage.length > 0) {
        void upsertRemoteMessages({
          conversation: conversation ?? null,
          currentUser: currentUser ?? null,
          messages: remotePage,
        }).catch((error) => {
          console.warn('[Messages] Failed to persist remote page locally', error)
        })
      }

      if (cursor) {
        return sortMessagesNewestFirst(remotePage)
      }

      return sortMessagesNewestFirst(dedupeMessages([...localPage, ...remotePage])).slice(
        0,
        MESSAGE_PAGE_LIMIT,
      )
    } catch (error) {
      if (localPage.length > 0) {
        return sortMessagesNewestFirst(localPage)
      }

      throw error
    }
  },

  getNextPageParam: (lastPage: Message[]) => {
    if (!lastPage || lastPage.length < MESSAGE_PAGE_LIMIT) return undefined

    const oldestMessage = getOldestMessage(lastPage)
    return oldestMessage?.id
  },

  initialPageParam: undefined as string | undefined,
  staleTime: MESSAGE_QUERY_STALE_TIME_MS,
  gcTime: MESSAGE_QUERY_GC_TIME_MS,
})

export const prefetchMessages = async (queryClient: QueryClient, conversationId: string) => {
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
    }),
  )
}

export const prefetchMessagesForConversations = async (
  queryClient: QueryClient,
  conversationIds: string[],
) => {
  const uniqueConversationIds = Array.from(new Set(conversationIds.filter(Boolean)))

  await Promise.allSettled(
    uniqueConversationIds.map((conversationId) => prefetchMessages(queryClient, conversationId)),
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

export function useMessages(conversationId: string) {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)

  const conversation = useMemo(
    () => getCachedConversation(queryClient, conversationId),
    [queryClient, conversationId],
  )

  const query = useInfiniteQuery(
    getMessagesInfiniteQueryOptions({
      conversation,
      conversationId,
      currentUser,
    }),
  )

  const hasLoadedMessagePages = Boolean(query.data?.pages.length)

  useEffect(() => {
    if (!hasLoadedMessagePages || query.isFetching || !shouldSyncLatestMessages(conversationId)) {
      return
    }

    let cancelled = false

    const syncLatestMessages = async () => {
      try {
        const remotePage = await conversationApi.getMessages(conversationId, {
          limit: MESSAGE_PAGE_LIMIT,
        })
        markLatestMessagesSynced(conversationId)

        if (cancelled || remotePage.length === 0) {
          return
        }

        await upsertRemoteMessages({
          conversation: conversation ?? null,
          currentUser: currentUser ?? null,
          messages: remotePage,
        })

        if (cancelled) {
          return
        }

        queryClient.setQueryData<InfiniteData<Message[]> | undefined>(
          queryKeys.conversations.messages(conversationId),
          (oldData) => {
            if (!oldData?.pages?.length) {
              return {
                pages: [sortMessagesNewestFirst(remotePage)],
                pageParams: [undefined],
              }
            }

            const [firstPage = [], ...restPages] = oldData.pages

            return {
              ...oldData,
              pages: [
                sortMessagesNewestFirst(dedupeMessages([...remotePage, ...firstPage])),
                ...restPages,
              ],
            }
          },
        )
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
    hasLoadedMessagePages,
    query.isFetching,
    queryClient,
  ])

  return query
}

export function useSendMessage(conversationId: string) {
  const { socket } = useSocket()
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
        console.warn('[Socket] send_message queued: socket is disconnected', {
          socketId: socket.id,
          conversationId,
        })
        socket.connect()
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
        const thumbnailUri = getReplyPreviewThumbnailUri(resolvedReplyToMessage)
        replyPreview = {
          senderName: getReplyPreviewSenderName({
            conversation: currentConversation ?? null,
            currentUserId: user.id,
            senderEmail: resolvedReplyToMessage.sender?.email ?? null,
            senderId: resolvedReplyToMessage.senderId,
          }),
          senderId: resolvedReplyToMessage.senderId,
          content: resolvedReplyToMessage.content ?? '',
          ...(thumbnailUri ? { thumbnailUri } : {}),
          ...getReplyPreviewMediaSize(resolvedReplyToMessage),
          type: (resolvedReplyToMessage.type === 'voice' ? 'text' : resolvedReplyToMessage.type) as
            | 'text'
            | 'image'
            | 'video'
            | 'file'
            | 'call',
        }
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
      const confirmedMessage: Message = {
        ...result,
        ...(replyPreview ? { replyPreview } : {}),
      }

      if (tempId) {
        useChatStore.getState().confirmMessage(tempId, confirmedMessage)
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
