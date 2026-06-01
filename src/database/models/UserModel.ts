import { Model, associations } from '@nozbe/watermelondb'
import { children, date, field, readonly, text } from '@nozbe/watermelondb/decorators'

import type { Query } from '@nozbe/watermelondb'

import { TABLES } from '../schema'

import type { MessageModel } from './MessageModel'

export class UserModel extends Model {
  static table = TABLES.users

  static associations = associations([
    TABLES.messages,
    { type: 'has_many', foreignKey: 'sender_id' },
  ])

  @text('email') email!: string
  @text('username') username!: string | null
  @text('full_name') fullName!: string | null
  @text('picture') picture!: string | null
  @field('is_verified') isVerified!: boolean
  @field('last_seen_at') lastSeenAt!: number | null
  @field('server_updated_at') serverUpdatedAt!: number
  @readonly @date('created_at') createdAt!: Date
  @readonly @date('updated_at') updatedAt!: Date

  @children(TABLES.messages) messages!: Query<MessageModel>
}
