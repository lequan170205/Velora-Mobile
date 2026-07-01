import { Model, associations } from '@nozbe/watermelondb'
import { date, field, immutableRelation, readonly, text } from '@nozbe/watermelondb/decorators'

import type { Relation } from '@nozbe/watermelondb'

import { TABLES } from '../schema'

import type { ConversationModel } from './ConversationModel'

export const MESSAGE_SYNC_RANGE_TYPES = ['latest', 'anchor'] as const
export type MessageSyncRangeType = (typeof MESSAGE_SYNC_RANGE_TYPES)[number]

export const MESSAGE_SYNC_RANGE_SOURCES = [
  'remote_latest',
  'remote_anchor_around',
  'remote_anchor_older',
  'remote_anchor_newer',
  'socket',
  'local_unknown',
] as const
export type MessageSyncRangeSource = (typeof MESSAGE_SYNC_RANGE_SOURCES)[number]

export class MessageSyncRangeModel extends Model {
  static table = TABLES.messageSyncRanges

  static associations = associations([
    TABLES.conversations,
    { type: 'belongs_to', key: 'conversation_id' },
  ])

  @text('conversation_id') conversationId!: string
  @text('range_type') rangeType!: MessageSyncRangeType
  @text('source') source!: MessageSyncRangeSource
  @text('anchor_target_id') anchorTargetId!: string | null
  @text('start_message_id') startMessageId!: string | null
  @field('start_created_at') startCreatedAt!: number | null
  @text('end_message_id') endMessageId!: string | null
  @field('end_created_at') endCreatedAt!: number | null
  @field('remote_has_older') remoteHasOlder!: boolean
  @field('remote_has_newer') remoteHasNewer!: boolean
  @field('remote_exhausted_older') remoteExhaustedOlder!: boolean
  @field('remote_exhausted_newer') remoteExhaustedNewer!: boolean
  @field('is_contiguous') isContiguous!: boolean
  @field('is_complete') isComplete!: boolean
  @text('last_cursor') lastCursor!: string | null
  @field('last_synced_at') lastSyncedAt!: number | null
  @readonly @date('created_at') createdAt!: Date
  @readonly @date('updated_at') updatedAt!: Date

  @immutableRelation(TABLES.conversations, 'conversation_id')
  conversation!: Relation<ConversationModel>
}
