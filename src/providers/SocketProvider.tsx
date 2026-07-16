import { useQueryClient } from '@tanstack/react-query'
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

import type { InfiniteData } from '@tanstack/react-query'

import { authApi } from '../api/auth.api'
import { queryKeys } from '../constants/queryKeys'
import { getPendingTextMessagesForRetry } from '../database/messageRepository'
import {
  applyReplyPreviewUpdate,
  applyMediaProcessingUpdate,
  applyReadReceiptUpdate,
  markMessageRecalled,
  upsertRemoteMessage,
} from '../database/messageSync'
import {
  patchConversationMessageCollectionsInCache,
  patchExistingMessageAcrossConversationCaches,
  patchMessagesAcrossConversationCaches,
} from '../lib/chatMessageCache'
import {
  getMessageAnchorIdentityKey,
  isMessageBeyondOptimisticReadFrontier,
  isSameMessageIdentity,
  mergeMessageRecords,
} from '../lib/messageIdentity'
import { normalizeMessageMetadata } from '../lib/messageMetadata'
import {
  buildReplyPreviewFromMessage,
  mergeReplyPreview,
  toTextOnlyReplyPreview,
} from '../lib/replyPreview'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

import { useNetworkStatus } from './NetworkProvider'

import type { Conversation, Message } from '../types/conversation.types'
import type { Socket } from 'socket.io-client'

interface FileSystemCleanupModule {
  deleteAsync: (fileUri: string, options?: { idempotent?: boolean }) => Promise<void>
}

type CachedMessagesCollection =
  | InfiniteData<Message[]>
  | Message[]
  | {
      messages: Message[]
    }
  | undefined

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

const OFFLINE_MESSAGE_ACK_TIMEOUT_MS = 15000
const BOT_USER_ID = process.env.EXPO_PUBLIC_BOT_USER_ID
const BOT_FALLBACK_EMAIL = 'bot@system.local'
const BOT_STREAM_TEMP_ID_PREFIX = 'temp-bot-stream:'
const RECALLED_MESSAGE_CONTENT = 'Tin nhắn đã thu hồi'

const redactRecalledMessage = (message: Message, recalledAt: string): Message => {
  const {
    media: _media,
    metadata: _metadata,
    replyPreview: _replyPreview,
    reply_preview: _replyPreviewSnakeCase,
    ...safeMessage
  } = message

  return {
    ...safeMessage,
    isRecalled: true,
    recalledAt,
    is_recalled: true,
    recalled_at: recalledAt,
    content: RECALLED_MESSAGE_CONTENT,
    reactions: {},
  }
}

type NormalizedBotTokenPayload = {
  content?: string
  conversationId: string
  senderId?: string
  tokenChunk?: string
}

const getTrimmedString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

const getStreamingText = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : null

const isBotParticipant = (
  participant:
    | {
        email?: string
        fullName?: string
        id?: string
        name?: string
      }
    | undefined,
) => {
  if (!participant) {
    return false
  }

  const normalizedEmail = participant.email?.trim().toLowerCase()
  const normalizedName = (participant.name ?? participant.fullName)?.trim().toLowerCase()

  return (
    Boolean(BOT_USER_ID && participant.id === BOT_USER_ID) ||
    normalizedEmail === BOT_FALLBACK_EMAIL ||
    normalizedName === 'system_bot' ||
    normalizedName === 'velora bot'
  )
}

const conversationIncludesBot = (conversation?: Conversation | null) => {
  if (!conversation) {
    return false
  }

  return (
    Boolean(BOT_USER_ID && conversation.participantIds.includes(BOT_USER_ID)) ||
    Boolean(conversation.participants?.some(isBotParticipant))
  )
}

const getBotStreamTempId = (conversationId: string) =>
  `${BOT_STREAM_TEMP_ID_PREFIX}${conversationId}`

const normalizeBotTokenPayload = (value: unknown): NormalizedBotTokenPayload | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const payload = value as Record<string, unknown>
  const conversationId = getTrimmedString(
    payload.conversationId ?? payload.roomId ?? payload.chatId,
  )
  const content = getStreamingText(payload.content ?? payload.text)
  const tokenChunk = getStreamingText(payload.token ?? payload.delta ?? payload.chunk)
  const senderId = getTrimmedString(payload.senderId)

  if (!conversationId || (!content && !tokenChunk)) {
    return null
  }

  return {
    conversationId,
    ...(content ? { content } : {}),
    ...(senderId ? { senderId } : {}),
    ...(tokenChunk ? { tokenChunk } : {}),
  }
}

const clearStreamingBotMessages = (conversationId?: string) => {
  useChatStore.setState((state) => {
    let didChange = false

    const nextOptimisticMessages = Object.fromEntries(
      Object.entries(state.optimisticMessages).flatMap(([currentConversationId, messages]) => {
        if (conversationId && currentConversationId !== conversationId) {
          return [[currentConversationId, messages] as const]
        }

        const nextMessages = messages.filter(
          (message) => !message.id.startsWith(BOT_STREAM_TEMP_ID_PREFIX),
        )

        if (nextMessages.length !== messages.length) {
          didChange = true
        }

        return nextMessages.length > 0 ? [[currentConversationId, nextMessages] as const] : []
      }),
    )

    if (!didChange) {
      return state
    }

    return {
      optimisticMessages: nextOptimisticMessages,
    }
  })
}

const isMessageAtOrBeforeReadFrontier = ({
  frontierCreatedAt,
  frontierMessageId,
  message,
}: {
  frontierCreatedAt: string
  frontierMessageId: string | undefined
  message: Message
}) => {
  const frontierTimestamp = Date.parse(frontierCreatedAt)
  const messageTimestamp = Date.parse(message.createdAt)

  if (!Number.isFinite(frontierTimestamp) || !Number.isFinite(messageTimestamp)) {
    return !frontierMessageId
  }

  if (messageTimestamp < frontierTimestamp) {
    return true
  }

  if (messageTimestamp > frontierTimestamp) {
    return false
  }

  if (!frontierMessageId) {
    return true
  }

  const messageId = message.id || message._id || message.clientMessageId || ''
  return messageId.localeCompare(frontierMessageId) <= 0
}

const flattenCachedMessagesCollection = (collection: CachedMessagesCollection): Message[] => {
  if (!collection) {
    return []
  }

  if (Array.isArray(collection)) {
    return collection
  }

  if ('pages' in collection) {
    return collection.pages.flat()
  }

  return 'messages' in collection ? collection.messages : []
}

const matchesMessageIdentityKey = (message: Message, identityKey: string) => {
  return (
    message.id === identityKey ||
    message._id === identityKey ||
    message.clientMessageId === identityKey
  )
}

type QueuedOfflineMessage = ReturnType<typeof useChatStore.getState>['offlineQueue'][number]

const buildOfflineMessagePayload = (message: QueuedOfflineMessage) => ({
  conversationId: message.conversationId,
  content: message.content,
  type: 'text',
  signalType: 0,
  clientMessageId: message.id,
  ...(message.replyToId ? { replyToId: message.replyToId } : {}),
})

export const useSocket = () => useContext(SocketContext)

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, isLoading } = useAuthStore()
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const queryClient = useQueryClient()
  const userId = user?.id ?? null

  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const lastConnectErrorMessageRef = useRef<string | null>(null)
  const flushingOfflineMessageIdsRef = useRef<Set<string>>(new Set())
  const flushingOfflineConversationIdsRef = useRef<Set<string>>(new Set())
  const offlineMessageAckTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const serverDisconnectReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushOfflineQueueRef = useRef<(targetSocket: Socket | null) => void>(() => {})

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

  const resolveReadFrontierFromCache = useCallback(
    ({
      conversationId,
      frontierCreatedAt,
      messageId,
      seenAt,
    }: {
      conversationId: string
      frontierCreatedAt?: string
      messageId?: string
      seenAt: string
    }) => {
      if (!messageId) {
        return {
          anchorIdentityKey: null,
          createdAt: frontierCreatedAt ?? seenAt,
        }
      }

      const latestMessages = flattenCachedMessagesCollection(
        queryClient.getQueryData<CachedMessagesCollection>(
          queryKeys.conversations.messages(conversationId),
        ),
      )
      const anchorQueries = queryClient.getQueriesData<CachedMessagesCollection>({
        queryKey: queryKeys.conversations.messagesAroundRoot(conversationId),
      })
      const anchoredMessages = anchorQueries.flatMap(([, queryData]) =>
        flattenCachedMessagesCollection(queryData),
      )
      const optimisticMessages = useChatStore.getState().optimisticMessages[conversationId] ?? []
      const frontierMessage =
        [...latestMessages, ...anchoredMessages, ...optimisticMessages].find((message) =>
          matchesMessageIdentityKey(message, messageId),
        ) ?? null

      return {
        anchorIdentityKey: getMessageAnchorIdentityKey(frontierMessage),
        createdAt: frontierCreatedAt ?? frontierMessage?.createdAt ?? null,
      }
    },
    [queryClient],
  )

  const clearOfflineMessageAckTimeout = useCallback((messageId: string) => {
    const timeoutId = offlineMessageAckTimeoutsRef.current.get(messageId)
    if (!timeoutId) {
      return
    }

    clearTimeout(timeoutId)
    offlineMessageAckTimeoutsRef.current.delete(messageId)
  }, [])

  const clearAllOfflineMessageAckTimeouts = useCallback(() => {
    offlineMessageAckTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId))
    offlineMessageAckTimeoutsRef.current.clear()
  }, [])

  const recoverPendingTextMessagesToOfflineQueue = useCallback(async () => {
    const currentUserId = useAuthStore.getState().user?.id
    if (!currentUserId) {
      return
    }

    const pendingMessages = await getPendingTextMessagesForRetry({ currentUserId })
    const store = useChatStore.getState()

    pendingMessages.forEach((message) => {
      store.enqueueOfflineMessage(message)
    })
  }, [])

  const flushOfflineQueue = useCallback(
    (targetSocket: Socket | null) => {
      if (!targetSocket?.connected) {
        return
      }

      const queue = useChatStore.getState().offlineQueue
      const nextMessagesByConversation = new Map<string, QueuedOfflineMessage>()

      queue.forEach((message) => {
        if (
          !message.conversationId ||
          flushingOfflineMessageIdsRef.current.has(message.id) ||
          flushingOfflineConversationIdsRef.current.has(message.conversationId) ||
          nextMessagesByConversation.has(message.conversationId)
        ) {
          return
        }

        nextMessagesByConversation.set(message.conversationId, message)
      })

      const pendingMessages = Array.from(nextMessagesByConversation.values())

      if (pendingMessages.length === 0) {
        return
      }

      Array.from(new Set(pendingMessages.map((message) => message.conversationId))).forEach(
        (conversationId) => {
          if (conversationId) {
            targetSocket.emit('join_conversation', conversationId)
          }
        },
      )

      pendingMessages.forEach((message) => {
        flushingOfflineMessageIdsRef.current.add(message.id)
        flushingOfflineConversationIdsRef.current.add(message.conversationId)
        clearOfflineMessageAckTimeout(message.id)
        offlineMessageAckTimeoutsRef.current.set(
          message.id,
          setTimeout(() => {
            offlineMessageAckTimeoutsRef.current.delete(message.id)
            flushingOfflineMessageIdsRef.current.delete(message.id)
            flushingOfflineConversationIdsRef.current.delete(message.conversationId)
            flushOfflineQueueRef.current(targetSocket)
          }, OFFLINE_MESSAGE_ACK_TIMEOUT_MS),
        )
        targetSocket.emit('send_message', buildOfflineMessagePayload(message))
      })
    },
    [clearOfflineMessageAckTimeout],
  )

  flushOfflineQueueRef.current = flushOfflineQueue

  const flushOfflineQueueWhenReady = useCallback(
    (targetSocket: Socket | null) => {
      if (!targetSocket?.connected) {
        return undefined
      }

      const recoverAndFlush = () => {
        void recoverPendingTextMessagesToOfflineQueue()
          .catch((error) => {
            console.warn('[Socket] Failed to recover pending text messages for retry', error)
          })
          .finally(() => {
            flushOfflineQueue(targetSocket)
          })
      }

      if (useChatStore.persist.hasHydrated()) {
        recoverAndFlush()
        return undefined
      }

      return useChatStore.persist.onFinishHydration(recoverAndFlush)
    },
    [flushOfflineQueue, recoverPendingTextMessagesToOfflineQueue],
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
      lastConnectErrorMessageRef.current = null
      if (serverDisconnectReconnectTimeoutRef.current) {
        clearTimeout(serverDisconnectReconnectTimeoutRef.current)
        serverDisconnectReconnectTimeoutRef.current = null
      }
      flushingOfflineMessageIdsRef.current.clear()
      flushingOfflineConversationIdsRef.current.clear()
      useChatStore.getState().clearOnlineUsers()
      clearAllOfflineMessageAckTimeouts()
      return
    }

    const newSocket = io(process.env.EXPO_PUBLIC_WS_URL || 'http://localhost:3000', {
      autoConnect: false,
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
      // Keep retrying while the app reports online. Mobile radios often take a moment
      // to become reachable again after the OS says the network is back.
      reconnectionAttempts: Infinity,
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

    const getCachedConversation = (conversationId: string) => {
      const conversations =
        queryClient.getQueryData<Conversation[] | undefined>(queryKeys.conversations.all) ?? []
      return conversations.find((conversation) => conversation.id === conversationId) ?? null
    }

    const resolveStreamingBotSender = ({
      conversationId,
      senderId,
    }: {
      conversationId: string
      senderId?: string
    }) => {
      const conversation = getCachedConversation(conversationId)
      const botParticipant = conversation?.participants?.find(isBotParticipant)
      const resolvedSenderId = senderId ?? botParticipant?.id ?? BOT_USER_ID ?? 'velora-bot'

      return {
        sender: {
          id: resolvedSenderId,
          email: botParticipant?.email?.trim() || BOT_FALLBACK_EMAIL,
          ...(botParticipant?.picture ? { picture: botParticipant.picture } : {}),
        },
        senderId: resolvedSenderId,
      }
    }

    const upsertStreamingBotMessage = (payload: NormalizedBotTokenPayload) => {
      const store = useChatStore.getState()
      const tempId = getBotStreamTempId(payload.conversationId)
      const existingStreamMessage =
        store.optimisticMessages[payload.conversationId]?.find(
          (message) => message.id === tempId,
        ) ?? null
      const { sender, senderId } = resolveStreamingBotSender({
        conversationId: payload.conversationId,
        ...(payload.senderId ? { senderId: payload.senderId } : {}),
      })
      const nextContent =
        payload.content ?? `${existingStreamMessage?.content ?? ''}${payload.tokenChunk ?? ''}`

      if (!nextContent) {
        return
      }

      store.markAsBotConversation(payload.conversationId)

      if (existingStreamMessage) {
        store.updateOptimisticMessage(payload.conversationId, tempId, (message) => ({
          ...message,
          content: nextContent,
          sender,
          senderId,
          status: 'SENT',
          updatedAt: new Date().toISOString(),
        }))
        return
      }

      const timestamp = new Date().toISOString()
      store.addOptimisticMessage(payload.conversationId, {
        id: tempId,
        clientMessageId: tempId,
        conversationId: payload.conversationId,
        senderId,
        sender,
        content: nextContent,
        type: 'text',
        status: 'SENT',
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }

    const reconcileStreamingBotMessage = (message: Message) => {
      const tempId = getBotStreamTempId(message.conversationId)
      const store = useChatStore.getState()
      const streamMessage =
        store.optimisticMessages[message.conversationId]?.find(
          (candidate) => candidate.id === tempId,
        ) ?? null

      if (!streamMessage) {
        return
      }

      if (
        streamMessage.senderId !== message.senderId &&
        !store.isBotConversation(message.conversationId) &&
        !conversationIncludesBot(getCachedConversation(message.conversationId))
      ) {
        return
      }

      store.confirmMessage(tempId, message)
    }

    clearStreamingBotMessages()

    newSocket.on('connect', () => {
      if (serverDisconnectReconnectTimeoutRef.current) {
        clearTimeout(serverDisconnectReconnectTimeoutRef.current)
        serverDisconnectReconnectTimeoutRef.current = null
      }

      setIsConnected(true)
      lastConnectErrorMessageRef.current = null

      const cachedConversations = queryClient.getQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
      )
      joinConversationRooms(
        Array.isArray(cachedConversations)
          ? cachedConversations.map((conversation) => conversation.id)
          : [],
      )

      flushOfflineQueueWhenReady(newSocket)
    })

    newSocket.on('disconnect', (reason) => {
      setIsConnected(false)
      lastConnectErrorMessageRef.current = null
      flushingOfflineMessageIdsRef.current.clear()
      flushingOfflineConversationIdsRef.current.clear()
      clearAllOfflineMessageAckTimeouts()
      useChatStore.getState().clearOnlineUsers()
      useChatStore.setState({ typingUsers: {} })
      clearStreamingBotMessages()
      joinedConversationIds.clear()

      if (reason === 'io server disconnect') {
        if (serverDisconnectReconnectTimeoutRef.current) {
          clearTimeout(serverDisconnectReconnectTimeoutRef.current)
        }

        serverDisconnectReconnectTimeoutRef.current = setTimeout(() => {
          serverDisconnectReconnectTimeoutRef.current = null

          const { isAuthenticated: latestIsAuthenticated, user: latestUser } =
            useAuthStore.getState()

          if (
            latestIsAuthenticated &&
            latestUser?.id &&
            newSocket.disconnected &&
            !newSocket.active
          ) {
            newSocket.connect()
          }
        }, 1000)
      }
    })

    newSocket.on('connect_error', (error) => {
      setIsConnected(false)
      useChatStore.getState().clearOnlineUsers()
      flushingOfflineMessageIdsRef.current.clear()
      flushingOfflineConversationIdsRef.current.clear()
      clearAllOfflineMessageAckTimeouts()
      clearStreamingBotMessages()
      if (lastConnectErrorMessageRef.current === error.message) {
        return
      }

      lastConnectErrorMessageRef.current = error.message
      console.warn('🔌 Socket connection warning:', {
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
            existingConversation.creatorId !== mergedConversation.creatorId ||
            existingConversation.participantIds !== mergedConversation.participantIds ||
            existingConversation.participants !== mergedConversation.participants ||
            existingConversation.createdAt !== mergedConversation.createdAt ||
            existingConversation.isGroup !== mergedConversation.isGroup ||
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

    const upsertCreatedConversation = (conversation: Conversation) => {
      const cachedConversations = queryClient.getQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
      )

      if (!Array.isArray(cachedConversations)) {
        queryClient.setQueryData(queryKeys.conversations.all, [conversation])
        return
      }

      const existingConversation = cachedConversations.find(
        (cachedConversation) => cachedConversation.id === conversation.id,
      )
      const existingActivityAt = existingConversation
        ? getConversationActivityAt(existingConversation)
        : 0
      const createdActivityAt = getConversationActivityAt(conversation)

      upsertConversationSummary(
        existingConversation && existingActivityAt > createdActivityAt
          ? {
              ...conversation,
              lastMessage: existingConversation.lastMessage ?? null,
              lastMessageAt: existingConversation.lastMessageAt ?? null,
              updatedAt: existingConversation.updatedAt,
              ...(existingConversation.unreadCount !== undefined
                ? { unreadCount: existingConversation.unreadCount }
                : {}),
            }
          : conversation,
        { allowPlaceholder: true },
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

    const normalizeIncomingMessage = (message: Message) => {
      const metadata = normalizeMessageMetadata(
        (message as Message & Record<string, unknown>).metadata ??
          (message as Message & Record<string, unknown>).message_metadata,
      )

      if (metadata) {
        return {
          ...message,
          metadata,
        }
      }

      if (!Object.prototype.hasOwnProperty.call(message, 'metadata')) {
        return message
      }

      const { metadata: _metadata, ...rest } = message as Message & { metadata?: unknown }
      return rest as Message
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

    const hydrateReplyContextFromLocalState = (message: Message) => {
      const replyToId = message.replyToId ?? message.reply_to_id ?? null

      if (!replyToId) {
        return message
      }

      const messagesQueryData = queryClient.getQueryData<InfiniteData<Message[]> | Message[]>(
        queryKeys.conversations.messages(message.conversationId),
      )

      const findReplyTarget = (messages: Message[]) => {
        return (
          messages.find(
            (candidate) =>
              candidate.id === replyToId ||
              candidate._id === replyToId ||
              candidate.clientMessageId === replyToId,
          ) ?? null
        )
      }

      const cachedReplyTarget =
        messagesQueryData && 'pages' in messagesQueryData
          ? (messagesQueryData.pages
              .flat()
              .find(
                (candidate) =>
                  candidate.id === replyToId ||
                  candidate._id === replyToId ||
                  candidate.clientMessageId === replyToId,
              ) ?? null)
          : Array.isArray(messagesQueryData)
            ? findReplyTarget(messagesQueryData)
            : null

      const optimisticReplyTarget =
        useChatStore
          .getState()
          .optimisticMessages[message.conversationId]?.find(
            (candidate) =>
              candidate.id === replyToId ||
              candidate._id === replyToId ||
              candidate.clientMessageId === replyToId,
          ) ?? null

      const resolvedReplyTarget = message.replyTo ?? cachedReplyTarget ?? optimisticReplyTarget

      if (!resolvedReplyTarget) {
        return message
      }

      const cachedConversations = queryClient.getQueryData<unknown>(queryKeys.conversations.all)
      const conversations: Conversation[] = Array.isArray(cachedConversations)
        ? cachedConversations
        : (cachedConversations as { pages?: Conversation[][] })?.pages?.flat() || []
      const currentConversation =
        conversations.find((conversation) => conversation.id === message.conversationId) ?? null
      const currentUser = useAuthStore.getState().user
      const localReplyPreview = buildReplyPreviewFromMessage({
        conversation: currentConversation,
        currentUserId: currentUser?.id ?? null,
        message: resolvedReplyTarget,
      })

      const replyPreview = mergeReplyPreview(message.replyPreview, localReplyPreview)

      return {
        ...message,
        ...(message.replyTo ? {} : { replyTo: resolvedReplyTarget }),
        ...(replyPreview ? { replyPreview } : {}),
      }
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
        if (message.isRecalled === true || message.is_recalled === true) {
          return message
        }

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
        patchConversationMessageCollectionsInCache(
          queryClient,
          payload.conversationId,
          updateMessage,
        )
        return
      }

      patchMessagesAcrossConversationCaches(queryClient, updateMessage)
    }

    newSocket.on('bot_token', (payload: unknown) => {
      const normalizedPayload = normalizeBotTokenPayload(payload)
      if (!normalizedPayload) {
        return
      }

      upsertStreamingBotMessage(normalizedPayload)
    })

    newSocket.on('new_message', (incomingMessage: Message) => {
      const message = hydrateReplyContextFromLocalState(
        mergeMessageWithOptimisticReplyPreview(normalizeIncomingMessage(incomingMessage)),
      )
      const currentUser = useAuthStore.getState().user
      const conversationId = message.conversationId
      const isOwnMessage = currentUser?.id === message.senderId
      const isPendingEcho =
        String((message as { status?: string }).status || '').toLowerCase() === 'sending'

      if (
        !isOwnMessage &&
        (message.senderId === BOT_USER_ID ||
          useChatStore.getState().isBotConversation(conversationId) ||
          conversationIncludesBot(getCachedConversation(conversationId)))
      ) {
        useChatStore.getState().markAsBotConversation(conversationId)
        reconcileStreamingBotMessage(message)
      }

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

      patchExistingMessageAcrossConversationCaches(queryClient, message)

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

    newSocket.on('conversation_created', (conversation: Conversation) => {
      if (!conversation?.id) return
      upsertCreatedConversation(conversation)
    })

    newSocket.on('message_synced', (incomingMessage: Message) => {
      const store = useChatStore.getState()
      const pendingMsgs = store.optimisticMessages[incomingMessage.conversationId] || []

      const optimisticMatch = pendingMsgs.find(
        (m) =>
          m.id === incomingMessage.clientMessageId ||
          m.clientMessageId === incomingMessage.clientMessageId,
      )

      let message = hydrateReplyContextFromLocalState(
        mergeMessageWithOptimisticReplyPreview(normalizeIncomingMessage(incomingMessage)),
      )

      if (
        optimisticMatch &&
        Array.isArray(optimisticMatch.readBy) &&
        optimisticMatch.readBy.length > 0
      ) {
        const existingReadBy = Array.isArray(message.readBy) ? [...message.readBy] : []

        optimisticMatch.readBy.forEach((optRead) => {
          if (!existingReadBy.some((r) => r.userId === optRead.userId)) {
            existingReadBy.push(optRead)
          }
        })

        message = {
          ...message,
          readBy: existingReadBy,
          status: existingReadBy.length > 0 ? 'READ' : message.status,
        }
      }
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
      patchExistingMessageAcrossConversationCaches(queryClient, message)

      if (userId && message.senderId === userId) {
        const store = useChatStore.getState()
        if (message.clientMessageId) {
          flushingOfflineMessageIdsRef.current.delete(message.clientMessageId)
          flushingOfflineConversationIdsRef.current.delete(message.conversationId)
          clearOfflineMessageAckTimeout(message.clientMessageId)
          store.confirmMessage(message.clientMessageId, message)
          store.dequeueOfflineMessage(message.clientMessageId)
          flushOfflineQueueRef.current(newSocket)
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
              flushingOfflineMessageIdsRef.current.delete(payload)
              flushingOfflineConversationIdsRef.current.delete(conversationId)
              clearOfflineMessageAckTimeout(payload)
              store.markMessageFailed(conversationId, payload)
              store.dequeueOfflineMessage(payload)
              flushOfflineQueueRef.current(newSocket)
            }
          })
          return
        }

        if (payload.conversationId && payload.clientMessageId) {
          flushingOfflineMessageIdsRef.current.delete(payload.clientMessageId)
          flushingOfflineConversationIdsRef.current.delete(payload.conversationId)
          clearOfflineMessageAckTimeout(payload.clientMessageId)
          store.markMessageFailed(payload.conversationId, payload.clientMessageId)
          store.dequeueOfflineMessage(payload.clientMessageId)
          flushOfflineQueueRef.current(newSocket)
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
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messagesAroundRoot(conversationId),
      })
    })

    newSocket.on(
      'message_recalled',
      ({
        conversationId,
        messageId,
        recalledAt,
      }: {
        conversationId?: string
        messageId: string
        recalledAt?: string
      }) => {
        const now = recalledAt || new Date().toISOString()
        const conversationIds = new Set<string>()

        if (conversationId) {
          conversationIds.add(conversationId)
        } else {
          const queries = queryClient.getQueriesData<
            InfiniteData<Message[]> | Message[] | undefined
          >({
            queryKey: ['conversations'],
          })

          for (const [queryKey] of queries) {
            if (!Array.isArray(queryKey) || typeof queryKey[1] !== 'string') {
              continue
            }

            if (
              (queryKey.length === 3 && queryKey[2] === 'messages') ||
              (queryKey.length === 4 && queryKey[2] === 'messagesAround')
            ) {
              conversationIds.add(queryKey[1])
            }
          }
        }

        for (const nextConversationId of conversationIds) {
          patchConversationMessageCollectionsInCache(queryClient, nextConversationId, (msg) =>
            msg.id === messageId ? redactRecalledMessage(msg, now) : msg,
          )
        }

        void markMessageRecalled({ messageId, recalledAt: now }).catch((error) => {
          console.warn('[Socket] Failed to persist recalled message locally', error)
        })
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
                  toTextOnlyReplyPreview(msg.replyPreview, payload.previewContent) ??
                  msg.replyPreview
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

        const allConversationIds = new Set<string>()
        const latestQueries = queryClient.getQueriesData<
          InfiniteData<Message[]> | Message[] | undefined
        >({
          queryKey: ['conversations'],
        })

        for (const [queryKey] of latestQueries) {
          if (!Array.isArray(queryKey) || typeof queryKey[1] !== 'string') {
            continue
          }

          if (
            (queryKey.length === 3 && queryKey[2] === 'messages') ||
            (queryKey.length === 4 && queryKey[2] === 'messagesAround')
          ) {
            allConversationIds.add(queryKey[1])
          }
        }

        for (const conversationId of allConversationIds) {
          patchConversationMessageCollectionsInCache(queryClient, conversationId, (msg) => {
            if (!messageIds.includes(msg.id) || !msg.replyPreview) {
              return msg
            }

            const updatedPreview =
              toTextOnlyReplyPreview(msg.replyPreview, payload.previewContent) ?? msg.replyPreview
            return { ...msg, replyPreview: updatedPreview }
          })
        }

        void applyReplyPreviewUpdate({
          messageIds,
          previewContent: payload.previewContent || 'Tin nhắn đã thu hồi',
        }).catch((error) => {
          console.warn('[Socket] Failed to persist reply preview update locally', error)
        })
      },
    )

    newSocket.on('message_reaction_updated', (message: Message) => {
      if (!message?.conversationId) {
        return
      }

      persistSocketMessage(message)
      patchExistingMessageAcrossConversationCaches(queryClient, message)
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

    newSocket.on(
      'messages_seen',
      ({ conversationId, readByUserId, at, messageId, frontierCreatedAt }) => {
        const currentUserId = userId
        if (!currentUserId) return

        const seenAt = at || new Date().toISOString()
        const resolvedReadFrontier = resolveReadFrontierFromCache({
          conversationId,
          frontierCreatedAt,
          messageId,
          seenAt,
        })
        const readFrontierCreatedAt = resolvedReadFrontier.createdAt
        const readFrontierAnchorIdentityKey = resolvedReadFrontier.anchorIdentityKey

        if (messageId && !readFrontierCreatedAt) {
          void applyReadReceiptUpdate({
            at: seenAt,
            conversationId,
            currentUserId,
            messageId,
            readByUserId,
            ...(readFrontierAnchorIdentityKey
              ? { frontierAnchorIdentityKey: readFrontierAnchorIdentityKey }
              : {}),
          }).catch((error) => {
            console.warn('[Socket] Failed to persist read receipt update locally', error)
          })
          return
        }

        const store = useChatStore.getState()
        store.markOptimisticMessagesAsReadBy(
          conversationId,
          currentUserId,
          readByUserId,
          seenAt,
          messageId,
          readFrontierCreatedAt ?? undefined,
          readFrontierAnchorIdentityKey ?? undefined,
        )

        patchConversationMessageCollectionsInCache(queryClient, conversationId, (msg) => {
          if (msg.senderId !== currentUserId) {
            return msg
          }

          const anchorsByMessageId =
            useChatStore.getState().optimisticSortAnchors[conversationId] || {}
          if (
            isMessageBeyondOptimisticReadFrontier({
              anchorsByMessageId,
              frontierIdentityKey: readFrontierAnchorIdentityKey,
              message: msg,
            })
          ) {
            return msg
          }

          if (
            !isMessageAtOrBeforeReadFrontier({
              frontierCreatedAt: readFrontierCreatedAt ?? seenAt,
              frontierMessageId: messageId,
              message: msg,
            })
          ) {
            return msg
          }

          const nextReadBy = Array.isArray(msg.readBy) ? [...msg.readBy] : []
          const alreadyMarked = nextReadBy.some((entry) => entry.userId === readByUserId)

          if (alreadyMarked) {
            return msg
          }

          useChatStore.getState().setMessageAsSeen(conversationId, msg.id)
          return {
            ...msg,
            status: 'READ',
            readBy: [...nextReadBy, { userId: readByUserId, at: seenAt }],
          }
        })

        void applyReadReceiptUpdate({
          at: seenAt,
          conversationId,
          currentUserId,
          messageId,
          readByUserId,
          ...(readFrontierAnchorIdentityKey
            ? { frontierAnchorIdentityKey: readFrontierAnchorIdentityKey }
            : {}),
          ...(readFrontierCreatedAt ? { frontierCreatedAt: readFrontierCreatedAt } : {}),
        }).catch((error) => {
          console.warn('[Socket] Failed to persist read receipt update locally', error)
        })
      },
    )

    const flushingOfflineMessageIds = flushingOfflineMessageIdsRef.current
    const flushingOfflineConversationIds = flushingOfflineConversationIdsRef.current

    setSocket(newSocket)

    return () => {
      if (serverDisconnectReconnectTimeoutRef.current) {
        clearTimeout(serverDisconnectReconnectTimeoutRef.current)
        serverDisconnectReconnectTimeoutRef.current = null
      }
      flushingOfflineMessageIds.clear()
      flushingOfflineConversationIds.clear()
      clearAllOfflineMessageAckTimeouts()

      unsubscribeQueryCache()
      newSocket.removeAllListeners()
      newSocket.disconnect()
    }
  }, [
    clearAllOfflineMessageAckTimeouts,
    clearOfflineMessageAckTimeout,
    flushOfflineQueue,
    flushOfflineQueueWhenReady,
    isAuthenticated,
    isLoading,
    queryClient,
    resolveReadFrontierFromCache,
    userId,
  ])

  useEffect(() => {
    if (!socket || isLoading || !isAuthenticated || !userId) {
      return
    }

    if (!isNetworkResolved) {
      return
    }

    if (!isOnline) {
      if (!socket.disconnected) {
        socket.disconnect()
      }
      return
    }

    if (socket.connected || socket.active) {
      return
    }

    socket.connect()
  }, [isAuthenticated, isLoading, isNetworkResolved, isOnline, isConnected, socket, userId])

  useEffect(() => {
    if (!socket?.connected || !isNetworkResolved || !isOnline || !isConnected) {
      return
    }

    return flushOfflineQueueWhenReady(socket)
  }, [flushOfflineQueueWhenReady, isConnected, isNetworkResolved, isOnline, socket])

  return (
    <SocketContext.Provider value={{ socket, isConnected, requestPresence }}>
      {children}
    </SocketContext.Provider>
  )
}
