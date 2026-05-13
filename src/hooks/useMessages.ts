import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { useSocket } from '../providers/SocketProvider'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

import type { Conversation, Message } from '../types/conversation.types'

const createClientMessageId = () => {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  return `temp-${randomPart}`
}

const ensureClientMessageId = (variables: { clientMessageId?: string }) => {
  if (!variables.clientMessageId) {
    variables.clientMessageId = createClientMessageId()
  }

  return variables.clientMessageId
}

interface SendMessageVariables {
  content: string
  replyToId?: string
  clientMessageId?: string
}

export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.conversations.messages(conversationId),
    queryFn: ({ pageParam = undefined }) =>
      conversationApi.getMessages(conversationId, pageParam ? { cursor: pageParam as string } : {}),
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.length === 0) return undefined

      const oldestMessage = lastPage.reduce((oldest, current) => {
        return new Date(current.createdAt).getTime() < new Date(oldest.createdAt).getTime()
          ? current
          : oldest
      }, lastPage[0])

      return oldestMessage.id
    },
    initialPageParam: undefined as string | undefined,
  })
}

export function useSendMessage(conversationId: string) {
  const { socket } = useSocket()
  const { addOptimisticMessage, enqueueOfflineMessage, markMessageFailed, replyToMessage } =
    useChatStore()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: SendMessageVariables) => {
      const { content, replyToId } = variables
      const resolvedClientMessageId = ensureClientMessageId(variables)

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
        type: 'text',
        signalType: 0,
        clientMessageId: resolvedClientMessageId,
      }

      if (replyToId) payload.replyToId = replyToId

      console.log('[Socket] emitting send_message', {
        socketId: socket.id,
        conversationId,
      })
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

      const { content, replyToId } = variables
      const now = new Date().toISOString()
      const tempId = ensureClientMessageId(variables)

      let replyPreview: Message['replyPreview'] | undefined = undefined
      if (replyToId && replyToMessage) {
        replyPreview = {
          senderName: replyToMessage.sender?.email?.split('@')[0] ?? 'User',
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
        type: 'text',
        status: 'SENT',
        createdAt: now,
        updatedAt: now,
        ...(replyToId && { replyToId }),
        ...(replyPreview && { replyPreview }),
      }

      addOptimisticMessage(conversationId, tempMessage)
      enqueueOfflineMessage({
        id: tempId,
        conversationId,
        content,
        ...(replyToId ? { replyToId } : {}),
      })

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
  })
}
