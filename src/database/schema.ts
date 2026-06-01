import { appSchema, tableSchema } from '@nozbe/watermelondb'

export const TABLES = {
  users: 'users',
  conversations: 'conversations',
  messages: 'messages',
} as const

export const schema = appSchema({
  version: 1,
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
  ],
})
