import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { useSocket } from '../providers/SocketProvider'
import { useChatStore } from '../stores/chatStore'

/**
 * Mutation hook for the bot-chat endpoint.
 * Calls POST /conversations/chat — backend auto-creates the bot conversation
 * if one doesn't exist, then sends the user's message.
 * On success: marks the conversation as a bot chat (persisted), joins the
 * conversation room, invalidates the conversation list, and navigates.
 */
export function useBotChat() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { socket } = useSocket()
  const { markAsBotConversation } = useChatStore()

  return useMutation({
    mutationFn: (content: string) => conversationApi.chatWithBot({ content }),
    onSuccess: (data) => {
      const conversationId = data.conversationId

      // Persist this conversation as a bot conversation so that
      // ChatScreen always uses REST for sending, regardless of entry point.
      markAsBotConversation(conversationId)

      // Join the conversation room BEFORE navigating so we receive
      // the bot's WebSocket reply (which may arrive almost instantly).
      if (socket?.connected) {
        socket.emit('join_conversation', conversationId)
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
      router.push(`/conversation/${conversationId}`)

      // The bot reply may take a few seconds. Poll at increasing intervals.
      const delays = [500, 1500, 3000, 5000, 8000]
      delays.forEach((ms) => {
        setTimeout(() => {
          queryClient.refetchQueries({
            queryKey: queryKeys.conversations.messages(conversationId),
          })
        }, ms)
      })
    },
  })
}
