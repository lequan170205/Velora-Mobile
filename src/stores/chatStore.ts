import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { Message } from '../types/conversation.types'

interface OfflineMessage {
  id: string
  conversationId: string
  content: string
}

interface ChatState {
  optimisticMessages: Record<string, Message[]>
  typingUsers: Record<string, string[]>
  onlineUsers: Set<string>
  offlineQueue: OfflineMessage[]
  replyToMessage: Message | null // Currently replying to message
  seenMessages: Record<string, Set<string>> // conversationId -> Set<messageId> đã được read

  addOptimisticMessage: (conversationId: string, message: Message) => void
  removeOptimisticMessage: (conversationId: string, tempId: string) => void
  confirmMessage: (tempId: string, message: Message) => void
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void
  setUserOnline: (userId: string, online: boolean) => void
  enqueueOfflineMessage: (message: OfflineMessage) => void
  dequeueOfflineMessage: (id: string) => void
  markMessagesAsSeen: (conversationId: string, userId: string) => void
  setMessageAsSeen: (conversationId: string, messageId: string) => void
  isMessageSeen: (conversationId: string, messageId: string) => boolean
  setReplyToMessage: (message: Message | null) => void
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
                  // Keep replyPreview from optimistic message if server doesn't return it
                  const optimisticPreview = m.replyPreview
                  const mergedMessage: Message = {
                    ...currentMessage,
                  }
                  // Only set replyPreview if either currentMessage or optimistic has it
                  if (currentMessage.replyPreview) {
                    mergedMessage.replyPreview = currentMessage.replyPreview
                  } else if (optimisticPreview) {
                    mergedMessage.replyPreview = optimisticPreview
                  }
                  return mergedMessage
                }
                return m
              }),
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
          offlineQueue: [...state.offlineQueue, message],
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

      clearCache: async () => {
        // Clear Zustand state
        set(() => ({
          optimisticMessages: {},
          offlineQueue: [],
          replyToMessage: null,
          seenMessages: {},
        }))
        // Clear AsyncStorage persisted data
        await AsyncStorage.removeItem('chat-storage')
      },
    }),
    {
      name: 'chat-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        offlineQueue: state.offlineQueue,
        optimisticMessages: state.optimisticMessages,
      }),
    },
  ),
)
