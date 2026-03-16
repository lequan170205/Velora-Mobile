import * as Notifications from 'expo-notifications'
import { useEffect, useRef } from 'react'

import { useSocket } from '../providers/SocketProvider'
import { useAuthStore } from '../stores/authStore'
import type { Message } from '../types/conversation.types'

// Hook to handle message notifications
export function useMessageNotifications() {
  const { socket } = useSocket()
  const { user } = useAuthStore()
  const currentConversationRef = useRef<string | null>(null)

  // Set current conversation (call this from conversation screen)
  const setCurrentConversation = (conversationId: string | null) => {
    currentConversationRef.current = conversationId
  }

  useEffect(() => {
    if (!socket) return

    const handleNewMessage = async (message: Message) => {
      // Don't show notification for own messages
      if (message.senderId === user?.id) {
        return
      }

      // Don't show notification if user is currently viewing this conversation
      if (currentConversationRef.current === message.conversationId) {
        return
      }

      // Get sender name from message sender (either email or fallback)
      const senderName = message.sender?.email || 'New Message'

      // Show local notification
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: senderName,
            body: message.content,
            data: {
              type: 'MESSAGE',
              conversationId: message.conversationId,
              senderId: message.senderId,
              senderName: senderName,
              messageContent: message.content,
            },
            sound: 'default',
          },
          trigger: null, // Show immediately
        })
      } catch (error) {
        console.error('Error showing notification:', error)
      }
    }

    socket.on('new_message', handleNewMessage)

    return () => {
      socket.off('new_message', handleNewMessage)
    }
  }, [socket, user?.id])

  return { setCurrentConversation }
}
