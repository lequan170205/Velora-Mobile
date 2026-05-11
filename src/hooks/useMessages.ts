import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { useSocket } from '../providers/SocketProvider'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

import type { Conversation, Message } from '../types/conversation.types'

export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.conversations.messages(conversationId),
    queryFn: ({ pageParam = undefined }) =>
      conversationApi.getMessages(conversationId, pageParam ? { cursor: pageParam as string } : {}),
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.length === 0) {
        return undefined
      }

      return lastPage[0].id
    },
    initialPageParam: undefined as string | undefined,
  })
}

export function useSendMessage(conversationId: string) {
  const { socket } = useSocket()
  const { addOptimisticMessage, enqueueOfflineMessage, replyToMessage } = useChatStore()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ content, replyToId }: { content: string; replyToId?: string }) => {
      if (!socket) throw new Error('Socket is not connected')

      if (!socket.connected) {
        return Promise.resolve({ pending: true })
      }

      const payload: {
        conversationId: string
        content: string
        type: string
        signalType: number
        replyToId?: string
      } = {
        conversationId,
        content,
        type: 'text',
        signalType: 0,
      }

      if (replyToId) {
        payload.replyToId = replyToId
      }

      socket.emit('send_message', payload)
      return payload
    },
    onMutate: async ({ content, replyToId }) => {
      if (!user) return

      const now = new Date().toISOString()
      const tempId = `temp-${Date.now()}`

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

      if (!socket || !socket.connected) {
        enqueueOfflineMessage({ id: tempId, conversationId, content })
      }

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
