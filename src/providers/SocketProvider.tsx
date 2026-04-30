import { useQueryClient } from '@tanstack/react-query'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'

import { queryKeys } from '../constants/queryKeys'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

import type { Message } from '../types/conversation.types'
import type { Socket } from 'socket.io-client'

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
}

const SocketContext = createContext<SocketContextType>({ socket: null, isConnected: false })

export const useSocket = () => useContext(SocketContext)

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, isLoading } = useAuthStore()
  const { setTyping, setUserOnline, markMessagesAsSeen, setMessageAsSeen } = useChatStore()
  const queryClient = useQueryClient()

  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (isLoading) {
      return
    }

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
      forceNew: true,
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
    })

    newSocket.on('connect', () => {
      setIsConnected(true)
      console.log('🔌 Socket connected!')

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
      console.log('🔌 Socket disconnected!')
    })

    // Debug: Log ALL events to see what's coming through
    newSocket.onAny((eventName, ...args) => {
      console.log('📡 Socket event:', eventName, args)
    })

    newSocket.on('new_message', (message: Message) => {
      const currentUser = useAuthStore.getState().user
      const conversationId = message.conversationId

      console.log('🚨 [DEBUG SOCKET] Nhận tin nhắn mới:', message)

      // 1. CẬP NHẬT UI TẠM THỜI (PURE FUNCTION)
      queryClient.setQueryData(queryKeys.conversations.all, (oldData: any) => {
        console.log(
          '[DEBUG] setQueryData called, oldData:',
          oldData ? `${Array.isArray(oldData) ? oldData.length + ' items' : 'not array'}` : 'null',
        )

        let conversations = oldData
        if (!oldData || !Array.isArray(oldData)) {
          console.log('[DEBUG] Creating new array, oldData was:', oldData)
          conversations = []
        }

        const existingConv = conversations.find((c: any) => c.id === conversationId)
        console.log('[DEBUG] Existing conversation:', existingConv ? 'found' : 'not found')

        if (existingConv) {
          const updatedConversation = {
            ...existingConv,
            lastMessage: message.content || existingConv.lastMessage,
            lastMessageAt: message.createdAt || new Date().toISOString(),
          }

          const otherConversations = conversations.filter((c: any) => c.id !== conversationId)
          console.log('[DEBUG] Returning updated conversation')
          return [updatedConversation, ...otherConversations]
        } else {
          const placeholderConversation = {
            id: conversationId,
            lastMessage: message.content,
            lastMessageAt: message.createdAt,
            participants: [],
            isGroup: false,
            creatorId: '',
            participantIds: [message.senderId],
            createdAt: message.createdAt,
            updatedAt: message.createdAt,
          }

          console.log('[DEBUG] Returning new placeholder conversation')
          return [placeholderConversation, ...conversations]
        }
      })

      setTimeout(() => {
        console.log('🔄 [DEBUG SOCKET] Refetching conversation list...')
        queryClient.refetchQueries({
          queryKey: queryKeys.conversations.all,
        })
      }, 100)

      if (currentUser?.id && message.senderId !== currentUser.id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.messages(conversationId),
        })
      }

      if (currentUser?.id && message.senderId === currentUser.id) {
        const store = useChatStore.getState()
        const pendingMsgs = store.optimisticMessages[conversationId] || []
        const match = pendingMsgs.find((m) => m.content === message.content)

        if (match) {
          store.confirmMessage(match.id, message)
        }
      }
    })

    newSocket.on('conversation_updated', (conversation: any) => {
      console.log('📬 [DEBUG] conversation_updated received:', conversation)

      if (!conversation?.id) return

      queryClient.setQueryData(queryKeys.conversations.all, (oldData: any) => {
        if (!oldData || !Array.isArray(oldData)) return oldData

        const existingConv = oldData.find((c: any) => c.id === conversation.id)

        if (existingConv) {
          const otherConversations = oldData.filter((c: any) => c.id !== conversation.id)
          return [conversation, ...otherConversations]
        } else {
          return [conversation, ...oldData]
        }
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
        // Don't invalidate - message is confirmed locally
      } else {
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.messages(message.conversationId),
        })
      }
    })

    newSocket.on('user_typing', ({ conversationId, userId, isTyping }) => {
      setTyping(conversationId, userId, isTyping)
    })

    newSocket.on('message:deleted', ({ conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(conversationId),
      })
    })

    newSocket.on('message_recalled', ({ messageId }: { messageId: string }) => {
      const now = new Date().toISOString()
      const allQueries = queryClient.getQueriesData<any>({ queryKey: ['conversations'] })

      for (const [queryKey] of allQueries) {
        if (!Array.isArray(queryKey) || queryKey.length !== 3 || queryKey[2] !== 'messages')
          continue

        queryClient.setQueryData(queryKey, (oldData: any) => {
          if (!oldData) return oldData

          let updated = false
          let newData = oldData

          if (oldData.pages) {
            newData = {
              ...oldData,
              pages: oldData.pages.map((page: any[]) =>
                page.map((msg: any) => {
                  if (msg.id === messageId) {
                    updated = true
                    return {
                      ...msg,
                      isRecalled: true,
                      recalledAt: now,
                      is_recalled: true,
                      recalled_at: now,
                      reactions: {}, // Clear reactions on recall
                    }
                  }
                  return msg
                }),
              ),
            }
          } else if (Array.isArray(oldData)) {
            newData = oldData.map((msg: any) => {
              if (msg.id === messageId) {
                updated = true
                return {
                  ...msg,
                  isRecalled: true,
                  recalledAt: now,
                  is_recalled: true,
                  recalled_at: now,
                  reactions: {}, // Clear reactions on recall
                }
              }
              return msg
            })
          }

          return updated ? newData : oldData
        })
      }
    })

    newSocket.on('reply_previews_updated', (payload: any) => {
      const messageIds = payload?.updatedMessageIds || payload?.messageIds || []

      if (!messageIds.length) return

      console.log('📝 reply_previews_updated received:', messageIds)

      const store = useChatStore.getState()
      if (store.optimisticMessages) {
        let hasChanges = false
        const newOptimistic = { ...store.optimisticMessages }

        Object.keys(newOptimistic).forEach((convId) => {
          let convChanged = false
          const updatedMsgs = newOptimistic[convId].map((msg) => {
            if (messageIds.includes(msg.id) && msg.replyPreview) {
              hasChanges = true
              convChanged = true
              const updatedPreview =
                typeof msg.replyPreview === 'object'
                  ? {
                      ...msg.replyPreview,
                      content: payload.previewContent || 'Tin nhắn đã thu hồi',
                    }
                  : payload.previewContent || 'Tin nhắn đã thu hồi'
              return { ...msg, replyPreview: updatedPreview }
            }
            return msg
          })
          if (convChanged) newOptimistic[convId] = updatedMsgs
        })

        if (hasChanges) {
          useChatStore.setState({ optimisticMessages: newOptimistic })
        }
      }

      const allQueries = queryClient.getQueriesData<any>({ queryKey: ['conversations'] })

      for (const [queryKey] of allQueries) {
        if (!Array.isArray(queryKey) || queryKey.length !== 3 || queryKey[2] !== 'messages')
          continue

        queryClient.setQueryData(queryKey, (oldData: any) => {
          if (!oldData) return oldData

          let updated = false
          let newData = oldData

          if (oldData.pages) {
            newData = {
              ...oldData,
              pages: oldData.pages.map((page: any[]) =>
                page.map((msg: any) => {
                  if (messageIds.includes(msg.id) && msg.replyPreview) {
                    updated = true
                    const updatedPreview =
                      typeof msg.replyPreview === 'object'
                        ? {
                            ...msg.replyPreview,
                            content: payload.previewContent || 'Tin nhắn đã thu hồi',
                          }
                        : payload.previewContent || 'Tin nhắn đã thu hồi'
                    return { ...msg, replyPreview: updatedPreview }
                  }
                  return msg
                }),
              ),
            }
          } else if (Array.isArray(oldData)) {
            newData = oldData.map((msg: any) => {
              if (messageIds.includes(msg.id) && msg.replyPreview) {
                updated = true
                const updatedPreview =
                  typeof msg.replyPreview === 'object'
                    ? { ...msg.replyPreview, content: 'Tin nhắn đã thu hồi' }
                    : 'Tin nhắn đã thu hồi'
                return { ...msg, replyPreview: updatedPreview }
              }
              return msg
            })
          }

          return updated ? newData : oldData
        })
      }
    })

    // New: Handle reaction updates
    newSocket.on('message_reaction_updated', (message: Message) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(message.conversationId),
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
      console.log('👁️ messages_seen received:', { conversationId, readByUserId })

      const currentUserId = user?.id
      if (!currentUserId) return

      markMessagesAsSeen(conversationId, readByUserId)

      queryClient.setQueryData(queryKeys.conversations.messages(conversationId), (oldData: any) => {
        if (!oldData) return oldData

        const now = new Date().toISOString()

        if (oldData.pages) {
          return {
            ...oldData,
            pages: oldData.pages.map((page: any[]) =>
              page.map((msg: any) => {
                if (msg.senderId === currentUserId && msg.status !== 'READ') {
                  setMessageAsSeen(conversationId, msg.id)
                  return { ...msg, status: 'READ', seenAt: now }
                }
                return msg
              }),
            ),
          }
        }

        if (Array.isArray(oldData)) {
          return oldData.map((msg: any) => {
            if (msg.senderId === currentUserId && msg.status !== 'READ') {
              setMessageAsSeen(conversationId, msg.id)
              return { ...msg, status: 'READ', seenAt: now }
            }
            return msg
          })
        }

        return oldData
      })
    })

    newSocket.on('call:incoming', (_payload) => {})

    setSocket(newSocket)

    return () => {
      newSocket.removeAllListeners()
      newSocket.disconnect()
    }
  }, [isAuthenticated, user?.id, isLoading])

  return <SocketContext.Provider value={{ socket, isConnected }}>{children}</SocketContext.Provider>
}
