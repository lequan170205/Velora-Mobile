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

export interface Reaction {
  userId: string
  emoji: string
  createdAt: string
}

export interface ReactionMap {
  [userId: string]: {
    emoji: string
    createdAt: string
  }
}

export interface ReplyPreviewData {
  senderName: string
  content: string
  thumbnailUri?: string
  mediaWidth?: number
  mediaHeight?: number
  type: 'text' | 'image' | 'video' | 'file' | 'call'
}

export type MessageMediaStatus = 'ready' | 'processing' | 'failed'

export type MessageMediaUploadStage =
  | 'queued'
  | 'uploading'
  | 'syncing'
  | 'ready'
  | 'processing'
  | 'failed'

export interface MessageMedia {
  fileKey?: string
  fileUrl?: string
  thumbnailKey?: string
  thumbnailUrl?: string
  mimeType?: string
  width?: number
  height?: number
  durationMs?: number
  status?: MessageMediaStatus
  failureReason?: string

  // Local-only frontend metadata for optimistic rendering.
  localFileUri?: string
  localPosterUri?: string
  displayWidth?: number
  displayHeight?: number
  uploadStage?: MessageMediaUploadStage
  uploadStartedAt?: number
  lastProgressAt?: number
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  clientMessageId?: string
  sender: UserSummary
  content: string
  media?: MessageMedia
  type: 'text' | 'image' | 'video' | 'file' | 'voice' | 'call'
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  readBy?: { userId: string; at: string }[]
  replyTo?: Message
  isDeleted?: boolean
  deletedBy?: string
  createdAt: string
  updatedAt: string

  // New fields for Recall, Reply, Reactions (camelCase)
  isRecalled?: boolean
  recalledAt?: string
  replyToId?: string
  replyPreview?: string | ReplyPreviewData
  reactions?: ReactionMap

  // Backend also returns snake_case and MongoDB _id
  _id?: string
  is_recalled?: boolean
  recalled_at?: string
  reply_to_id?: string
  reply_preview?: string
}

export interface ConversationMember {
  userId: string
  user: UserSummary
  joinedAt: string
}

/** Response from POST /conversations/chat (bot auto-reply endpoint) */
export interface BotChatResponse {
  id: string
  conversationId: string
  senderId: string
  content: string
  media?: MessageMedia
  type: 'text' | 'image' | 'video' | 'file' | 'voice' | 'call'
  signalType: number
  createdAt: string
  createdAtMs: number
  readBy: { userId: string; at: string }[]
}
