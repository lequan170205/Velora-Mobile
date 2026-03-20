import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert } from 'react-native'

import { queryKeys } from '../constants/queryKeys'
import { useSocket } from '../providers/SocketProvider'
import { useAuthStore } from '../stores/authStore'

export function useRecallMessage(conversationId: string) {
  const queryClient = useQueryClient()
  const { socket } = useSocket()

  return useMutation({
    mutationFn: async (messageId: string) => {
      if (!socket || !socket.connected) {
        throw new Error('Socket is not connected')
      }

      socket.emit('recall_message', { messageId })
      return { messageId, conversationId }
    },
    onMutate: async (messageId) => {
      const now = new Date().toISOString()
      queryClient.setQueryData(queryKeys.conversations.messages(conversationId), (oldData: any) => {
        if (!oldData) return oldData

        if (oldData.pages) {
          return {
            ...oldData,
            pages: oldData.pages.map((page: any[]) =>
              page.map((msg: any) =>
                msg.id === messageId
                  ? {
                      ...msg,
                      isRecalled: true,
                      recalledAt: now,
                      is_recalled: true,
                      recalled_at: now,
                    }
                  : msg,
              ),
            ),
          }
        }

        if (Array.isArray(oldData)) {
          return oldData.map((msg: any) =>
            msg.id === messageId
              ? { ...msg, isRecalled: true, recalledAt: now, is_recalled: true, recalled_at: now }
              : msg,
          )
        }

        return oldData
      })
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
  })
}

export function useAddReaction() {
  const queryClient = useQueryClient()
  const { socket } = useSocket()
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
      if (!socket || !socket.connected) {
        throw new Error('Socket is not connected')
      }

      socket.emit('add_reaction', { messageId, emoji })
      return { messageId, conversationId }
    },
    onMutate: async ({ messageId, emoji, conversationId }) => {
      if (!user) return

      const now = new Date().toISOString()
      queryClient.setQueryData(queryKeys.conversations.messages(conversationId), (oldData: any) => {
        if (!oldData) return oldData

        // Handle paginated data (pages array)
        if (oldData.pages) {
          return {
            ...oldData,
            pages: oldData.pages.map((page: any[]) =>
              page.map((msg: any) => {
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
          return oldData.map((msg: any) => {
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
      })
    },
    onError: (_err, vars) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(vars.conversationId),
      })
    },
  })
}

export function useRemoveReaction() {
  const queryClient = useQueryClient()
  const { socket } = useSocket()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({
      messageId,
      conversationId,
    }: {
      messageId: string
      conversationId: string
    }) => {
      if (!socket || !socket.connected) {
        throw new Error('Socket is not connected')
      }

      socket.emit('remove_reaction', { messageId })
      return { messageId, conversationId }
    },
    onMutate: async ({ messageId, conversationId }) => {
      if (!user) return

      queryClient.setQueryData(queryKeys.conversations.messages(conversationId), (oldData: any) => {
        if (!oldData) return oldData

        if (oldData.pages) {
          return {
            ...oldData,
            pages: oldData.pages.map((page: any[]) =>
              page.map((msg: any) => {
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
          return oldData.map((msg: any) => {
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
      })
    },
    onError: (_err, vars) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(vars.conversationId),
      })
    },
  })
}
