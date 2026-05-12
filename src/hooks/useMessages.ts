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
      if (!lastPage || lastPage.length === 0) {
        return undefined
      }

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

      if (!socket || !socket.connected) {
        return Promise.resolve({ pending: true })
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

      if (replyToId) {
        payload.replyToId = replyToId
      }

      socket.emit('send_message', payload)
      return payload
    },
    onMutate: async (variables: SendMessageVariables) => {
      if (!user) return

      const { content, replyToId } = variables
      const now = new Date().toISOString()
      const tempId = ensureClientMessageId(variables)

      // Build replyPreview from replyToMessage if replying
      let replyPreview: Message['replyPreview'] = undefined
      if (replyToId && replyToMessage) {
        replyPreview = {
          senderName: replyToMessage.sender?.email?.split('@')[0] || 'User',
          content: replyToMessage.content || '',
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
        (oldData: Conversation[] | undefined) => {
          if (!oldData) return oldData

          const sortConvs = (convs: Conversation[]) => {
            return convs.sort((a: Conversation, b: Conversation) => {
              const dateA = new Date(a.lastMessageAt || 0).getTime()
              const dateB = new Date(b.lastMessageAt || 0).getTime()
              return dateB - dateA
            })
          }

          if (Array.isArray(oldData)) {
            const targetConv = (oldData as Conversation[]).find(
              (c: Conversation) => c.id === conversationId,
            )
            const filteredConvs = (oldData as Conversation[]).filter(
              (c: Conversation) => c.id !== conversationId,
            )

            if (targetConv) {
              const updatedConv = {
                ...targetConv,
                lastMessage: content,
                lastMessageAt: now,
              }
              return sortConvs([updatedConv, ...filteredConvs])
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

/**
 * Mutation hook for sending messages in bot conversations.
 * Uses the REST endpoint POST /conversations/chat instead of socket.emit
 * because bot auto-replies are only triggered by the REST endpoint.
 */
export function useSendBotMessage(conversationId: string) {
  const { addOptimisticMessage } = useChatStore()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ content }: { content: string }) => {
      return conversationApi.chatWithBot({ content })
    },
    onMutate: async ({ content }) => {
      if (!user) return

      const now = new Date().toISOString()
      const tempId = `temp-${Date.now()}`

      const tempMessage: Message = {
        id: tempId,
        conversationId,
        senderId: user.id,
        sender: user,
        content,
        type: 'text',
        status: 'SENT',
        createdAt: now,
        updatedAt: now,
      }

      addOptimisticMessage(conversationId, tempMessage)

      // Move this conversation to the top of the list
      queryClient.setQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
        (oldData: Conversation[] | undefined) => {
          if (!oldData) return oldData

          const sortConvs = (convs: Conversation[]) => {
            return convs.sort((a: Conversation, b: Conversation) => {
              const dateA = new Date(a.lastMessageAt || 0).getTime()
              const dateB = new Date(b.lastMessageAt || 0).getTime()
              return dateB - dateA
            })
          }

          if (Array.isArray(oldData)) {
            const targetConv = (oldData as Conversation[]).find(
              (c: Conversation) => c.id === conversationId,
            )
            const filteredConvs = (oldData as Conversation[]).filter(
              (c: Conversation) => c.id !== conversationId,
            )
            if (targetConv) {
              return sortConvs([
                { ...targetConv, lastMessage: content, lastMessageAt: now },
                ...filteredConvs,
              ])
            }
          }

          return oldData
        },
      )

      return { tempId }
    },
    onSuccess: (data, variables, context) => {
      const { tempId } = context || {}
      if (tempId) {
        useChatStore.getState().removeOptimisticMessage(conversationId, tempId)
      }

      // The bot reply is generated asynchronously and may take several
      // seconds. Poll with increasing delays until we pick it up.
      const delays = [500, 1500, 3000, 5000, 8000]
      const messageKey = queryKeys.conversations.messages(conversationId)

      delays.forEach((ms) => {
        setTimeout(() => {
          queryClient.refetchQueries({ queryKey: messageKey })
          queryClient.refetchQueries({ queryKey: queryKeys.conversations.all })
        }, ms)
      })
    },
    onError: (err, variables, context) => {
      const { tempId } = context || {}
      if (tempId) {
        useChatStore.getState().removeOptimisticMessage(conversationId, tempId)
      }
    },
  })
}
