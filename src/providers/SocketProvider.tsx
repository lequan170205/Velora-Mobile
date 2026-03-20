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

        // Nếu chưa có data, tạo mảng mới
        let conversations = oldData
        if (!oldData || !Array.isArray(oldData)) {
          console.log('[DEBUG] Creating new array, oldData was:', oldData)
          conversations = []
        }

        const existingConv = conversations.find((c: any) => c.id === conversationId)
        console.log('[DEBUG] Existing conversation:', existingConv ? 'found' : 'not found')

        if (existingConv) {
          // Conversation đã tồn tại - cập nhật bình thường
          const updatedConversation = {
            ...existingConv,
            lastMessage: message.content || existingConv.lastMessage,
            lastMessageAt: message.createdAt || new Date().toISOString(),
          }

          const otherConversations = conversations.filter((c: any) => c.id !== conversationId)
          console.log('[DEBUG] Returning updated conversation')
          return [updatedConversation, ...otherConversations]
        } else {
          // Conversation CHƯA tồn tại trong cache - TẠO PLACEHOLDER
          // Đây là tin nhắn đầu tiên từ người lạ gửi cho mình
          const placeholderConversation = {
            id: conversationId,
            lastMessage: message.content,
            lastMessageAt: message.createdAt,
            participants: [], // Sẽ được API load sau
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

      // 2. GỌI API NGẦM - Để "đắp thịt" vào placeholder (lấy avatar, name, participants)
      // Always trigger refetch after optimistic update
      // Use setTimeout to ensure backend has saved to DB
      setTimeout(() => {
        console.log('🔄 [DEBUG SOCKET] Refetching conversation list...')
        queryClient.refetchQueries({
          queryKey: queryKeys.conversations.all,
        })
      }, 100)

      // 3. CẬP NHẬT CACHE MESSAGE LIST
      if (currentUser?.id && message.senderId !== currentUser.id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.messages(conversationId),
        })
      }

      // 4. CONFIRM MESSAGE (Nếu là mình gửi)
      if (currentUser?.id && message.senderId === currentUser.id) {
        const store = useChatStore.getState()
        const pendingMsgs = store.optimisticMessages[conversationId] || []
        const match = pendingMsgs.find((m) => m.content === message.content)

        if (match) {
          store.confirmMessage(match.id, message)
        }
      }
    })

    // Handle conversation_updated from backend - this is the main event for new messages
    newSocket.on('conversation_updated', (conversation: any) => {
      console.log('📬 [DEBUG] conversation_updated received:', conversation)

      if (!conversation?.id) return

      // Update conversations cache with the new conversation data
      queryClient.setQueryData(queryKeys.conversations.all, (oldData: any) => {
        if (!oldData || !Array.isArray(oldData)) return oldData

        const existingConv = oldData.find((c: any) => c.id === conversation.id)

        if (existingConv) {
          // Update existing conversation
          const otherConversations = oldData.filter((c: any) => c.id !== conversation.id)
          return [conversation, ...otherConversations]
        } else {
          // Add new conversation at the top
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

    // Handle message recall - cập nhật cache trực tiếp thay vì invalidate
    // Backend chỉ gửi messageId, ta cần tìm conversationId từ message trong cache
    newSocket.on('message_recalled', ({ messageId }: { messageId: string }) => {
      const now = new Date().toISOString()

      // Tìm conversationId từ tất cả các conversation messages đã cache
      const allQueries = queryClient.getQueriesData<any>({ queryKey: ['conversations'] })

      for (const [queryKey, data] of allQueries) {
        if (!data) continue
        // Chỉ xử lý query messages: ['conversations', id, 'messages']
        if (!Array.isArray(queryKey) || queryKey.length !== 3 || queryKey[2] !== 'messages')
          continue

        const conversationId = queryKey[1]
        if (!conversationId) continue

        // Kiểm tra và cập nhật nếu tìm thấy message
        let updated = false
        let newData = data

        if (data.pages) {
          newData = {
            ...data,
            pages: data.pages.map((page: any[]) =>
              page.map((msg: any) => {
                if (msg.id === messageId) {
                  updated = true
                  return {
                    ...msg,
                    isRecalled: true,
                    recalledAt: now,
                    is_recalled: true,
                    recalled_at: now,
                  }
                }
                return msg
              }),
            ),
          }
        } else if (Array.isArray(data)) {
          newData = data.map((msg: any) => {
            if (msg.id === messageId) {
              updated = true
              return {
                ...msg,
                isRecalled: true,
                recalledAt: now,
                is_recalled: true,
                recalled_at: now,
              }
            }
            return msg
          })
        }

        if (updated) {
          // Tạo deep copy để đảm bảo reference thay đổi
          queryClient.setQueryData(queryKey, JSON.parse(JSON.stringify(newData)))
        }
      }
    })

    // Handle reply_previews_updated - cập nhật reply preview khi tin nhắn gốc bị thu hồi
    newSocket.on('reply_previews_updated', (payload: any) => {
      // Lấy đúng key từ backend (updatedMessageIds) và thêm fallback [] để chống crash
      const messageIds = payload?.updatedMessageIds || payload?.messageIds || []

      if (!messageIds.length) return // Nếu mảng rỗng thì không cần chạy vòng lặp làm gì

      console.log('📝 reply_previews_updated received:', messageIds)

      const allQueries = queryClient.getQueriesData<any>({ queryKey: ['conversations'] })

      for (const [queryKey, oldData] of allQueries) {
        if (!oldData) continue
        // Chỉ xử lý query messages: ['conversations', id, 'messages']
        if (!Array.isArray(queryKey) || queryKey.length !== 3 || queryKey[2] !== 'messages')
          continue

        let newData = oldData
        let updated = false

        if (oldData.pages) {
          newData = {
            ...oldData,
            pages: oldData.pages.map((page: any[]) =>
              page.map((msg: any) => {
                if (messageIds.includes(msg.id) && msg.replyPreview) {
                  updated = true
                  // Cập nhật replyPreview.content
                  const updatedPreview =
                    typeof msg.replyPreview === 'object'
                      ? { ...msg.replyPreview, content: 'Tin nhắn đã thu hồi' }
                      : 'Tin nhắn đã thu hồi'
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

        if (updated) {
          // Chỉ cần spread operator tạo reference mới, không cần deep clone
          queryClient.setQueryData(queryKey, newData)
        }
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

      // Cập nhật optimisticMessages (tin nhắn tạm)
      markMessagesAsSeen(conversationId, readByUserId)

      // Lưu vào Zustand store để không bị overwrite khi fetch lại
      // Cập nhật tin nhắn mà MÌNH gửi, khi người khác (readByUserId) đã xem
      queryClient.setQueryData(queryKeys.conversations.messages(conversationId), (oldData: any) => {
        if (!oldData) return oldData

        const now = new Date().toISOString()

        if (oldData.pages) {
          return {
            ...oldData,
            pages: oldData.pages.map((page: any[]) =>
              page.map((msg: any) => {
                // Chỉ cập nhật tin nhắn mình gửi, khi người khác đã xem
                if (msg.senderId === currentUserId && msg.status !== 'READ') {
                  // Lưu vào Zustand store để giữ trạng thái READ
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
              // Lưu vào Zustand store để giữ trạng thái READ
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
