import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert } from 'react-native'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { markMessageRecalled } from '../database/messageSync'
import { patchConversationMessageCollectionsInCache } from '../lib/chatMessageCache'
import { useAuthStore } from '../stores/authStore'

import type { Message } from '../types/conversation.types'

function mergeMessageReactionsIntoCache(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  messageId: string,
  reactions: Message['reactions'],
) {
  patchConversationMessageCollectionsInCache(queryClient, conversationId, (msg) =>
    msg.id === messageId ? { ...msg, reactions: reactions || {} } : msg,
  )
}

function mergeRecalledMessageIntoCache(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  message: Message,
) {
  patchConversationMessageCollectionsInCache(queryClient, conversationId, (msg) =>
    msg.id === message.id
      ? {
          ...msg,
          ...message,
          isRecalled: true,
          recalledAt: message.recalledAt || new Date().toISOString(),
          is_recalled: true,
          recalled_at: message.recalledAt || new Date().toISOString(),
          reactions: {},
        }
      : msg,
  )
}

export function useRecallMessage(conversationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (messageId: string) => {
      const message = await conversationApi.recallMessage(conversationId, messageId)
      return { messageId, conversationId, message }
    },
    onMutate: async (messageId) => {
      const now = new Date().toISOString()
      patchConversationMessageCollectionsInCache(queryClient, conversationId, (msg) =>
        msg.id === messageId
          ? {
              ...msg,
              isRecalled: true,
              recalledAt: now,
              is_recalled: true,
              recalled_at: now,
              reactions: {},
            }
          : msg,
      )
    },
    onError: (error) => {
      const errorMessage = error?.message || ''
      if (errorMessage === 'Message already recalled') {
        return
      }
      Alert.alert(
        'Không thể thu hồi',
        errorMessage ||
          'Tin nhắn không thể thu hồi. Có thể đã quá 24 giờ hoặc không hỗ trợ loại tin nhắn này.',
        [{ text: 'OK' }],
      )
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(conversationId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messagesAroundRoot(conversationId),
      })
    },
    onSuccess: ({ conversationId: currentConversationId, message }) => {
      mergeRecalledMessageIntoCache(queryClient, currentConversationId, message)
      void markMessageRecalled({
        messageId: message.id,
        ...(message.recalledAt ? { recalledAt: message.recalledAt } : {}),
      }).catch((error) => {
        console.warn('[Recall] Failed to persist recalled message locally', error)
      })
    },
  })
}

export function useAddReaction() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({
      messageId,
      emoji,
      conversationId,
    }: {
      messageId: string
      emoji: string
      conversationId: string
    }) => {
      if (!user) {
        throw new Error('User is not authenticated')
      }

      const message = await conversationApi.addReaction(messageId, user.id, emoji)
      return { messageId, conversationId, message }
    },
    onMutate: async ({ messageId, emoji, conversationId }) => {
      if (!user) return

      const now = new Date().toISOString()
      patchConversationMessageCollectionsInCache(queryClient, conversationId, (msg) => {
        if (msg.id !== messageId) {
          return msg
        }

        const reactionsMap = msg.reactions || {}
        return {
          ...msg,
          reactions: {
            ...reactionsMap,
            [user.id]: { emoji, createdAt: now },
          },
        }
      })
    },
    onError: (_err, vars) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(vars.conversationId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messagesAroundRoot(vars.conversationId),
      })
    },
    onSuccess: ({ messageId, conversationId, message }) => {
      mergeMessageReactionsIntoCache(queryClient, conversationId, messageId, message.reactions)
    },
  })
}

export function useRemoveReaction() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({
      messageId,
      conversationId,
    }: {
      messageId: string
      conversationId: string
    }) => {
      if (!user) {
        throw new Error('User is not authenticated')
      }

      const message = await conversationApi.removeReaction(messageId, user.id)
      return { messageId, conversationId, message }
    },
    onMutate: async ({ messageId, conversationId }) => {
      if (!user) return

      patchConversationMessageCollectionsInCache(queryClient, conversationId, (msg) => {
        if (msg.id !== messageId) {
          return msg
        }

        const reactionsMap = msg.reactions || {}
        const { [user.id]: _removed, ...remainingReactions } = reactionsMap
        return {
          ...msg,
          reactions: remainingReactions,
        }
      })
    },
    onError: (_err, vars) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(vars.conversationId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messagesAroundRoot(vars.conversationId),
      })
    },
    onSuccess: ({ messageId, conversationId, message }) => {
      mergeMessageReactionsIntoCache(queryClient, conversationId, messageId, message.reactions)
    },
  })
}
