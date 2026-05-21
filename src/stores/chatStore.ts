import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { Message } from '../types/conversation.types'

interface OfflineMessage {
  id: string
  conversationId: string
  content: string
  replyToId?: string
}

interface ChatState {
  optimisticMessages: Record<string, Message[]>
  typingUsers: Record<string, string[]>
  onlineUsers: Set<string>
  lastSeenByUserId: Record<string, string | null | undefined>
  offlineQueue: OfflineMessage[]
  replyToMessage: Message | null // Currently replying to message
  seenMessages: Record<string, Set<string>> // conversationId -> Set<messageId> da duoc read
  botConversationIds: Set<string> // Conversation IDs that belong to bot chats

  addOptimisticMessage: (conversationId: string, message: Message) => void
  addOptimisticMessages: (conversationId: string, messages: Message[]) => void
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
  markMessagesAsSeen: (conversationId: string, userId: string) => void
  setMessageAsSeen: (conversationId: string, messageId: string) => void
  isMessageSeen: (conversationId: string, messageId: string) => boolean
  setReplyToMessage: (message: Message | null) => void
  markAsBotConversation: (conversationId: string) => void
  isBotConversation: (conversationId: string) => boolean
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

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      optimisticMessages: {},
      typingUsers: {},
      onlineUsers: new Set(),
      lastSeenByUserId: {},
      offlineQueue: [],
      replyToMessage: null,
      seenMessages: {},
      botConversationIds: new Set(),

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

      addOptimisticMessages: (conversationId, messages) =>
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

          return {
            optimisticMessages: {
              ...state.optimisticMessages,
              [conversationId]: [...currentMessages, ...nextMessages.reverse()],
            },
          }
        }),

      removeOptimisticMessage: (conversationId, tempId) =>
        set((state) => {
          const msgs = state.optimisticMessages[conversationId] || []
          return {
            optimisticMessages: {
              ...state.optimisticMessages,
              [conversationId]: msgs.filter((m) => m.id !== tempId),
            },
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

          if (nextMessages.length === msgs.length) {
            return state
          }

          if (nextMessages.length === 0) {
            const nextOptimisticMessages = { ...state.optimisticMessages }
            delete nextOptimisticMessages[conversationId]

            return {
              optimisticMessages: nextOptimisticMessages,
            }
          }

          return {
            optimisticMessages: {
              ...state.optimisticMessages,
              [conversationId]: nextMessages,
            },
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

      markMessagesAsSeen: (conversationId, userId) =>
        set((state) => {
          const msgs = state.optimisticMessages[conversationId] || []
          return {
            optimisticMessages: {
              ...state.optimisticMessages,
              [conversationId]: msgs.map((m) =>
                m.senderId !== userId && m.status !== 'READ'
                  ? { ...m, status: 'READ' as const }
                  : m,
              ),
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

      clearCache: async () => {
        set(() => ({
          optimisticMessages: {},
          offlineQueue: [],
          replyToMessage: null,
          seenMessages: {},
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
        botConversationIds: Array.from(state.botConversationIds),
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Record<string, unknown>
        return {
          ...currentState,
          ...persisted,
          optimisticMessages: pruneOptimisticMessages(
            (persisted.optimisticMessages as Record<string, Message[]>) || {},
          ),
          botConversationIds: new Set<string>((persisted.botConversationIds as string[]) || []),
          onlineUsers: currentState.onlineUsers,
        }
      },
    },
  ),
)
