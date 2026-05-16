import { create } from 'zustand'

interface ConversationMessageListUiState {
  expandedMessageId: string | null
  highlightTokens: Record<string, number>
}

interface MessageListUiState {
  conversations: Record<string, ConversationMessageListUiState>
  toggleExpandedMessage: (conversationId: string, messageId: string) => void
  bumpHighlightToken: (conversationId: string, messageId: string) => void
  resetConversationUi: (conversationId: string) => void
}

const getConversationUiState = (
  conversations: Record<string, ConversationMessageListUiState>,
  conversationId: string,
): ConversationMessageListUiState => {
  return (
    conversations[conversationId] ?? {
      expandedMessageId: null,
      highlightTokens: {},
    }
  )
}

export const useMessageListUiStore = create<MessageListUiState>()((set) => ({
  conversations: {},

  toggleExpandedMessage: (conversationId, messageId) =>
    set((state) => {
      const conversationState = getConversationUiState(state.conversations, conversationId)
      const expandedMessageId = conversationState.expandedMessageId === messageId ? null : messageId

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...conversationState,
            expandedMessageId,
          },
        },
      }
    }),

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
