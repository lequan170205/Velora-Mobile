import { Model, associations } from '@nozbe/watermelondb'
import { children, date, field, json, readonly, text, writer } from '@nozbe/watermelondb/decorators'

import type { Query, RecordId } from '@nozbe/watermelondb'

import { sanitizeParticipantIds } from '../sanitizers'
import { TABLES } from '../schema'

import type { MessageModel } from './MessageModel'
import type {
  Message as ConversationMessage,
  MessageMedia,
  ReplyPreviewData,
  ReactionMap,
} from '../../types/conversation.types'

type MessageReadBy = NonNullable<ConversationMessage['readBy']>
type MessageReplyPreview = string | ReplyPreviewData | null
type MessageTypeValue = 'text' | 'image' | 'video' | 'file' | 'voice' | 'call' | 'reel'
type MessageStatusValue = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'

export type AddMessageInput = {
  senderId: RecordId
  clientMessageId?: string | null
  content: string
  media?: MessageMedia | null
  type?: MessageTypeValue
  status?: MessageStatusValue
  readBy?: MessageReadBy | null
  replyToId?: string | null
  replyPreview?: MessageReplyPreview
  reactions?: ReactionMap | null
  isDeleted?: boolean
  isRecalled?: boolean
  recalledAt?: number | null
  serverUpdatedAt?: number
  lastMessageAt?: number | null
  unreadCount?: number
}

export class ConversationModel extends Model {
  static table = TABLES.conversations

  static associations = associations([
    TABLES.messages,
    { type: 'has_many', foreignKey: 'conversation_id' },
  ])

  @text('creator_id') creatorId!: string
  @json('participant_ids', sanitizeParticipantIds, { memo: true }) participantIds!: string[]
  @text('name') name!: string | null
  @text('picture') picture!: string | null
  @field('is_group') isGroup!: boolean
  @text('last_message') lastMessage!: string | null
  @field('last_message_at') lastMessageAt!: number | null
  @field('unread_count') unreadCount!: number
  @field('server_updated_at') serverUpdatedAt!: number
  @readonly @date('created_at') createdAt!: Date
  @readonly @date('updated_at') updatedAt!: Date

  @children(TABLES.messages) messages!: Query<MessageModel>

  @writer
  async addMessage(input: AddMessageInput): Promise<MessageModel> {
    const messagesCollection = this.collections.get<MessageModel>(TABLES.messages)
    const messageType = input.type ?? 'text'
    const messageStatus = input.status ?? 'SENT'
    const messageTimestamp = input.lastMessageAt ?? Date.now()
    const serverUpdatedAt = input.serverUpdatedAt ?? messageTimestamp
    const messageActivityAt = input.lastMessageAt ?? Date.now()
    const unreadCount = input.unreadCount ?? this.unreadCount

    const preparedMessage = messagesCollection.prepareCreate((message) => {
      const raw = message._raw as Record<string, string | number | null>
      message.conversationId = this.id
      message.senderId = input.senderId
      message.clientMessageId = input.clientMessageId ?? null
      message.content = input.content
      message.media = input.media ?? null
      message.type = messageType
      message.status = messageStatus
      message.readBy = input.readBy ?? null
      message.replyToId = input.replyToId ?? null
      message.replyPreview = input.replyPreview ?? null
      message.reactions = input.reactions ?? null
      message.isDeleted = input.isDeleted ?? false
      message.isRecalled = input.isRecalled ?? false
      message.recalledAt = input.recalledAt ?? null
      message.serverUpdatedAt = serverUpdatedAt

      if (input.clientMessageId) {
        raw.id = input.clientMessageId
      }

      raw.created_at = messageTimestamp
      raw.updated_at = messageTimestamp
    })

    const preparedConversation = this.prepareUpdate((conversation) => {
      const raw = conversation._raw as Record<string, string | number | null>
      conversation.lastMessage = input.content
      conversation.lastMessageAt = messageActivityAt
      conversation.unreadCount = unreadCount
      conversation.serverUpdatedAt = serverUpdatedAt
      raw.updated_at = messageActivityAt
    })

    await this.batch(preparedMessage, preparedConversation)

    return preparedMessage
  }
}
