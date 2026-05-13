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
  offlineQueue: OfflineMessage[]
  replyToMessage: Message | null // Currently replying to message
  seenMessages: Record<string, Set<string>> // conversationId -> Set<messageId> da duoc read
  botConversationIds: Set<string> // Conversation IDs that belong to bot chats

  addOptimisticMessage: (conversationId: string, message: Message) => void
  removeOptimisticMessage: (conversationId: string, tempId: string) => void
  confirmMessage: (tempId: string, message: Message) => void
  markMessageFailed: (conversationId: string, tempId: string) => void
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void
  setUserOnline: (userId: string, online: boolean) => void
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

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      optimisticMessages: {},
      typingUsers: {},
      onlineUsers: new Set(),
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

      confirmMessage: (tempId, currentMessage) =>
        set((state) => {
          const conversationId = currentMessage.conversationId
          const msgs = state.optimisticMessages[conversationId] || []

          return {
            optimisticMessages: {
              ...state.optimisticMessages,
              [conversationId]: msgs.map((m) => {
                if (m.id === tempId) {
                  const optimisticPreview = m.replyPreview
                  const optimisticReplyToId = m.replyToId
                  const mergedMessage: Message = {
                    ...currentMessage,
                  }
                  if (currentMessage.replyPreview) {
                    mergedMessage.replyPreview = currentMessage.replyPreview
                  } else if (optimisticPreview) {
                    mergedMessage.replyPreview = optimisticPreview
                  }
                  if (currentMessage.replyToId) {
                    mergedMessage.replyToId = currentMessage.replyToId
                  } else if (optimisticReplyToId) {
                    mergedMessage.replyToId = optimisticReplyToId
                  }
                  return mergedMessage
                }
                return m
              }),
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

      setUserOnline: (userId, online) =>
        set((state) => {
          const newOnline = new Set(state.onlineUsers)
          if (online) {
            newOnline.add(userId)
          } else {
            newOnline.delete(userId)
          }
          return { onlineUsers: newOnline }
        }),

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
        optimisticMessages: state.optimisticMessages,
        botConversationIds: Array.from(state.botConversationIds),
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Record<string, unknown>
        return {
          ...currentState,
          ...persisted,
          botConversationIds: new Set<string>((persisted.botConversationIds as string[]) || []),
          onlineUsers: currentState.onlineUsers,
        }
      },
    },
  ),
)
