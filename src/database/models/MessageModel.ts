import { Model, associations } from '@nozbe/watermelondb'
import {
  date,
  field,
  immutableRelation,
  json,
  readonly,
  text,
} from '@nozbe/watermelondb/decorators'

import type { Relation } from '@nozbe/watermelondb'

import {
  sanitizeMessageMedia,
  sanitizeMessageMetadata,
  sanitizeReadBy,
  sanitizeReactions,
  sanitizeReplyPreview,
} from '../sanitizers'
import { TABLES } from '../schema'

import type { ConversationModel } from './ConversationModel'
import type { UserModel } from './UserModel'
import type {
  Message as ConversationMessage,
  MessageMedia,
  MessageMetadata,
  ReplyPreviewData,
  ReactionMap,
} from '../../types/conversation.types'

type MessageReadBy = NonNullable<ConversationMessage['readBy']>
type MessageReplyPreview = string | ReplyPreviewData | null

export const MESSAGE_TYPES = ['text', 'image', 'video', 'file', 'voice', 'call', 'reel'] as const
export type MessageTypeValue = (typeof MESSAGE_TYPES)[number]

export const MESSAGE_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'] as const
export type MessageStatusValue = (typeof MESSAGE_STATUSES)[number]

export class MessageModel extends Model {
  static table = TABLES.messages

  static associations = associations(
    [TABLES.conversations, { type: 'belongs_to', key: 'conversation_id' }],
    [TABLES.users, { type: 'belongs_to', key: 'sender_id' }],
  )

  @text('client_message_id') clientMessageId!: string | null
  @text('content') content!: string
  @json('media', sanitizeMessageMedia, { memo: true }) media!: MessageMedia | null
  @json('message_metadata', sanitizeMessageMetadata, { memo: true })
  metadata!: MessageMetadata | null
  @text('type') type!: MessageTypeValue
  @text('status') status!: MessageStatusValue
  @json('read_by', sanitizeReadBy, { memo: true }) readBy!: MessageReadBy | null
  @text('reply_to_id') replyToId!: string | null
  @json('reply_preview', sanitizeReplyPreview, { memo: true })
  replyPreview!: MessageReplyPreview
  @json('reactions', sanitizeReactions, { memo: true }) reactions!: ReactionMap | null
  @field('is_deleted') isDeleted!: boolean
  @field('is_recalled') isRecalled!: boolean
  @field('recalled_at') recalledAt!: number | null
  @field('server_updated_at') serverUpdatedAt!: number
  @readonly @date('created_at') createdAt!: Date
  @readonly @date('updated_at') updatedAt!: Date
  @text('conversation_id') conversationId!: string
  @text('sender_id') senderId!: string

  @immutableRelation(TABLES.conversations, 'conversation_id')
  conversation!: Relation<ConversationModel>

  @immutableRelation(TABLES.users, 'sender_id')
  sender!: Relation<UserModel>
}
