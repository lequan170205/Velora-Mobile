import { useQueryClient } from '@tanstack/react-query'
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'

import type { InfiniteData } from '@tanstack/react-query'

import { authApi } from '../api/auth.api'
import { queryKeys } from '../constants/queryKeys'
import { applyMediaProcessingUpdate, upsertRemoteMessage } from '../database/messageSync'
import {
  patchConversationMessagesInCache,
  patchMessagesAcrossConversationCaches,
} from '../lib/chatMessageCache'
import { isSameMessageIdentity, mergeMessageRecords } from '../lib/messageIdentity'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

import type { Conversation, Message } from '../types/conversation.types'
import type { Socket } from 'socket.io-client'

interface FileSystemCleanupModule {
  deleteAsync: (fileUri: string, options?: { idempotent?: boolean }) => Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const LegacyFileSystemCleanup = require('expo-file-system/legacy') as FileSystemCleanupModule

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
  requestPresence: (userIds: string[], options?: { conversationId?: string }) => void
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  requestPresence: () => {},
})

const mergeReplyPreview = (
  remoteReplyPreview?: Message['replyPreview'],
  localReplyPreview?: Message['replyPreview'],
): Message['replyPreview'] | undefined => {
  if (!remoteReplyPreview) {
    return localReplyPreview
  }

  if (!localReplyPreview) {
    return remoteReplyPreview
  }

  if (typeof remoteReplyPreview === 'string' || typeof localReplyPreview === 'string') {
    return remoteReplyPreview
  }

  if (remoteReplyPreview.thumbnailUri || !localReplyPreview.thumbnailUri) {
    return {
      ...remoteReplyPreview,
      ...(remoteReplyPreview.mediaWidth ? {} : { mediaWidth: localReplyPreview.mediaWidth }),
      ...(remoteReplyPreview.mediaHeight ? {} : { mediaHeight: localReplyPreview.mediaHeight }),
    }
  }

  return {
    ...remoteReplyPreview,
    thumbnailUri: localReplyPreview.thumbnailUri,
    ...(remoteReplyPreview.mediaWidth ? {} : { mediaWidth: localReplyPreview.mediaWidth }),
    ...(remoteReplyPreview.mediaHeight ? {} : { mediaHeight: localReplyPreview.mediaHeight }),
  }
}

export const useSocket = () => useContext(SocketContext)

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, isLoading } = useAuthStore()
  const queryClient = useQueryClient()
  const userId = user?.id ?? null

  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  const requestPresence = useCallback(
    (userIds: string[], options?: { conversationId?: string }) => {
      if (!socket?.connected) {
        return
      }

      const normalizedUserIds = Array.from(
        new Set(
          userIds
            .filter((userId) => typeof userId === 'string' && userId.trim().length > 0)
            .map((userId) => userId.trim())
            .filter((userId) => userId !== user?.id),
        ),
      )

      if (!normalizedUserIds.length) {
        return
      }

      socket.emit('check_presence', {
        userIds: normalizedUserIds,
        ...(options?.conversationId ? { conversationId: options.conversationId } : {}),
      })
    },
    [socket, user?.id],
  )

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!isAuthenticated || !userId) {
      setSocket((currentSocket) => {
        currentSocket?.disconnect()
        return null
      })
      setIsConnected(false)
      useChatStore.getState().clearOnlineUsers()
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
      useChatStore.getState().clearOnlineUsers()
      useChatStore.setState({ typingUsers: {} })
      joinedConversationIds.clear()
    })

    newSocket.on('connect_error', (error) => {
      setIsConnected(false)
      useChatStore.getState().clearOnlineUsers()
      console.error('🔌 Socket connection error:', {
        message: error.message,
        url: process.env.EXPO_PUBLIC_WS_URL || 'http://localhost:3000',
        path: '/socket.io',
      })
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

    const patchExistingMessageQuery = (message: Message) => {
      queryClient.setQueryData<InfiniteData<Message[]> | Message[] | undefined>(
        queryKeys.conversations.messages(message.conversationId),
        (oldData) => {
          if (!oldData) {
            return oldData
          }

          if ('pages' in oldData) {
            const exists = oldData.pages.some((page) =>
              page.some((item) => isSameMessageIdentity(item, message)),
            )

            if (!exists) {
              return oldData
            }

            return {
              ...oldData,
              pages: oldData.pages.map((page) =>
                page.map((item) =>
                  isSameMessageIdentity(item, message) ? mergeMessageRecords(item, message) : item,
                ),
              ),
            }
          }

          if (Array.isArray(oldData)) {
            const exists = oldData.some((item) => isSameMessageIdentity(item, message))

            if (!exists) {
              return oldData
            }

            return oldData.map((item) =>
              isSameMessageIdentity(item, message) ? mergeMessageRecords(item, message) : item,
            )
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
      const identityMatch = tempMessages.find((pending) => isSameMessageIdentity(pending, message))
      const replyToId = message.replyToId ?? message.reply_to_id ?? null

      const exactMatch = tempMessages.find(
        (pending) =>
          pending.senderId === message.senderId &&
          pending.content === message.content &&
          pending.type === message.type &&
          (pending.replyToId ?? null) === replyToId,
      )

      const fallbackMatch = tempMessages.length === 1 ? tempMessages[0] : undefined
      const match = identityMatch ?? exactMatch ?? fallbackMatch

      if (match) {
        store.confirmMessage(match.id, message)
      }
    }

    const mergeMessageWithOptimisticReplyPreview = (message: Message) => {
      const currentUser = useAuthStore.getState().user

      if (!currentUser?.id || message.senderId !== currentUser.id) {
        return message
      }

      const store = useChatStore.getState()
      const pendingMsgs = store.optimisticMessages[message.conversationId] || []
      const tempMessages = pendingMsgs.filter((pending) => pending.id.startsWith('temp-'))
      const replyToId = message.replyToId ?? message.reply_to_id ?? null
      const identityMatch = tempMessages.find((pending) => isSameMessageIdentity(pending, message))
      const exactMatch = tempMessages.find(
        (pending) =>
          pending.senderId === message.senderId &&
          pending.content === message.content &&
          pending.type === message.type &&
          (pending.replyToId ?? null) === replyToId,
      )
      const fallbackMatch = tempMessages.length === 1 ? tempMessages[0] : undefined
      const match = identityMatch ?? exactMatch ?? fallbackMatch
      const replyPreview = mergeReplyPreview(message.replyPreview, match?.replyPreview)

      return replyPreview ? { ...message, replyPreview } : message
    }

    const persistSocketMessage = (
      message: Message,
      options?: {
        incrementUnread?: boolean
      },
    ) => {
      const currentUser = useAuthStore.getState().user

      void upsertRemoteMessage({
        currentUser: currentUser ?? null,
        message,
        ...(options?.incrementUnread !== undefined
          ? { incrementUnread: options.incrementUnread }
          : {}),
      }).catch((error) => {
        console.warn('[Socket] Failed to persist socket message locally', error)
      })
    }

    const patchMessageMediaFromProcessingEvent = (payload: {
      conversationId?: string
      fileKey?: string
      messageIds?: string[]
      media?: Message['media']
    }) => {
      if (!payload.media) {
        return
      }

      const messageIds = new Set(
        (payload.messageIds ?? []).filter(
          (messageId): messageId is string => typeof messageId === 'string' && messageId.length > 0,
        ),
      )
      const fileKey =
        typeof payload.fileKey === 'string' && payload.fileKey.length > 0 ? payload.fileKey : null

      if (messageIds.size === 0 && !fileKey) {
        return
      }

      void applyMediaProcessingUpdate({
        media: payload.media,
        ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
        ...(fileKey ? { fileKey } : {}),
        ...(messageIds.size > 0 ? { messageIds: Array.from(messageIds) } : {}),
      }).catch((error) => {
        console.error('[Socket] Failed to persist media processing update locally', error)
      })

      const updateMessage = (message: Message) => {
        const matchesMessageId =
          messageIds.has(message.id) || (message._id ? messageIds.has(message._id) : false)
        const matchesFileKey = Boolean(fileKey && message.media?.fileKey === fileKey)

        if (!matchesMessageId && !matchesFileKey) {
          return message
        }

        const localPosterUri = message.media?.localPosterUri
        const localFileUri = message.media?.localFileUri
        const uploadStage = message.media?.uploadStage
        const uploadStartedAt = message.media?.uploadStartedAt
        const lastProgressAt = message.media?.lastProgressAt
        const failureReason = message.media?.failureReason
        const {
          localPosterUri: _localPosterUri,
          localFileUri: _localFileUri,
          uploadStage: _uploadStage,
          uploadStartedAt: _uploadStartedAt,
          lastProgressAt: _lastProgressAt,
          failureReason: _failureReason,
          ...restMedia
        } = message.media ?? {}

        if (localPosterUri && payload.media?.thumbnailUrl) {
          void LegacyFileSystemCleanup.deleteAsync(localPosterUri, { idempotent: true }).catch(
            () => undefined,
          )
        }

        return mergeMessageRecords(message, {
          ...message,
          media: {
            ...restMedia,
            ...payload.media,
            ...(localPosterUri && !payload.media?.thumbnailUrl ? { localPosterUri } : {}),
            ...(localFileUri && !payload.media?.fileUrl ? { localFileUri } : {}),
            ...(payload.media?.status === 'failed' && failureReason ? { failureReason } : {}),
            ...(payload.media?.status === undefined && uploadStage ? { uploadStage } : {}),
            ...(payload.media?.status === undefined && uploadStartedAt ? { uploadStartedAt } : {}),
            ...(payload.media?.status === undefined && lastProgressAt ? { lastProgressAt } : {}),
          },
        })
      }

      if (payload.conversationId) {
        patchConversationMessagesInCache(queryClient, payload.conversationId, updateMessage)
        return
      }

      patchMessagesAcrossConversationCaches(queryClient, updateMessage)
    }

    newSocket.on('new_message', (incomingMessage: Message) => {
      const message = mergeMessageWithOptimisticReplyPreview(incomingMessage)
      const currentUser = useAuthStore.getState().user
      const conversationId = message.conversationId
      const isOwnMessage = currentUser?.id === message.senderId
      const isPendingEcho =
        String((message as { status?: string }).status || '').toLowerCase() === 'sending'

      persistSocketMessage(message, {
        incrementUnread: !isOwnMessage,
      })

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

    newSocket.on('message_synced', (incomingMessage: Message) => {
      const message = mergeMessageWithOptimisticReplyPreview(incomingMessage)
      persistSocketMessage(message)

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

    newSocket.on(
      'media_processing_completed',
      (payload: {
        conversationId?: string
        fileKey?: string
        messageIds?: string[]
        media?: Message['media']
      }) => {
        patchMessageMediaFromProcessingEvent(payload)
      },
    )

    newSocket.on(
      'media_processing_failed',
      (payload: {
        conversationId?: string
        fileKey?: string
        messageIds?: string[]
        media?: Message['media']
      }) => {
        patchMessageMediaFromProcessingEvent(payload)
      },
    )

    newSocket.on('user_typing', ({ conversationId, userId, isTyping }) => {
      useChatStore.getState().setTyping(conversationId, userId, isTyping)
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

    newSocket.on('message_reaction_updated', (message: Message) => {
      if (!message?.conversationId) {
        return
      }

      persistSocketMessage(message)
      patchExistingMessageQuery(message)
    })

    newSocket.on('user:online', ({ userId, lastSeenAt }) => {
      useChatStore.getState().setUserOnline(userId, true, lastSeenAt)
    })

    newSocket.on('user:offline', ({ userId, lastSeenAt }) => {
      useChatStore.getState().setUserOnline(userId, false, lastSeenAt)
    })

    newSocket.on('presence_update', ({ userId, isOnline, lastSeenAt }) => {
      if (!userId) {
        return
      }

      useChatStore.getState().setUserOnline(userId, Boolean(isOnline), lastSeenAt)
    })

    newSocket.on('messages_seen', ({ conversationId, readByUserId, at }) => {
      const currentUserId = userId
      if (!currentUserId) return

      useChatStore.getState().markMessagesAsSeen(conversationId, readByUserId)

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
                    useChatStore.getState().setMessageAsSeen(conversationId, msg.id)
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
                useChatStore.getState().setMessageAsSeen(conversationId, msg.id)
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
      unsubscribeQueryCache()
      newSocket.removeAllListeners()
      newSocket.disconnect()
    }
  }, [isAuthenticated, isLoading, queryClient, userId])

  return (
    <SocketContext.Provider value={{ socket, isConnected, requestPresence }}>
      {children}
    </SocketContext.Provider>
  )
}
