import { useMutation, useQueryClient } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { useSocket } from '../providers/SocketProvider'
import { useChatStore } from '../stores/chatStore'

import { useConversationNavigation } from './useConversationNavigation'

/**
 * Creates or retrieves the direct conversation with the bot.
 * The first user message should be sent from the chat screen via WebSocket.
 */
export function useBotChat() {
  const queryClient = useQueryClient()
  const { socket } = useSocket()
  const { markAsBotConversation } = useChatStore()
  const { openConversation } = useConversationNavigation()

  return useMutation({
    mutationFn: async () => {
      const conversation = await conversationApi.createBotConversation()
      const conversationId = conversation.id

      // Join early when possible so we can receive the bot reply over WebSocket.
      if (socket?.connected) {
        socket.emit('join_conversation', conversationId)
      }

      return { conversationId }
    },
    onSuccess: (data) => {
      const { conversationId } = data

      markAsBotConversation(conversationId)

      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
      openConversation(conversationId)
    },
  })
}
