import { useQueryClient } from '@tanstack/react-query'
import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'

import { queryKeys } from '../constants/queryKeys'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import type { Message, Reaction } from '../types/conversation.types'

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
}

const SocketContext = createContext<SocketContextType>({ socket: null, isConnected: false })

export const useSocket = () => useContext(SocketContext)

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore()
  const { setTyping, setUserOnline, markMessagesAsSeen, addReaction, removeReaction, markMessageDeleted } = useChatStore()
  const queryClient = useQueryClient()

  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!isAuthenticated || !user) {
      if (socket) {
        socket.disconnect()
        setSocket(null)
      }
      return
    }

    const newSocket = io(process.env.EXPO_PUBLIC_WS_URL || 'http://localhost:3000', {
      withCredentials: true,
      query: { userId: user.id },
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
    })

    newSocket.on('connect', () => {
      setIsConnected(true)

      const queue = useChatStore.getState().offlineQueue
      queue.forEach((msg) => {
        newSocket.emit('send_message', {
          conversationId: msg.conversationId,
          content: msg.content,
          type: 'text',
          signalType: 0,
        })
        useChatStore.getState().dequeueOfflineMessage(msg.id)
      })
    })

    newSocket.on('disconnect', () => {
      setIsConnected(false)
    })

    newSocket.on('new_message', (message: Message) => {
      if (user?.id && message.senderId === user.id) {
        const store = useChatStore.getState()
        const pendingMsgs = store.optimisticMessages[message.conversationId] || []
        const match = pendingMsgs.find((m) => m.content === message.content)

        if (match) {
          store.confirmMessage(match.id, message)
        }
      }

      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(message.conversationId),
      })
    })

    newSocket.on('message_synced', (message: Message) => {
      if (user?.id && message.senderId === user.id) {
        const store = useChatStore.getState()
        const pendingMsgs = store.optimisticMessages[message.conversationId] || []
        const match = pendingMsgs.find((m) => m.content === message.content)

        if (match) {
          store.confirmMessage(match.id, message)
        }
      }

      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(message.conversationId),
      })
    })

    newSocket.on('user_typing', ({ conversationId, userId, isTyping }) => {
      setTyping(conversationId, userId, isTyping)
    })

    newSocket.on('message:deleted', ({ conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(conversationId),
      })
    })

    newSocket.on('typing', ({ userId, conversationId, isTyping }) => {
      setTyping(conversationId, userId, isTyping)
    })

    newSocket.on('user:online', ({ userId }) => {
      setUserOnline(userId, true)
    })

    newSocket.on('user:offline', ({ userId }) => {
      setUserOnline(userId, false)
    })

    newSocket.on('messages_seen', ({ conversationId, readByUserId }) => {
      markMessagesAsSeen(conversationId, readByUserId)
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(conversationId),
      })
    })

    newSocket.on('call:incoming', (_payload) => {})

    // Message reactions
    newSocket.on('reaction_added', (data: { messageId: string; conversationId: string; userId: string; emoji: string }) => {
      const reaction: Reaction = {
        id: `server-${Date.now()}`,
        messageId: data.messageId,
        userId: data.userId,
        emoji: data.emoji,
        createdAt: new Date().toISOString(),
      }
      addReaction(data.conversationId, data.messageId, reaction)
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(data.conversationId),
      })
    })

    newSocket.on('reaction_removed', (data: { messageId: string; conversationId: string; userId: string }) => {
      removeReaction(data.conversationId, data.messageId, data.userId)
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(data.conversationId),
      })
    })

    // Unsend message
    newSocket.on('message_unsent', (data: { messageId: string; conversationId: string; deletedBy: string }) => {
      markMessageDeleted(data.conversationId, data.messageId, data.deletedBy)
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(data.conversationId),
      })
    })

    setSocket(newSocket)

    return () => {
      newSocket.disconnect()
    }
  }, [isAuthenticated, user?.id])

  return <SocketContext.Provider value={{ socket, isConnected }}>{children}</SocketContext.Provider>
}
