import { appSchema, tableSchema } from '@nozbe/watermelondb'

import type { TableSchemaSpec } from '@nozbe/watermelondb/Schema'

export const TABLES = {
  users: 'users',
  conversations: 'conversations',
  messages: 'messages',
  messageSyncRanges: 'message_sync_ranges',
} as const

export const MESSAGE_SYNC_RANGES_TABLE_SCHEMA: TableSchemaSpec = {
  name: TABLES.messageSyncRanges,
  columns: [
    { name: 'conversation_id', type: 'string', isIndexed: true },
    { name: 'range_type', type: 'string', isIndexed: true },
    { name: 'source', type: 'string' },
    { name: 'anchor_target_id', type: 'string', isOptional: true, isIndexed: true },
    { name: 'start_message_id', type: 'string', isOptional: true },
    { name: 'start_created_at', type: 'number', isOptional: true, isIndexed: true },
    { name: 'end_message_id', type: 'string', isOptional: true },
    { name: 'end_created_at', type: 'number', isOptional: true, isIndexed: true },
    { name: 'remote_has_older', type: 'boolean' },
    { name: 'remote_has_newer', type: 'boolean' },
    { name: 'remote_exhausted_older', type: 'boolean' },
    { name: 'remote_exhausted_newer', type: 'boolean' },
    { name: 'is_contiguous', type: 'boolean' },
    { name: 'is_complete', type: 'boolean' },
    { name: 'last_cursor', type: 'string', isOptional: true },
    { name: 'last_synced_at', type: 'number', isOptional: true },
    { name: 'created_at', type: 'number' },
    { name: 'updated_at', type: 'number' },
  ],
}

export const schema = appSchema({
  version: 2,
  tables: [
    tableSchema({
      name: TABLES.users,
      columns: [
        { name: 'email', type: 'string', isIndexed: true },
        { name: 'username', type: 'string', isOptional: true, isIndexed: true },
        { name: 'full_name', type: 'string', isOptional: true },
        { name: 'picture', type: 'string', isOptional: true },
        { name: 'is_verified', type: 'boolean' },
        { name: 'last_seen_at', type: 'number', isOptional: true },
        { name: 'server_updated_at', type: 'number', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: TABLES.conversations,
      columns: [
        { name: 'creator_id', type: 'string', isIndexed: true },
        { name: 'participant_ids', type: 'string' },
        { name: 'name', type: 'string', isOptional: true },
        { name: 'picture', type: 'string', isOptional: true },
        { name: 'is_group', type: 'boolean' },
        { name: 'last_message', type: 'string', isOptional: true },
        { name: 'last_message_at', type: 'number', isOptional: true, isIndexed: true },
        { name: 'unread_count', type: 'number' },
        { name: 'server_updated_at', type: 'number', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: TABLES.messages,
      columns: [
        { name: 'conversation_id', type: 'string', isIndexed: true },
        { name: 'sender_id', type: 'string', isIndexed: true },
        { name: 'client_message_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'content', type: 'string' },
        { name: 'media', type: 'string', isOptional: true },
        { name: 'type', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'read_by', type: 'string', isOptional: true },
        { name: 'reply_to_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'reply_preview', type: 'string', isOptional: true },
        { name: 'reactions', type: 'string', isOptional: true },
        { name: 'is_deleted', type: 'boolean' },
        { name: 'is_recalled', type: 'boolean' },
        { name: 'recalled_at', type: 'number', isOptional: true },
        { name: 'server_updated_at', type: 'number', isIndexed: true },
        { name: 'created_at', type: 'number', isIndexed: true },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema(MESSAGE_SYNC_RANGES_TABLE_SCHEMA),
  ],
})
