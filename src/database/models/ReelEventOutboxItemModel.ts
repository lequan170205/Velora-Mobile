import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

import { TABLES } from '../schema'

export class ReelEventOutboxItemModel extends Model {
  static table = TABLES.reelEventOutboxItems

  @text('event_id') eventId!: string
  @text('reel_id') reelId!: string
  @text('session_id') sessionId!: string | null
  @text('event_type') eventType!: string
  @text('payload_json') payloadJson!: string
  @field('created_at') createdAt!: number
  @field('retry_count') retryCount!: number
  @field('last_attempted_at') lastAttemptedAt!: number | null
}
