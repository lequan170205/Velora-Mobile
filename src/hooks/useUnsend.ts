import { useMutation, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '../constants/queryKeys'
import { useSocket } from '../providers/SocketProvider'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

export function useUnsendMessage() {
  const { socket } = useSocket()
  const { user } = useAuthStore()
  const { markMessageDeleted } = useChatStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ messageId, conversationId }: { messageId: string; conversationId: string }) => {
      if (!socket?.connected) {
        throw new Error('Socket not connected')
      }

      // Emit to server
      socket.emit('unsend_message', { messageId })

      // Optimistic update
      if (user?.id) {
        markMessageDeleted(conversationId, messageId, user.id)
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
