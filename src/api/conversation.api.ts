import { apiClient } from './client'

import type {
  BotChatResponse,
  Conversation,
  ConversationMember,
  Message,
} from '../types/conversation.types'

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
  sendMessage: async (
    id: string,
    data: {
      clientMessageId?: string
      content: string
      type: 'text' | 'image' | 'file' | 'voice'
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
