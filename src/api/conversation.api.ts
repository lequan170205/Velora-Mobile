import { normalizeMessageMetadata } from '../lib/messageMetadata'

import { apiClient } from './client'

import type {
  Conversation,
  ConversationMember,
  ConversationMemberRole,
  Message,
  MessageReactionDetails,
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

const normalizeMessage = (message: Message): Message => {
  const metadata = normalizeMessageMetadata(
    (message as Message & Record<string, unknown>).metadata ??
      (message as Message & Record<string, unknown>).message_metadata,
  )

  if (metadata) {
    return {
      ...message,
      metadata,
    }
  }

  if (!Object.prototype.hasOwnProperty.call(message, 'metadata')) {
    return message
  }

  const { metadata: _metadata, ...rest } = message as Message & { metadata?: unknown }
  return rest as Message
}

const normalizeMessages = (messages: Message[]) => messages.map(normalizeMessage)

const fallbackGroupMembersFromConversation = (
  conversation: Conversation,
): ConversationMember[] => {
  const participantById = new Map(
    (conversation.participants ?? []).map((participant) => [participant.id, participant]),
  )
  const fallbackJoinedAt = conversation.createdAt

  return conversation.participantIds.map((userId) => {
    const participant = participantById.get(userId)

    return {
      userId,
      role: userId === conversation.creatorId ? 'OWNER' : 'MEMBER',
      status: 'ACTIVE',
      joinedAt: conversation.memberJoinedAt?.[userId] ?? fallbackJoinedAt,
      user: {
        id: userId,
        email: participant?.email ?? '',
        ...(participant?.name ? { name: participant.name } : {}),
        ...(participant?.fullName ? { fullName: participant.fullName } : {}),
        ...(participant?.picture ? { picture: participant.picture } : {}),
      },
    }
  })
}

export const conversationApi = {
  getAll: async () => {
    const response = await apiClient.get<Conversation[]>('/conversations')
    return response.data
  },
  create: async (data: {
    participantIds: string[]
    type: 'DIRECT' | 'GROUP'
    name?: string
    picture?: string
  }) => {
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
  updateGroup: async (id: string, data: { name?: string; picture?: string | null }) => {
    const response = await apiClient.patch<Conversation>(`/conversations/${id}`, data)
    return response.data
  },
  delete: async (id: string) => {
    await apiClient.delete(`/conversations/${id}`)
  },
  getMessages: async (id: string, params: { page?: number; limit?: number; cursor?: string }) => {
    const response = await apiClient.get<Message[]>(`/conversations/${id}/messages`, { params })

    return normalizeMessages(response.data)
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
          ...(params.before !== undefined ? { before: params.before } : {}),
          ...(params.after !== undefined ? { after: params.after } : {}),
        },
        ...(params.signal ? { signal: params.signal } : {}),
      },
    )

    return {
      ...response.data,
      messages: normalizeMessages(response.data.messages),
    }
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

    return {
      ...response.data,
      messages: normalizeMessages(response.data.messages),
    }
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

    return {
      ...response.data,
      messages: normalizeMessages(response.data.messages),
    }
  },
  sendMessage: async (
    id: string,
    data: {
      clientMessageId?: string
      content: string
      media?: Message['media']
      type: Message['type']
      signalType?: number
      replyToId?: string
    },
  ) => {
    const response = await apiClient.post<Message>(`/conversations/${id}/messages`, data)

    return normalizeMessage(response.data)
  },
  deleteMessage: async (id: string, messageId: string) => {
    await apiClient.delete(`/conversations/${id}/messages/${messageId}`)
  },
  updateMessage: async (id: string, messageId: string, data: { content: string }) => {
    const response = await apiClient.patch<Message>(
      `/conversations/${id}/messages/${messageId}`,
      data,
    )
    return normalizeMessage(response.data)
  },
  readMessage: async (id: string, data: { messageId: string }) => {
    await apiClient.post(`/conversations/${id}/read`, data)
  },

  // Recall, Reply, Reactions
  recallMessage: async (conversationId: string, messageId: string) => {
    const response = await apiClient.post<Message>(
      `/conversations/${conversationId}/messages/${messageId}/recall`,
    )
    return normalizeMessage(response.data)
  },

  getReactionDetails: async (messageId: string) => {
    const response = await apiClient.get<MessageReactionDetails>(`/messages/${messageId}/reactions`)
    return response.data
  },

  addReaction: async (messageId: string, userId: string, emoji: string) => {
    const response = await apiClient.post<Message>(`/messages/${messageId}/reactions`, {
      userId,
      emoji,
    })
    return normalizeMessage(response.data)
  },

  removeReaction: async (messageId: string, userId: string) => {
    const response = await apiClient.delete<Message>(`/messages/${messageId}/reactions/${userId}`)
    return normalizeMessage(response.data)
  },

  // Group Chat V2 membership / roles
  getMembers: async (id: string) => {
    try {
      const response = await apiClient.get<ConversationMember[]>(`/conversations/${id}/members/v2`)
      if (response.data.length > 0) {
        return response.data
      }
    } catch (error) {
      console.warn('[ConversationApi] Group V2 member projection unavailable; using roster fallback', error)
    }

    const conversationResponse = await apiClient.get<Conversation>(`/conversations/${id}`)
    return fallbackGroupMembersFromConversation(conversationResponse.data)
  },
  addMember: async (id: string, data: { userId: string }) => {
    await apiClient.post(`/conversations/${id}/members`, data)
  },
  removeMember: async (id: string, userId: string) => {
    await apiClient.delete(`/conversations/${id}/members/${userId}`)
  },
  updateMemberRole: async (
    id: string,
    userId: string,
    role: Extract<ConversationMemberRole, 'ADMIN' | 'MEMBER'>,
  ) => {
    await apiClient.patch(`/conversations/${id}/members/${userId}/role`, { role })
  },
  transferOwnership: async (id: string, data: { userId: string }) => {
    const response = await apiClient.patch<Conversation>(`/conversations/${id}/owner`, data)
    return response.data
  },
  leave: async (id: string) => {
    const response = await apiClient.post<Conversation>(`/conversations/${id}/leave`)
    return response.data
  },
}
