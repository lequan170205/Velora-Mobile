import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import {
  upsertConversationSummaryInCache,
  upsertMessageIntoConversationCache,
} from '../lib/chatMessageCache'
import { createClientMessageId } from '../lib/clientMessageId'
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
  clientMessageId?: string
}

export const MESSAGE_QUERY_STALE_TIME_MS = 60 * 1000
export const MESSAGE_QUERY_GC_TIME_MS = 3 * 60 * 1000
export const MESSAGE_CACHE_WARMUP_LIMIT = 0
export const MESSAGE_PAGE_LIMIT = 15
export const MESSAGE_PREFETCH_ENABLED = true

export const getMessagesInfiniteQueryOptions = (conversationId: string) => ({
  queryKey: queryKeys.conversations.messages(conversationId),
  queryFn: ({ pageParam = undefined }: { pageParam?: unknown }) =>
    conversationApi.getMessages(conversationId, {
      limit: MESSAGE_PAGE_LIMIT,
      ...(pageParam ? { cursor: pageParam as string } : {}),
    }),
  getNextPageParam: (lastPage: Message[]) => {
    if (!lastPage || lastPage.length === 0) return undefined

    const oldestMessage = lastPage.reduce((oldest, current) => {
      return new Date(current.createdAt).getTime() < new Date(oldest.createdAt).getTime()
        ? current
        : oldest
    }, lastPage[0])

    return oldestMessage.id
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

  await queryClient.prefetchInfiniteQuery(getMessagesInfiniteQueryOptions(conversationId))
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

      const [latestPage = []] = oldData.pages
      const [latestPageParam] = oldData.pageParams

      if (oldData.pages.length === 1 && latestPage.length <= MESSAGE_PAGE_LIMIT) {
        return oldData
      }

      return {
        ...oldData,
        pages: [latestPage.slice(0, MESSAGE_PAGE_LIMIT)],
        pageParams: [latestPageParam],
      }
    },
  )
}

export function useMessages(conversationId: string) {
  return useInfiniteQuery(getMessagesInfiniteQueryOptions(conversationId))
}

export function useSendMessage(conversationId: string) {
  const { socket } = useSocket()
  const { addOptimisticMessage, enqueueOfflineMessage, markMessageFailed, replyToMessage } =
    useChatStore()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: SendMessageVariables) => {
      const { content, media, replyToId } = variables
      const resolvedClientMessageId = ensureClientMessageId(variables)
      const type = variables.type ?? 'text'

      if (type !== 'text' || media) {
        return conversationApi.sendMessage(conversationId, {
          clientMessageId: resolvedClientMessageId,
          content,
          media,
          type,
          signalType: 0,
          ...(replyToId ? { replyToId } : {}),
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

      if (replyToId) payload.replyToId = replyToId

      socket.emit('send_message', payload)

      const refetchDelays = [800, 2500]
      refetchDelays.forEach((delay) => {
        setTimeout(() => {
          queryClient.refetchQueries({
            queryKey: queryKeys.conversations.messages(conversationId),
          })
          queryClient.refetchQueries({
            queryKey: queryKeys.conversations.all,
          })
        }, delay)
      })

      return payload
    },
    onMutate: async (variables: SendMessageVariables) => {
      if (!user) return

      const { content, media, replyToId } = variables
      const now = new Date().toISOString()
      const tempId = ensureClientMessageId(variables)
      const type = variables.type ?? 'text'

      let replyPreview: Message['replyPreview'] | undefined = undefined
      if (replyToId && replyToMessage) {
        replyPreview = {
          senderName:
            replyToMessage.senderId === user.id
              ? 'You'
              : (replyToMessage.sender?.email?.split('@')[0] ?? 'User'),
          content: replyToMessage.content ?? '',
          type: (replyToMessage.type === 'voice' ? 'text' : replyToMessage.type) as
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
        status: 'SENT',
        createdAt: now,
        updatedAt: now,
        ...(replyToId && { replyToId }),
        ...(replyPreview && { replyPreview }),
      }

      addOptimisticMessage(conversationId, tempMessage)
      if (type === 'text' && !media) {
        enqueueOfflineMessage({
          id: tempId,
          conversationId,
          content,
          ...(replyToId ? { replyToId } : {}),
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

      return { tempId }
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
      if (tempId) {
        useChatStore.getState().confirmMessage(tempId, result)
        upsertMessageIntoConversationCache(queryClient, result)
        upsertConversationSummaryInCache(queryClient, {
          id: result.conversationId,
          lastMessage: result.content,
          lastMessageAt: result.createdAt,
          updatedAt: result.updatedAt,
        })
      }

      if ((variables.type ?? 'text') === 'text' && !variables.media && result.clientMessageId) {
        useChatStore.getState().dequeueOfflineMessage(result.clientMessageId)
      }
    },
  })
}
