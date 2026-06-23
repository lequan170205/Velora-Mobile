import { create } from 'zustand'

interface ConversationMessageListUiState {
  highlightTokens: Record<string, number>
}

interface MessageListUiState {
  conversations: Record<string, ConversationMessageListUiState>
  bumpHighlightToken: (conversationId: string, messageId: string) => void
  resetConversationUi: (conversationId: string) => void
}

const getConversationUiState = (
  conversations: Record<string, ConversationMessageListUiState>,
  conversationId: string,
): ConversationMessageListUiState => {
  return (
    conversations[conversationId] ?? {
      highlightTokens: {},
    }
  )
}

export const useMessageListUiStore = create<MessageListUiState>()((set) => ({
  conversations: {},

  bumpHighlightToken: (conversationId, messageId) =>
    set((state) => {
      const conversationState = getConversationUiState(state.conversations, conversationId)
      const currentToken = conversationState.highlightTokens[messageId] ?? 0

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...conversationState,
            highlightTokens: {
              ...conversationState.highlightTokens,
              [messageId]: currentToken + 1,
            },
          },
        },
      }
    }),

  resetConversationUi: (conversationId) =>
    set((state) => {
      if (!state.conversations[conversationId]) {
        return state
      }

      const nextConversations = { ...state.conversations }
      delete nextConversations[conversationId]

      return {
        conversations: nextConversations,
      }
    }),
}))
