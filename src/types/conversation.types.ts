import type { UserSummary } from './user.types'

export interface ChatParticipant {
  id: string
  name?: string
  picture?: string
  email?: string
}

export interface Conversation {
  id: string
  creatorId: string
  participantIds: string[]
  participants?: ChatParticipant[]
  lastMessage?: string | null
  lastMessageAt?: string | null
  createdAt: string
  updatedAt: string
  messages?: Message[]
  isGroup: boolean

  // Custom frontend fields typically attached by the backend wrapper
  name?: string
  picture?: string
  unreadCount?: number
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  sender: UserSummary
  content: string
  type: 'text' | 'image' | 'file' | 'voice'
  status: 'SENT' | 'DELIVERED' | 'READ'
  replyTo?: Message
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface ConversationMember {
  userId: string
  user: UserSummary
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  joinedAt: string
}
