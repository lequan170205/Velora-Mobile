import { useQueryClient } from '@tanstack/react-query'
import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'

import { queryKeys } from '../constants/queryKeys'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import type { Message } from '../types/conversation.types'

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
}

const SocketContext = createContext<SocketContextType>({ socket: null, isConnected: false })

export const useSocket = () => useContext(SocketContext)

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore()
  const { setTyping, setUserOnline } = useChatStore()
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
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
    })

    newSocket.on('connect', () => {
      setIsConnected(true)
    })

    newSocket.on('disconnect', () => {
      setIsConnected(false)
    })

    // Message events
    newSocket.on('message:new', (message: Message) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(message.conversationId),
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    })

    newSocket.on('message:updated', (message: Message) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(message.conversationId),
      })
    })

    newSocket.on('message:deleted', ({ conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(conversationId),
      })
    })

    // Typing presence
    newSocket.on('typing', ({ userId, conversationId, isTyping }) => {
      setTyping(conversationId, userId, isTyping)
    })

    // User presence
    newSocket.on('user:online', ({ userId }) => {
      setUserOnline(userId, true)
    })

    newSocket.on('user:offline', ({ userId }) => {
      setUserOnline(userId, false)
    })

    // Call events placeholder
    newSocket.on('call:incoming', (_payload) => {
      // Show incoming call modal (Phase 5)
    })

    setSocket(newSocket)

    return () => {
      newSocket.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id])

  return <SocketContext.Provider value={{ socket, isConnected }}>{children}</SocketContext.Provider>
}
