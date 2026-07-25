import { appSchema, tableSchema } from '@nozbe/watermelondb'

import type { TableSchemaSpec } from '@nozbe/watermelondb/Schema'

export const TABLES = {
  users: 'users',
  conversations: 'conversations',
  messages: 'messages',
  messageSyncRanges: 'message_sync_ranges',
  cachedReels: 'cached_reels',
  cachedReelFeedPages: 'cached_reel_feed_pages',
  reelVideoCacheRecords: 'reel_video_cache_records',
  reelEventOutboxItems: 'reel_event_outbox_items',
  callTelemetryOutboxItems: 'call_telemetry_outbox_items',
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

export const CACHED_REELS_TABLE_SCHEMA: TableSchemaSpec = {
  name: TABLES.cachedReels,
  columns: [
    { name: 'reel_id', type: 'string', isIndexed: true },
    { name: 'user_id', type: 'string', isIndexed: true },
    { name: 'media_key', type: 'string' },
    { name: 'title', type: 'string', isOptional: true },
    { name: 'description', type: 'string', isOptional: true },
    { name: 'tags_json', type: 'string' },
    { name: 'status', type: 'string', isIndexed: true },
    { name: 'visibility', type: 'string', isIndexed: true },
    { name: 'view_count', type: 'number' },
    { name: 'thumbnail_key', type: 'string', isOptional: true },
    { name: 'thumbnail_url', type: 'string', isOptional: true },
    { name: 'local_thumbnail_uri', type: 'string', isOptional: true },
    { name: 'stream_url', type: 'string' },
    { name: 'author_json', type: 'string', isOptional: true },
    { name: 'recommendation_json', type: 'string', isOptional: true },
    { name: 'media_status', type: 'string', isOptional: true },
    { name: 'index_status', type: 'string', isOptional: true },
    { name: 'media_stage', type: 'string', isOptional: true },
    { name: 'media_progress', type: 'number', isOptional: true },
    { name: 'index_stage', type: 'string', isOptional: true },
    { name: 'index_progress', type: 'number', isOptional: true },
    { name: 'source_duration_ms', type: 'number', isOptional: true },
    { name: 'source_orientation', type: 'string', isOptional: true },
    { name: 'source_length_class', type: 'string', isOptional: true },
    { name: 'source_aspect_ratio', type: 'number', isOptional: true },
    { name: 'source_effective_width', type: 'number', isOptional: true },
    { name: 'source_effective_height', type: 'number', isOptional: true },
    { name: 'hls_master_url', type: 'string', isOptional: true },
    { name: 'caption_vtt_url', type: 'string', isOptional: true },
    { name: 'created_at_remote', type: 'string' },
    { name: 'cached_at', type: 'number', isIndexed: true },
    { name: 'last_accessed_at', type: 'number', isIndexed: true },
  ],
}

export const CACHED_REEL_FEED_PAGES_TABLE_SCHEMA: TableSchemaSpec = {
  name: TABLES.cachedReelFeedPages,
  columns: [
    { name: 'cache_key', type: 'string', isIndexed: true },
    { name: 'params_json', type: 'string' },
    { name: 'cursor', type: 'string', isOptional: true },
    { name: 'reel_ids_json', type: 'string' },
    { name: 'recommendations_json', type: 'string', isOptional: true },
    { name: 'next_cursor', type: 'string', isOptional: true },
    { name: 'feed_session_id', type: 'string', isOptional: true },
    { name: 'algorithm_version', type: 'string', isOptional: true },
    { name: 'generated_at', type: 'string', isOptional: true },
    { name: 'cached_at', type: 'number', isIndexed: true },
    { name: 'last_accessed_at', type: 'number', isIndexed: true },
  ],
}

export const REEL_VIDEO_CACHE_RECORDS_TABLE_SCHEMA: TableSchemaSpec = {
  name: TABLES.reelVideoCacheRecords,
  columns: [
    { name: 'reel_id', type: 'string', isIndexed: true },
    { name: 'stream_url', type: 'string' },
    { name: 'local_manifest_uri', type: 'string' },
    { name: 'local_thumbnail_uri', type: 'string', isOptional: true },
    { name: 'downloaded_at', type: 'number', isIndexed: true },
    { name: 'last_accessed_at', type: 'number', isIndexed: true },
    { name: 'segment_count', type: 'number' },
    { name: 'size_bytes', type: 'number' },
  ],
}

export const REEL_EVENT_OUTBOX_ITEMS_TABLE_SCHEMA: TableSchemaSpec = {
  name: TABLES.reelEventOutboxItems,
  columns: [
    { name: 'event_id', type: 'string', isIndexed: true },
    { name: 'reel_id', type: 'string', isIndexed: true },
    { name: 'session_id', type: 'string', isOptional: true },
    { name: 'event_type', type: 'string', isIndexed: true },
    { name: 'payload_json', type: 'string' },
    { name: 'created_at', type: 'number', isIndexed: true },
    { name: 'retry_count', type: 'number' },
    { name: 'last_attempted_at', type: 'number', isOptional: true },
  ],
}

export const CALL_TELEMETRY_OUTBOX_ITEMS_TABLE_SCHEMA: TableSchemaSpec = {
  name: TABLES.callTelemetryOutboxItems,
  columns: [
    { name: 'event_id', type: 'string', isIndexed: true },
    { name: 'payload_json', type: 'string' },
    { name: 'created_at', type: 'number', isIndexed: true },
    { name: 'retry_count', type: 'number' },
    { name: 'last_attempted_at', type: 'number', isOptional: true },
  ],
}

export const schema = appSchema({
  version: 7,
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
        { name: 'message_metadata', type: 'string', isOptional: true },
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
    tableSchema(CACHED_REELS_TABLE_SCHEMA),
    tableSchema(CACHED_REEL_FEED_PAGES_TABLE_SCHEMA),
    tableSchema(REEL_VIDEO_CACHE_RECORDS_TABLE_SCHEMA),
    tableSchema(REEL_EVENT_OUTBOX_ITEMS_TABLE_SCHEMA),
    tableSchema(CALL_TELEMETRY_OUTBOX_ITEMS_TABLE_SCHEMA),
  ],
})
