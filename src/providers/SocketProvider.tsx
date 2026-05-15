import { useQueryClient } from '@tanstack/react-query'
import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

import type { InfiniteData } from '@tanstack/react-query'

import { authApi } from '../api/auth.api'
import { queryKeys } from '../constants/queryKeys'
import { isSameMessageIdentity, mergeMessageRecords } from '../lib/messageIdentity'
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
  const userId = user?.id ?? null

  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!isAuthenticated || !userId) {
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
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
          .catch(() => {
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

    const joinedConversationIds = new Set<string>()

    const joinConversationRooms = (conversationIds: string[]) => {
      if (!newSocket.connected) {
        return
      }

      conversationIds.forEach((conversationId) => {
        if (!conversationId || joinedConversationIds.has(conversationId)) {
          return
        }

        newSocket.emit('join_conversation', conversationId)
        joinedConversationIds.add(conversationId)
      })
    }

    newSocket.on('connect', () => {
      setIsConnected(true)

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

      const cachedConversations = queryClient.getQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
      )
      joinConversationRooms(
        Array.isArray(cachedConversations)
          ? cachedConversations.map((conversation) => conversation.id)
          : [],
      )
    })

    newSocket.on('disconnect', () => {
      setIsConnected(false)
      useChatStore.setState({ typingUsers: {} })
      joinedConversationIds.clear()
    })

    newSocket.on('connect_error', () => {
      setIsConnected(false)
    })

    const unsubscribeQueryCache = queryClient.getQueryCache().subscribe((event) => {
      const query = event?.query
      if (!query) {
        return
      }

      if (
        query.queryKey.length !== queryKeys.conversations.all.length ||
        query.queryKey[0] !== queryKeys.conversations.all[0]
      ) {
        return
      }

      const data = query.state.data
      if (!Array.isArray(data)) {
        return
      }

      joinConversationRooms(data.map((conversation) => conversation.id))
    })

    const upsertMessageQuery = (message: Message) => {
      const queryKey = queryKeys.conversations.messages(message.conversationId)
      const hasExistingMessageQuery = queryClient.getQueryState(queryKey) !== undefined

      queryClient.setQueryData<InfiniteData<Message[]> | Message[] | undefined>(
        queryKey,
        (oldData) => {
          if (!oldData) {
            if (!hasExistingMessageQuery) {
              return oldData
            }

            return {
              pages: [[message]],
              pageParams: [undefined],
            } as InfiniteData<Message[]>
          }

          const mergePage = (page: Message[]) => {
            const existingIndex = page.findIndex((item) => isSameMessageIdentity(item, message))

            if (existingIndex === -1) {
              return [message, ...page]
            }

            return page.map((item, index) =>
              index === existingIndex ? mergeMessageRecords(item, message) : item,
            )
          }

          if ('pages' in oldData) {
            const exists = oldData.pages.some((page) =>
              page.some((item) => isSameMessageIdentity(item, message)),
            )

            if (exists) {
              return {
                ...oldData,
                pages: oldData.pages.map((page) =>
                  page.map((item) =>
                    isSameMessageIdentity(item, message)
                      ? mergeMessageRecords(item, message)
                      : item,
                  ),
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

    const getConversationActivityAt = (conversation: Partial<Conversation>) => {
      const value = conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt
      return value ? new Date(value).getTime() : 0
    }

    const sortConversations = (conversations: Conversation[]) => {
      return [...conversations].sort(
        (left, right) => getConversationActivityAt(right) - getConversationActivityAt(left),
      )
    }

    const upsertConversationSummary = (
      patch: Partial<Conversation> & Pick<Conversation, 'id'>,
      options?: { allowPlaceholder?: boolean; incrementUnread?: boolean },
    ) => {
      queryClient.setQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
        (oldData: Conversation[] | undefined) => {
          if (!Array.isArray(oldData)) {
            return oldData
          }

          const existingIndex = oldData.findIndex((conversation) => conversation.id === patch.id)
          const existingConversation =
            existingIndex >= 0
              ? oldData[existingIndex]
              : options?.allowPlaceholder
                ? null
                : undefined

          if (existingConversation === undefined) {
            return oldData
          }

          const baseConversation =
            existingConversation ??
            ({
              id: patch.id,
              creatorId: '',
              participantIds: patch.participantIds ?? [],
              createdAt: patch.createdAt ?? new Date().toISOString(),
              updatedAt: patch.updatedAt ?? patch.createdAt ?? new Date().toISOString(),
              isGroup: patch.isGroup ?? false,
              ...(patch.participants !== undefined ? { participants: patch.participants } : {}),
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.picture !== undefined ? { picture: patch.picture } : {}),
              ...(patch.unreadCount !== undefined ? { unreadCount: patch.unreadCount } : {}),
            } as Conversation)

          const mergedConversation: Conversation = {
            ...baseConversation,
            id: patch.id,
            creatorId: patch.creatorId ?? baseConversation.creatorId,
            participantIds: patch.participantIds ?? baseConversation.participantIds,
            createdAt: patch.createdAt ?? baseConversation.createdAt,
            updatedAt: patch.updatedAt ?? baseConversation.updatedAt,
            isGroup: patch.isGroup ?? baseConversation.isGroup,
            lastMessage: patch.lastMessage ?? baseConversation.lastMessage ?? null,
            lastMessageAt: patch.lastMessageAt ?? baseConversation.lastMessageAt ?? null,
            ...(baseConversation.participants !== undefined
              ? { participants: baseConversation.participants }
              : {}),
            ...(patch.participants !== undefined ? { participants: patch.participants } : {}),
            ...(baseConversation.name !== undefined ? { name: baseConversation.name } : {}),
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(baseConversation.picture !== undefined
              ? { picture: baseConversation.picture }
              : {}),
            ...(patch.picture !== undefined ? { picture: patch.picture } : {}),
            ...(baseConversation.unreadCount !== undefined
              ? { unreadCount: baseConversation.unreadCount }
              : {}),
            ...(patch.unreadCount !== undefined ? { unreadCount: patch.unreadCount } : {}),
          }

          const shouldIncrementUnread =
            options?.incrementUnread &&
            patch.unreadCount === undefined &&
            (!existingConversation ||
              existingConversation.lastMessage !== mergedConversation.lastMessage ||
              existingConversation.lastMessageAt !== mergedConversation.lastMessageAt)

          if (shouldIncrementUnread) {
            mergedConversation.unreadCount = (existingConversation?.unreadCount ?? 0) + 1
          }

          const hasSummaryChanged =
            !existingConversation ||
            existingConversation.lastMessage !== mergedConversation.lastMessage ||
            existingConversation.lastMessageAt !== mergedConversation.lastMessageAt ||
            existingConversation.updatedAt !== mergedConversation.updatedAt ||
            existingConversation.unreadCount !== mergedConversation.unreadCount ||
            existingConversation.name !== mergedConversation.name ||
            existingConversation.picture !== mergedConversation.picture

          if (!hasSummaryChanged && existingIndex === 0) {
            return oldData
          }

          const nextConversations =
            existingIndex >= 0
              ? oldData.map((conversation, index) =>
                  index === existingIndex ? mergedConversation : conversation,
                )
              : [mergedConversation, ...oldData]

          const sortedConversations = sortConversations(nextConversations)
          const isSameOrder =
            sortedConversations.length === oldData.length &&
            sortedConversations.every(
              (conversation, index) => conversation.id === oldData[index]?.id,
            )

          return !hasSummaryChanged && isSameOrder ? oldData : sortedConversations
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

      upsertConversationSummary(
        {
          id: conversationId,
          lastMessage: message.content ?? null,
          lastMessageAt: message.createdAt || new Date().toISOString(),
          updatedAt: message.updatedAt || message.createdAt || new Date().toISOString(),
          participantIds: [message.senderId],
          createdAt: message.createdAt,
        },
        { allowPlaceholder: true, incrementUnread: !isOwnMessage },
      )

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
      if (!conversation?.id) return
      upsertConversationSummary(conversation, { allowPlaceholder: true })
    })

    newSocket.on('message_synced', (message: Message) => {
      upsertConversationSummary(
        {
          id: message.conversationId,
          lastMessage: message.content ?? null,
          lastMessageAt: message.createdAt || new Date().toISOString(),
          updatedAt: message.updatedAt || message.createdAt || new Date().toISOString(),
          participantIds: [message.senderId],
          createdAt: message.createdAt,
        },
        { allowPlaceholder: true },
      )
      upsertMessageQuery(message)

      if (userId && message.senderId === userId) {
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
      const currentUserId = userId
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

    socketRef.current = newSocket
    setSocket(newSocket)

    return () => {
      unsubscribeQueryCache()
      newSocket.removeAllListeners()
      newSocket.disconnect()

      if (socketRef.current === newSocket) {
        socketRef.current = null
      }
    }
  }, [
    isAuthenticated,
    isLoading,
    markMessagesAsSeen,
    queryClient,
    setMessageAsSeen,
    setTyping,
    setUserOnline,
    userId,
  ])

  return <SocketContext.Provider value={{ socket, isConnected }}>{children}</SocketContext.Provider>
}
