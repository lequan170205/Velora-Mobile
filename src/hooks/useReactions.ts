import { useMutation, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '../constants/queryKeys'
import { useSocket } from '../providers/SocketProvider'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

export function useAddReaction() {
  const { socket } = useSocket()
  const { user } = useAuthStore()
  const { addReaction } = useChatStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ messageId, conversationId, emoji }: { messageId: string; conversationId: string; emoji: string }) => {
      if (!socket?.connected) {
        throw new Error('Socket not connected')
      }

      // Emit to server
      socket.emit('add_reaction', { messageId, emoji })

      // Optimistic update
      const reaction = {
        id: `temp-${Date.now()}`,
        messageId,
        userId: user?.id || '',
        emoji,
        createdAt: new Date().toISOString(),
      }

      addReaction(conversationId, messageId, reaction)

      return { messageId, conversationId, emoji }
    },
    onSuccess: ({ conversationId }) => {
      // Invalidate to get server response
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(conversationId),
      })
    },
  })
}

export function useRemoveReaction() {
  const { socket } = useSocket()
  const { user } = useAuthStore()
  const { removeReaction } = useChatStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ messageId, conversationId }: { messageId: string; conversationId: string }) => {
      if (!socket?.connected) {
        throw new Error('Socket not connected')
      }

      // Emit to server
      socket.emit('remove_reaction', { messageId })

      // Optimistic update
      if (user?.id) {
        removeReaction(conversationId, messageId, user.id)
      }

      return { messageId, conversationId }
    },
    onSuccess: ({ conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(conversationId),
      })
    },
  })
}
