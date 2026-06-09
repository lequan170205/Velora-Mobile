import { apiClient } from './client'

import type {
  BotChatResponse,
  Conversation,
  ConversationMember,
  Message,
} from '../types/conversation.types'

export interface AnchorWindowResponse {
  targetMessageId: string
  messages: Message[]
  hasOlder: boolean
  hasNewer: boolean
  oldestCursor?: string
  newestCursor?: string
}

export interface AnchorExpansionResponse {
  messages: Message[]
  hasMore: boolean
  nextCursor?: string
}

interface CreateConversationResponse {
  id: string
}

export const conversationApi = {
  getAll: async () => {
    const response = await apiClient.get<Conversation[]>('/conversations')
    return response.data
  },
  create: async (data: { participantIds: string[]; type: 'DIRECT' | 'GROUP'; name?: string }) => {
    const response = await apiClient.post<CreateConversationResponse>('/conversations', data)
    return response.data
  },
  createBotConversation: async () => {
    const botUserId = process.env.EXPO_PUBLIC_BOT_USER_ID

    if (!botUserId) {
      throw new Error('EXPO_PUBLIC_BOT_USER_ID is not configured')
    }

    const response = await apiClient.post<CreateConversationResponse>('/conversations', {
      participantIds: [botUserId],
      type: 'DIRECT',
    })

    return response.data
  },
  getById: async (id: string) => {
    const response = await apiClient.get<Conversation>(`/conversations/${id}`)
    return response.data
  },
  delete: async (id: string) => {
    await apiClient.delete(`/conversations/${id}`)
  },
  getMessages: async (id: string, params: { page?: number; limit?: number; cursor?: string }) => {
    const response = await apiClient.get<Message[]>(`/conversations/${id}/messages`, { params })

    return response.data
  },
  getMessagesAround: async (
    id: string,
    messageId: string,
    params: { before?: number; after?: number; signal?: AbortSignal },
  ) => {
    const response = await apiClient.get<AnchorWindowResponse>(
      `/conversations/${id}/messages/around/${messageId}`,
      {
        params: {
          ...(params.before ? { before: params.before } : {}),
          ...(params.after ? { after: params.after } : {}),
        },
        ...(params.signal ? { signal: params.signal } : {}),
      },
    )

    return response.data
  },
  getMessagesAnchorOlder: async (
    id: string,
    params: { cursor: string; limit?: number; signal?: AbortSignal },
  ) => {
    const response = await apiClient.get<AnchorExpansionResponse>(
      `/conversations/${id}/messages/anchor/older`,
      {
        params: {
          cursor: params.cursor,
          ...(params.limit ? { limit: params.limit } : {}),
        },
        ...(params.signal ? { signal: params.signal } : {}),
      },
    )

    return response.data
  },
  getMessagesAnchorNewer: async (
    id: string,
    params: { cursor: string; limit?: number; signal?: AbortSignal },
  ) => {
    const response = await apiClient.get<AnchorExpansionResponse>(
      `/conversations/${id}/messages/anchor/newer`,
      {
        params: {
          cursor: params.cursor,
          ...(params.limit ? { limit: params.limit } : {}),
        },
        ...(params.signal ? { signal: params.signal } : {}),
      },
    )

    return response.data
  },
  sendMessage: async (
    id: string,
    data: {
      clientMessageId?: string
      content: string
      media?: Message['media']
      type: 'text' | 'image' | 'video' | 'file' | 'voice' | 'call'
      signalType?: number
      replyToId?: string
    },
  ) => {
    const response = await apiClient.post<Message>(`/conversations/${id}/messages`, data)

    return response.data
  },
  deleteMessage: async (id: string, messageId: string) => {
    await apiClient.delete(`/conversations/${id}/messages/${messageId}`)
  },
  updateMessage: async (id: string, messageId: string, data: { content: string }) => {
    const response = await apiClient.patch<Message>(
      `/conversations/${id}/messages/${messageId}`,
      data,
    )
    return response.data
  },
  readMessage: async (id: string, data: { messageId: string }) => {
    await apiClient.post(`/conversations/${id}/read`, data)
  },

  // New methods for Recall, Reply, Reactions

  recallMessage: async (conversationId: string, messageId: string) => {
    const response = await apiClient.post<Message>(
      `/conversations/${conversationId}/messages/${messageId}/recall`,
    )
    return response.data
  },

  addReaction: async (messageId: string, userId: string, emoji: string) => {
    const response = await apiClient.post<Message>(`/messages/${messageId}/reactions`, {
      userId,
      emoji,
    })
    return response.data
  },

  removeReaction: async (messageId: string, userId: string) => {
    const response = await apiClient.delete<Message>(`/messages/${messageId}/reactions/${userId}`)
    return response.data
  },
  getMembers: async (id: string) => {
    const response = await apiClient.get<ConversationMember[]>(`/conversations/${id}/members`)
    return response.data
  },
  addMember: async (id: string, data: { userId: string }) => {
    const response = await apiClient.post<ConversationMember>(`/conversations/${id}/members`, data)
    return response.data
  },
  removeMember: async (id: string, userId: string) => {
    await apiClient.delete(`/conversations/${id}/members/${userId}`)
  },

  /** Creates (or retrieves) a bot conversation and sends the initial message. */
  chatWithBot: async (data: { content: string }) => {
    const response = await apiClient.post<BotChatResponse>('/conversations/chat', {
      type: 'text',
      signalType: 0,
      content: data.content,
    })
    return response.data
  },
}
