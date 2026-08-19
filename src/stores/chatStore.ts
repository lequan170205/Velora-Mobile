import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { isMessageBeyondOptimisticReadFrontier } from '../lib/messageIdentity'

import type { Message } from '../types/conversation.types'

interface OfflineMessage {
  id: string
  conversationId: string
  content: string
  replyToId?: string
}

export interface OptimisticSortAnchor {
  frontierCreatedAtMs: number
  frontierMessageId: string | null
  sequence: number
  batchId?: string
}

interface ChatState {
  optimisticMessages: Record<string, Message[]>
  optimisticSortAnchors: Record<string, Record<string, OptimisticSortAnchor>>
  typingUsers: Record<string, string[]>
  onlineUsers: Set<string>
  lastSeenByUserId: Record<string, string | null | undefined>
  offlineQueue: OfflineMessage[]
  replyToMessage: Message | null // Currently replying to message
  seenMessages: Record<string, Set<string>> // conversationId -> Set<messageId> da duoc read
  botConversationIds: Set<string> // Conversation IDs that belong to bot chats
  revokedConversationIds: Set<string> // Session-only tombstones for revoked conversation access

  addOptimisticMessage: (conversationId: string, message: Message) => void
  addOptimisticMessages: (
    conversationId: string,
    messages: Message[],
    sortAnchorsByMessageId?: Record<string, OptimisticSortAnchor>,
  ) => void
  removeOptimisticSortAnchors: (conversationId: string, identityKeys: string[]) => void
  removeOptimisticMessage: (conversationId: string, tempId: string) => void
  updateOptimisticMessage: (
    conversationId: string,
    tempId: string,
    updater: (message: Message) => Message,
  ) => void
  confirmMessage: (tempId: string, message: Message) => void
  markMessageFailed: (conversationId: string, tempId: string) => void
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void
  setUserOnline: (userId: string, online: boolean, lastSeenAt?: string | null) => void
  clearOnlineUsers: () => void
  enqueueOfflineMessage: (message: OfflineMessage) => void
  dequeueOfflineMessage: (id: string) => void
  markOptimisticMessagesAsReadBy: (
    conversationId: string,
    currentUserId: string,
    readByUserId: string,
    at: string,
    messageId?: string,
    frontierCreatedAt?: string,
    frontierAnchorIdentityKey?: string,
  ) => void
  setMessageAsSeen: (conversationId: string, messageId: string) => void
  isMessageSeen: (conversationId: string, messageId: string) => boolean
  setReplyToMessage: (message: Message | null) => void
  markAsBotConversation: (conversationId: string) => void
  isBotConversation: (conversationId: string) => boolean
  markConversationRevoked: (conversationId: string) => void
  clearConversationRevoked: (conversationId: string) => void
  isConversationRevoked: (conversationId: string) => boolean
  clearConversationState: (conversationId: string) => void
  clearCache: () => void
}

const isActiveOptimisticMessage = (message: Message) => {
  return message.status === 'FAILED' || message.id.startsWith('temp-')
}

const pruneOptimisticMessages = (optimisticMessages: Record<string, Message[]>) => {
  return Object.fromEntries(
    Object.entries(optimisticMessages).flatMap(([conversationId, messages]) => {
      const activeMessages = messages.filter(isActiveOptimisticMessage)

      return activeMessages.length > 0 ? [[conversationId, activeMessages] as const] : []
    }),
  )
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

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      optimisticMessages: {},
      optimisticSortAnchors: {},
      typingUsers: {},
      onlineUsers: new Set(),
      lastSeenByUserId: {},
      offlineQueue: [],
      replyToMessage: null,
      seenMessages: {},
      botConversationIds: new Set(),
      revokedConversationIds: new Set(),

      setMessageAsSeen: (conversationId, messageId) =>
        set((state) => {
          const convSeen = state.seenMessages[conversationId] || new Set()
          const newSeen = new Set(convSeen)
          newSeen.add(messageId)
          return {
            seenMessages: {
              ...state.seenMessages,
              [conversationId]: newSeen,
            },
          }
        }),

      isMessageSeen: (conversationId, messageId) => {
        const convSeen = get().seenMessages[conversationId]
        return convSeen?.has(messageId) || false
      },

      addOptimisticMessage: (conversationId, message) =>
        set((state) => {
          const msgs = state.optimisticMessages[conversationId] || []
          if (msgs.some((existing) => existing.id === message.id)) {
            return state
          }

          return {
            optimisticMessages: {
              ...state.optimisticMessages,
              [conversationId]: [...msgs, message],
            },
          }
        }),

      addOptimisticMessages: (conversationId, messages, sortAnchorsByMessageId) =>
        set((state) => {
          if (messages.length === 0) {
            return state
          }

          const currentMessages = state.optimisticMessages[conversationId] || []
          const existingIds = new Set(currentMessages.map((message) => message.id))
          const nextMessages = messages.filter((message) => {
            if (existingIds.has(message.id)) {
              return false
            }

            existingIds.add(message.id)
            return true
          })

          if (nextMessages.length === 0) {
            return state
          }

          const currentAnchors = state.optimisticSortAnchors[conversationId] || {}
          const nextAnchors =
            sortAnchorsByMessageId && Object.keys(sortAnchorsByMessageId).length > 0
              ? {
                  ...currentAnchors,
                  ...Object.fromEntries(
                    nextMessages.flatMap((message) => {
                      const anchor = sortAnchorsByMessageId[message.id]
                      return anchor ? [[message.id, anchor] as const] : []
                    }),
                  ),
                }
              : currentAnchors

          return {
            optimisticMessages: {
              ...state.optimisticMessages,
              [conversationId]: [...currentMessages, ...nextMessages.reverse()],
            },
            optimisticSortAnchors:
              nextAnchors === currentAnchors
                ? state.optimisticSortAnchors
                : {
                    ...state.optimisticSortAnchors,
                    [conversationId]: nextAnchors,
                  },
          }
        }),

      removeOptimisticSortAnchors: (conversationId, identityKeys) =>
        set((state) => {
          if (identityKeys.length === 0) {
            return state
          }

          const currentAnchors = state.optimisticSortAnchors[conversationId]
          if (!currentAnchors) {
            return state
          }

          let changed = false
          const nextAnchors = { ...currentAnchors }
          identityKeys.forEach((identityKey) => {
            if (!nextAnchors[identityKey]) {
              return
            }

            changed = true
            delete nextAnchors[identityKey]
          })

          if (!changed) {
            return state
          }

          return {
            optimisticSortAnchors:
              Object.keys(nextAnchors).length > 0
                ? {
                    ...state.optimisticSortAnchors,
                    [conversationId]: nextAnchors,
                  }
                : (() => {
                    const updated = { ...state.optimisticSortAnchors }
                    delete updated[conversationId]
                    return updated
                  })(),
          }
        }),

      removeOptimisticMessage: (conversationId, tempId) =>
        set((state) => {
          const msgs = state.optimisticMessages[conversationId] || []
          const nextMessages = msgs.filter((message) => message.id !== tempId)

          const nextOptimisticMessages =
            nextMessages.length > 0
              ? {
                  ...state.optimisticMessages,
                  [conversationId]: nextMessages,
                }
              : (() => {
                  const updated = { ...state.optimisticMessages }
                  delete updated[conversationId]
                  return updated
                })()

          return {
            optimisticMessages: nextOptimisticMessages,
          }
        }),

      updateOptimisticMessage: (conversationId, tempId, updater) =>
        set((state) => {
          const msgs = state.optimisticMessages[conversationId] || []
          let hasChanges = false

          const nextMessages = msgs.map((message) => {
            if (message.id !== tempId) {
              return message
            }

            hasChanges = true
            return updater(message)
          })

          if (!hasChanges) {
            return state
          }

          return {
            optimisticMessages: {
              ...state.optimisticMessages,
              [conversationId]: nextMessages,
            },
          }
        }),

      confirmMessage: (tempId, currentMessage) =>
        set((state) => {
          const conversationId = currentMessage.conversationId
          const msgs = state.optimisticMessages[conversationId] || []
          const nextMessages = msgs.filter((message) => message.id !== tempId)

          const hasMessageChanges = nextMessages.length !== msgs.length
          if (!hasMessageChanges) {
            return state
          }

          const nextOptimisticMessages = hasMessageChanges
            ? nextMessages.length > 0
              ? {
                  ...state.optimisticMessages,
                  [conversationId]: nextMessages,
                }
              : (() => {
                  const updated = { ...state.optimisticMessages }
                  delete updated[conversationId]
                  return updated
                })()
            : state.optimisticMessages

          return {
            optimisticMessages: nextOptimisticMessages,
          }
        }),

      markMessageFailed: (conversationId, tempId) =>
        set((state) => {
          const msgs = state.optimisticMessages[conversationId] || []
          return {
            optimisticMessages: {
              ...state.optimisticMessages,
              [conversationId]: msgs.map((message) =>
                message.id === tempId ? { ...message, status: 'FAILED' as const } : message,
              ),
            },
          }
        }),

      setTyping: (conversationId, userId, isTyping) =>
        set((state) => {
          const typers = state.typingUsers[conversationId] || []
          const newTypers = isTyping
            ? Array.from(new Set([...typers, userId]))
            : typers.filter((id) => id !== userId)

          return {
            typingUsers: {
              ...state.typingUsers,
              [conversationId]: newTypers,
            },
          }
        }),

      setUserOnline: (userId, online, lastSeenAt) =>
        set((state) => {
          const newOnline = new Set(state.onlineUsers)
          const nextLastSeenByUserId = { ...state.lastSeenByUserId }

          if (online) {
            newOnline.add(userId)
            delete nextLastSeenByUserId[userId]
          } else {
            newOnline.delete(userId)
            if (lastSeenAt !== undefined) {
              nextLastSeenByUserId[userId] = lastSeenAt
            }
          }
          return {
            onlineUsers: newOnline,
            lastSeenByUserId: nextLastSeenByUserId,
          }
        }),

      clearOnlineUsers: () =>
        set(() => ({
          onlineUsers: new Set(),
        })),

      enqueueOfflineMessage: (message) =>
        set((state) => ({
          offlineQueue: state.offlineQueue.some((queued) => queued.id === message.id)
            ? state.offlineQueue
            : [...state.offlineQueue, message],
        })),

      dequeueOfflineMessage: (id) =>
        set((state) => ({
          offlineQueue: state.offlineQueue.filter((msg) => msg.id !== id),
        })),

      markOptimisticMessagesAsReadBy: (
        conversationId,
        currentUserId,
        readByUserId,
        at,
        messageId,
        frontierCreatedAt,
        frontierAnchorIdentityKey,
      ) =>
        set((state) => {
          const msgs = state.optimisticMessages[conversationId] || []
          const anchorsByMessageId = state.optimisticSortAnchors[conversationId] || {}
          let changed = false
          const effectiveFrontierCreatedAt = frontierCreatedAt ?? (messageId ? undefined : at)

          if (messageId && !effectiveFrontierCreatedAt) {
            return state
          }

          const nextMessages = msgs.map((message) => {
            if (message.senderId !== currentUserId) {
              return message
            }

            if (
              isMessageBeyondOptimisticReadFrontier({
                anchorsByMessageId,
                message,
                ...(frontierAnchorIdentityKey
                  ? { frontierIdentityKey: frontierAnchorIdentityKey }
                  : {}),
              })
            ) {
              return message
            }

            if (
              !isMessageAtOrBeforeReadFrontier({
                frontierCreatedAt: effectiveFrontierCreatedAt ?? at,
                frontierMessageId: messageId,
                message,
              })
            ) {
              return message
            }

            const nextReadBy = Array.isArray(message.readBy) ? [...message.readBy] : []
            const alreadyMarked = nextReadBy.some((entry) => entry.userId === readByUserId)

            if (alreadyMarked) {
              return message
            }

            changed = true
            return {
              ...message,
              status: 'READ' as const,
              readBy: [...nextReadBy, { userId: readByUserId, at }],
            }
          })

          if (!changed) {
            return state
          }

          return {
            optimisticMessages: {
              ...state.optimisticMessages,
              [conversationId]: nextMessages,
            },
          }
        }),

      setReplyToMessage: (message) =>
        set(() => ({
          replyToMessage: message,
        })),

      markAsBotConversation: (conversationId) =>
        set((state) => {
          const newIds = new Set(state.botConversationIds)
          newIds.add(conversationId)
          return { botConversationIds: newIds }
        }),

      isBotConversation: (conversationId) => {
        return get().botConversationIds.has(conversationId)
      },

      markConversationRevoked: (conversationId) =>
        set((state) => {
          const revokedConversationIds = new Set(state.revokedConversationIds)
          revokedConversationIds.add(conversationId)
          return { revokedConversationIds }
        }),

      clearConversationRevoked: (conversationId) =>
        set((state) => {
          if (!state.revokedConversationIds.has(conversationId)) {
            return state
          }

          const revokedConversationIds = new Set(state.revokedConversationIds)
          revokedConversationIds.delete(conversationId)
          return { revokedConversationIds }
        }),

      isConversationRevoked: (conversationId) => {
        return get().revokedConversationIds.has(conversationId)
      },

      clearConversationState: (conversationId) =>
        set((state) => {
          const optimisticMessages = { ...state.optimisticMessages }
          const optimisticSortAnchors = { ...state.optimisticSortAnchors }
          const typingUsers = { ...state.typingUsers }
          const seenMessages = { ...state.seenMessages }
          const botConversationIds = new Set(state.botConversationIds)

          delete optimisticMessages[conversationId]
          delete optimisticSortAnchors[conversationId]
          delete typingUsers[conversationId]
          delete seenMessages[conversationId]
          botConversationIds.delete(conversationId)

          return {
            optimisticMessages,
            optimisticSortAnchors,
            typingUsers,
            seenMessages,
            botConversationIds,
            offlineQueue: state.offlineQueue.filter(
              (message) => message.conversationId !== conversationId,
            ),
            replyToMessage:
              state.replyToMessage?.conversationId === conversationId ? null : state.replyToMessage,
          }
        }),

      clearCache: async () => {
        set(() => ({
          optimisticMessages: {},
          optimisticSortAnchors: {},
          offlineQueue: [],
          replyToMessage: null,
          seenMessages: {},
          revokedConversationIds: new Set(),
          // Keep botConversationIds because they are stable.
        }))
        await AsyncStorage.removeItem('chat-storage')
      },
    }),
    {
      name: 'chat-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        offlineQueue: state.offlineQueue,
        optimisticMessages: pruneOptimisticMessages(state.optimisticMessages),
        optimisticSortAnchors: state.optimisticSortAnchors,
        botConversationIds: Array.from(state.botConversationIds),
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Record<string, unknown>
        const optimisticMessages = pruneOptimisticMessages(
          (persisted.optimisticMessages as Record<string, Message[]>) || {},
        )
        const optimisticSortAnchors =
          (persisted.optimisticSortAnchors as Record<
            string,
            Record<string, OptimisticSortAnchor>
          >) || {}

        return {
          ...currentState,
          ...persisted,
          optimisticMessages,
          optimisticSortAnchors,
          botConversationIds: new Set<string>((persisted.botConversationIds as string[]) || []),
          onlineUsers: currentState.onlineUsers,
        }
      },
    },
  ),
)
