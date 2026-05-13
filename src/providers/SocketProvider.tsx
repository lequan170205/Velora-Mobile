import { useQueryClient } from '@tanstack/react-query'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'

import type { InfiniteData } from '@tanstack/react-query'

import { authApi } from '../api/auth.api'
import { queryKeys } from '../constants/queryKeys'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

import type { Conversation, Message } from '../types/conversation.types'
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
      auth: (cb) => {
        void authApi
          .getSocketToken()
          .then(({ accessToken }) => {
            cb({ token: accessToken })
          })
          .catch((error: unknown) => {
            console.warn('Unable to fetch socket token', error)
            cb({})
          })
      },
      forceNew: true,
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      path: '/socket.io',
    })

    newSocket.on('connect', () => {
      setIsConnected(true)
      console.log('🔌 Socket connected!')

      const queue = useChatStore.getState().offlineQueue
      queue.forEach((msg) => {
        const payload = {
          conversationId: msg.conversationId,
          content: msg.content,
          type: 'text',
          signalType: 0,
          clientMessageId: msg.id,
          ...(msg.replyToId ? { replyToId: msg.replyToId } : {}),
        }

        newSocket.emit('send_message', payload)
      })
    })

    newSocket.on('disconnect', () => {
      setIsConnected(false)
      useChatStore.setState({ typingUsers: {} })
      console.log('🔌 Socket disconnected!')
    })

    newSocket.on('connect_error', (error) => {
      setIsConnected(false)
      console.error('🔌 Socket connection error:', {
        message: error.message,
        url: process.env.EXPO_PUBLIC_WS_URL || 'http://localhost:3000',
        path: '/socket.io',
      })
    })

    // Debug: Log ALL events to see what's coming through
    newSocket.onAny((eventName, ...args) => {
      console.log('📡 Socket event:', eventName, args)
    })

    const upsertMessageQuery = (message: Message) => {
      queryClient.setQueryData<InfiniteData<Message[]> | Message[] | undefined>(
        queryKeys.conversations.messages(message.conversationId),
        (oldData) => {
          if (!oldData) {
            return {
              pages: [[message]],
              pageParams: [undefined],
            } as InfiniteData<Message[]>
          }

          const mergePage = (page: Message[]) => {
            const existingIndex = page.findIndex((item) => item.id === message.id)

            if (existingIndex === -1) {
              return [message, ...page]
            }

            return page.map((item, index) => (index === existingIndex ? message : item))
          }

          if ('pages' in oldData) {
            const exists = oldData.pages.some((page) => page.some((item) => item.id === message.id))

            if (exists) {
              return {
                ...oldData,
                pages: oldData.pages.map((page) =>
                  page.map((item) => (item.id === message.id ? message : item)),
                ),
              }
            }

            const [firstPage = [], ...restPages] = oldData.pages
            return {
              ...oldData,
              pages: [mergePage(firstPage), ...restPages],
            }
          }

          if (Array.isArray(oldData)) {
            return mergePage(oldData)
          }

          return oldData
        },
      )
    }

    const reconcileOptimisticMessage = (message: Message) => {
      const currentUser = useAuthStore.getState().user

      if (!currentUser?.id || message.senderId !== currentUser.id) {
        return
      }

      const store = useChatStore.getState()
      const pendingMsgs = store.optimisticMessages[message.conversationId] || []
      const tempMessages = pendingMsgs.filter((pending) => pending.id.startsWith('temp-'))
      const replyToId = message.replyToId ?? message.reply_to_id ?? null

      const exactMatch = tempMessages.find(
        (pending) =>
          pending.senderId === message.senderId &&
          pending.content === message.content &&
          pending.type === message.type &&
          (pending.replyToId ?? null) === replyToId,
      )

      const fallbackMatch = tempMessages.length === 1 ? tempMessages[0] : undefined
      const match = exactMatch ?? fallbackMatch

      if (match) {
        store.confirmMessage(match.id, message)
      }
    }

    newSocket.on('new_message', (message: Message) => {
      const currentUser = useAuthStore.getState().user
      const conversationId = message.conversationId
      const isOwnMessage = currentUser?.id === message.senderId
      const isPendingEcho =
        String((message as { status?: string }).status || '').toLowerCase() === 'sending'

      console.log('🚨 [DEBUG SOCKET] Nhận tin nhắn mới:', message)

      // 1. CẬP NHẬT UI TẠM THỜI (PURE FUNCTION)
      queryClient.setQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
        (oldData: Conversation[] | undefined) => {
          console.log(
            '[DEBUG] setQueryData called, oldData:',
            oldData
              ? `${Array.isArray(oldData) ? oldData.length + ' items' : 'not array'}`
              : 'null',
          )

          let conversations = oldData
          if (!oldData || !Array.isArray(oldData)) {
            console.log('[DEBUG] Creating new array, oldData was:', oldData)
            conversations = []
          }

          const existingConv = (conversations as Conversation[]).find(
            (c: Conversation) => c.id === conversationId,
          )
          console.log('[DEBUG] Existing conversation:', existingConv ? 'found' : 'not found')

          if (existingConv) {
            const updatedConversation = {
              ...existingConv,
              lastMessage: message.content ?? existingConv.lastMessage ?? null,
              lastMessageAt: message.createdAt || new Date().toISOString(),
            }

            const otherConversations = (conversations as Conversation[]).filter(
              (c: Conversation) => c.id !== conversationId,
            )
            console.log('[DEBUG] Returning updated conversation')
            return [updatedConversation, ...otherConversations]
          } else {
            const placeholderConversation = {
              id: conversationId,
              lastMessage: message.content ?? null,
              lastMessageAt: message.createdAt,
              participants: [],
              isGroup: false,
              creatorId: '',
              participantIds: [message.senderId],
              createdAt: message.createdAt,
              updatedAt: message.createdAt,
            } as Conversation

            console.log('[DEBUG] Returning new placeholder conversation')
            return [placeholderConversation, ...(conversations as Conversation[])]
          }
        },
      )

      setTimeout(() => {
        console.log('🔄 [DEBUG SOCKET] Refetching conversation list...')
        queryClient.refetchQueries({
          queryKey: queryKeys.conversations.all,
        })
      }, 100)

      if (!isOwnMessage || !isPendingEcho) {
        upsertMessageQuery(message)
      }

      if (!isOwnMessage) {
        queryClient.refetchQueries({
          queryKey: queryKeys.conversations.messages(conversationId),
        })
        return
      }

      if (isPendingEcho) {
        return
      }

      reconcileOptimisticMessage(message)
    })

    newSocket.on('conversation_updated', (conversation: Conversation) => {
      console.log('📬 [DEBUG] conversation_updated received:', conversation)

      if (!conversation?.id) return

      queryClient.setQueryData<InfiniteData<Conversation[]> | Conversation[] | undefined>(
        queryKeys.conversations.all,
        (oldData: InfiniteData<Conversation[]> | Conversation[] | undefined) => {
          if (!oldData || !Array.isArray(oldData)) return oldData

          const existingConv = oldData.find((c: Conversation) => c.id === conversation.id)

          if (existingConv) {
            const otherConversations = oldData.filter((c: Conversation) => c.id !== conversation.id)
            return [conversation, ...otherConversations]
          } else {
            return [conversation, ...oldData]
          }
        },
      )
    })

    newSocket.on('message_synced', (message: Message) => {
      upsertMessageQuery(message)

      if (user?.id && message.senderId === user.id) {
        const store = useChatStore.getState()
        if (message.clientMessageId) {
          store.confirmMessage(message.clientMessageId, message)
          store.dequeueOfflineMessage(message.clientMessageId)
        } else {
          reconcileOptimisticMessage(message)
        }
      } else {
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.messages(message.conversationId),
        })
      }
    })

    newSocket.on(
      'message_failed',
      (
        payload:
          | string
          | {
              conversationId?: string
              clientMessageId?: string
            },
      ) => {
        const store = useChatStore.getState()

        if (typeof payload === 'string') {
          Object.entries(store.optimisticMessages).forEach(([conversationId, messages]) => {
            if (messages.some((message) => message.id === payload)) {
              store.markMessageFailed(conversationId, payload)
              store.dequeueOfflineMessage(payload)
            }
          })
          return
        }

        if (payload.conversationId && payload.clientMessageId) {
          store.markMessageFailed(payload.conversationId, payload.clientMessageId)
          store.dequeueOfflineMessage(payload.clientMessageId)
        }
      },
    )

    newSocket.on('user_typing', ({ conversationId, userId, isTyping }) => {
      setTyping(conversationId, userId, isTyping)
    })

    newSocket.on('message:deleted', ({ conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(conversationId),
      })
    })

    newSocket.on(
      'message_recalled',
      ({ messageId, recalledAt }: { messageId: string; recalledAt?: string }) => {
        const now = recalledAt || new Date().toISOString()
        const allQueries = queryClient.getQueriesData<
          InfiniteData<Message[]> | Message[] | undefined
        >({ queryKey: ['conversations'] })

        for (const [queryKey] of allQueries) {
          if (!Array.isArray(queryKey) || queryKey.length !== 3 || queryKey[2] !== 'messages')
            continue

          queryClient.setQueryData(
            queryKey,
            (oldData: InfiniteData<Message[]> | Message[] | undefined) => {
              if (!oldData) return oldData

              let updated = false
              let newData = oldData

              if ('pages' in oldData) {
                newData = {
                  ...oldData,
                  pages: (oldData as InfiniteData<Message[]>).pages.map((page: Message[]) =>
                    page.map((msg: Message) => {
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
                newData = (oldData as Message[]).map((msg: Message) => {
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
            },
          )
        }
      },
    )

    newSocket.on(
      'reply_previews_updated',
      (payload: {
        updatedMessageIds?: string[]
        messageIds?: string[]
        previewContent?: string
      }) => {
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

        const allQueries = queryClient.getQueriesData<
          InfiniteData<Message[]> | Message[] | undefined
        >({ queryKey: ['conversations'] })

        for (const [queryKey] of allQueries) {
          if (!Array.isArray(queryKey) || queryKey.length !== 3 || queryKey[2] !== 'messages')
            continue

          queryClient.setQueryData(
            queryKey,
            (oldData: InfiniteData<Message[]> | Message[] | undefined) => {
              if (!oldData) return oldData

              let updated = false
              let newData = oldData

              if ('pages' in oldData) {
                newData = {
                  ...oldData,
                  pages: (oldData as InfiniteData<Message[]>).pages.map((page: Message[]) =>
                    page.map((msg: Message) => {
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
                newData = (oldData as Message[]).map((msg: Message) => {
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
            },
          )
        }
      },
    )

    // New: Handle reaction updates
    newSocket.on('message_reaction_updated', (message: Message) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(message.conversationId),
      })
    })

    newSocket.on('user:online', ({ userId }) => {
      setUserOnline(userId, true)
    })

    newSocket.on('user:offline', ({ userId }) => {
      setUserOnline(userId, false)
    })

    newSocket.on('messages_seen', ({ conversationId, readByUserId, at }) => {
      console.log('👁️ messages_seen received:', { conversationId, readByUserId, at })

      const currentUserId = user?.id
      if (!currentUserId) return

      markMessagesAsSeen(conversationId, readByUserId)

      queryClient.setQueryData(
        queryKeys.conversations.messages(conversationId),
        (oldData: InfiniteData<Message[]> | Message[] | undefined) => {
          if (!oldData) return oldData

          const seenAt = at || new Date().toISOString()

          if ('pages' in oldData) {
            return {
              ...oldData,
              pages: (oldData as InfiniteData<Message[]>).pages.map((page: Message[]) =>
                page.map((msg: Message) => {
                  if (msg.senderId === currentUserId && msg.status !== 'READ') {
                    const nextReadBy = Array.isArray(msg.readBy) ? msg.readBy : []
                    const alreadyMarked = nextReadBy.some((entry) => entry.userId === readByUserId)
                    setMessageAsSeen(conversationId, msg.id)
                    return {
                      ...msg,
                      status: 'READ',
                      seenAt,
                      readBy: alreadyMarked
                        ? nextReadBy
                        : [...nextReadBy, { userId: readByUserId, at: seenAt }],
                    }
                  }
                  return msg
                }),
              ),
            }
          }

          if (Array.isArray(oldData)) {
            return (oldData as Message[]).map((msg: Message) => {
              if (msg.senderId === currentUserId && msg.status !== 'READ') {
                const nextReadBy = Array.isArray(msg.readBy) ? msg.readBy : []
                const alreadyMarked = nextReadBy.some((entry) => entry.userId === readByUserId)
                setMessageAsSeen(conversationId, msg.id)
                return {
                  ...msg,
                  status: 'READ',
                  seenAt,
                  readBy: alreadyMarked
                    ? nextReadBy
                    : [...nextReadBy, { userId: readByUserId, at: seenAt }],
                }
              }
              return msg
            })
          }

          return oldData
        },
      )
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
