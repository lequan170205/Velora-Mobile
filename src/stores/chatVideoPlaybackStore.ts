import { create } from 'zustand'

interface ChatVideoPlaybackStore {
  activeMessageIdByConversation: Record<string, string | null | undefined>
  setActiveMessage: (conversationId: string, messageId: string | null) => void
  clearConversation: (conversationId: string) => void
}

export const useChatVideoPlaybackStore = create<ChatVideoPlaybackStore>()((set) => ({
  activeMessageIdByConversation: {},
  setActiveMessage: (conversationId, messageId) =>
    set((state) => ({
      activeMessageIdByConversation: {
        ...state.activeMessageIdByConversation,
        [conversationId]: messageId,
      },
    })),
  clearConversation: (conversationId) =>
    set((state) => {
      if (!(conversationId in state.activeMessageIdByConversation)) {
        return state
      }

      const nextActiveMessageIdByConversation = { ...state.activeMessageIdByConversation }
      delete nextActiveMessageIdByConversation[conversationId]

      return {
        activeMessageIdByConversation: nextActiveMessageIdByConversation,
      }
    }),
}))
