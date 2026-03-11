import { create } from 'zustand'

import type { Message } from '../types/conversation.types'

interface ChatState {
  optimisticMessages: Record<string, Message[]>
  typingUsers: Record<string, string[]> // conversationId -> [userId]
  onlineUsers: Set<string>

  addOptimisticMessage: (conversationId: string, message: Message) => void
  removeOptimisticMessage: (conversationId: string, tempId: string) => void
  confirmMessage: (tempId: string, message: Message) => void
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void
  setUserOnline: (userId: string, online: boolean) => void
}

export const useChatStore = create<ChatState>((set) => ({
  optimisticMessages: {},
  typingUsers: {},
  onlineUsers: new Set(),

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
          [conversationId]: msgs.map((m) => (m.id === tempId ? currentMessage : m)),
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
}))
