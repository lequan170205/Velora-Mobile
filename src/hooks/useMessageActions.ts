import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert } from 'react-native'

import type { InfiniteData } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { useAuthStore } from '../stores/authStore'

import type { Message } from '../types/conversation.types'

function mergeMessageReactionsIntoCache(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  messageId: string,
  reactions: Message['reactions'],
) {
  queryClient.setQueryData(
    queryKeys.conversations.messages(conversationId),
    (oldData: InfiniteData<Message[]> | Message[] | undefined) => {
      if (!oldData) return oldData

      if ('pages' in oldData) {
        return {
          ...oldData,
          pages: (oldData as InfiniteData<Message[]>).pages.map((page: Message[]) =>
            page.map((msg: Message) =>
              msg.id === messageId ? { ...msg, reactions: reactions || {} } : msg,
            ),
          ),
        }
      }

      if (Array.isArray(oldData)) {
        return (oldData as Message[]).map((msg: Message) =>
          msg.id === messageId ? { ...msg, reactions: reactions || {} } : msg,
        )
      }

      return oldData
    },
  )
}

function mergeRecalledMessageIntoCache(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  message: Message,
) {
  queryClient.setQueryData(
    queryKeys.conversations.messages(conversationId),
    (oldData: InfiniteData<Message[]> | Message[] | undefined) => {
      if (!oldData) return oldData

      const applyRecall = (msg: Message) =>
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
          : msg

      if ('pages' in oldData) {
        return {
          ...oldData,
          pages: (oldData as InfiniteData<Message[]>).pages.map((page: Message[]) =>
            page.map(applyRecall),
          ),
        }
      }

      if (Array.isArray(oldData)) {
        return (oldData as Message[]).map(applyRecall)
      }

      return oldData
    },
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
      queryClient.setQueryData(
        queryKeys.conversations.messages(conversationId),
        (oldData: InfiniteData<Message[]> | Message[] | undefined) => {
          if (!oldData) return oldData

          if ('pages' in oldData) {
            return {
              ...oldData,
              pages: (oldData as InfiniteData<Message[]>).pages.map((page: Message[]) =>
                page.map((msg: Message) =>
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
                ),
              ),
            }
          }

          if (Array.isArray(oldData)) {
            return (oldData as Message[]).map((msg: Message) =>
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
          }

          return oldData
        },
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
    },
    onSuccess: ({ conversationId: currentConversationId, message }) => {
      mergeRecalledMessageIntoCache(queryClient, currentConversationId, message)
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
      queryClient.setQueryData(
        queryKeys.conversations.messages(conversationId),
        (oldData: InfiniteData<Message[]> | Message[] | undefined) => {
          if (!oldData) return oldData

          // Handle paginated data (pages array)
          if ('pages' in oldData) {
            return {
              ...oldData,
              pages: (oldData as InfiniteData<Message[]>).pages.map((page: Message[]) =>
                page.map((msg: Message) => {
                  if (msg.id === messageId) {
                    // New map structure
                    const reactionsMap = msg.reactions || {}
                    return {
                      ...msg,
                      reactions: {
                        ...reactionsMap,
                        [user.id]: { emoji, createdAt: now },
                      },
                    }
                  }
                  return msg
                }),
              ),
            }
          }

          // Handle regular array data
          if (Array.isArray(oldData)) {
            return (oldData as Message[]).map((msg: Message) => {
              if (msg.id === messageId) {
                const reactionsMap = msg.reactions || {}
                return {
                  ...msg,
                  reactions: {
                    ...reactionsMap,
                    [user.id]: { emoji, createdAt: now },
                  },
                }
              }
              return msg
            })
          }

          return oldData
        },
      )
    },
    onError: (_err, vars) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(vars.conversationId),
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

      queryClient.setQueryData(
        queryKeys.conversations.messages(conversationId),
        (oldData: InfiniteData<Message[]> | Message[] | undefined) => {
          if (!oldData) return oldData

          if ('pages' in oldData) {
            return {
              ...oldData,
              pages: (oldData as InfiniteData<Message[]>).pages.map((page: Message[]) =>
                page.map((msg: Message) => {
                  if (msg.id === messageId) {
                    const reactionsMap = msg.reactions || {}
                    const { [user.id]: _removed, ...remainingReactions } = reactionsMap
                    return {
                      ...msg,
                      reactions: remainingReactions,
                    }
                  }
                  return msg
                }),
              ),
            }
          }

          if (Array.isArray(oldData)) {
            return (oldData as Message[]).map((msg: Message) => {
              if (msg.id === messageId) {
                const reactionsMap = msg.reactions || {}
                const { [user.id]: removed, ...remainingReactions } = reactionsMap
                return {
                  ...msg,
                  reactions: remainingReactions,
                }
              }
              return msg
            })
          }

          return oldData
        },
      )
    },
    onError: (_err, vars) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(vars.conversationId),
      })
    },
    onSuccess: ({ messageId, conversationId, message }) => {
      mergeMessageReactionsIntoCache(queryClient, conversationId, messageId, message.reactions)
    },
  })
}
