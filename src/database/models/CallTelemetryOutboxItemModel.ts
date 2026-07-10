import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

import { TABLES } from '../schema'

export class CallTelemetryOutboxItemModel extends Model {
  static table = TABLES.callTelemetryOutboxItems

  @text('event_id') eventId!: string
  @text('payload_json') payloadJson!: string
  @field('created_at') createdAt!: number
  @field('retry_count') retryCount!: number
  @field('last_attempted_at') lastAttemptedAt!: number | null
}
