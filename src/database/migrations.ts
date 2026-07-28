import { addColumns, createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations'

import {
  CACHED_REEL_FEED_PAGES_TABLE_SCHEMA,
  CALL_TELEMETRY_OUTBOX_ITEMS_TABLE_SCHEMA,
  CACHED_REELS_TABLE_SCHEMA,
  MESSAGE_SYNC_RANGES_TABLE_SCHEMA,
  REEL_EVENT_OUTBOX_ITEMS_TABLE_SCHEMA,
  REEL_VIDEO_CACHE_RECORDS_TABLE_SCHEMA,
  TABLES,
} from './schema'

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [createTable(MESSAGE_SYNC_RANGES_TABLE_SCHEMA)],
    },
    {
      toVersion: 3,
      steps: [
        createTable(CACHED_REELS_TABLE_SCHEMA),
        createTable(CACHED_REEL_FEED_PAGES_TABLE_SCHEMA),
        createTable(REEL_VIDEO_CACHE_RECORDS_TABLE_SCHEMA),
        createTable(REEL_EVENT_OUTBOX_ITEMS_TABLE_SCHEMA),
      ],
    },
    {
      toVersion: 4,
      steps: [
        addColumns({
          table: TABLES.messages,
          columns: [{ name: 'message_metadata', type: 'string', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 5,
      steps: [createTable(CALL_TELEMETRY_OUTBOX_ITEMS_TABLE_SCHEMA)],
    },
    {
      toVersion: 6,
      steps: [
        addColumns({
          table: TABLES.cachedReels,
          columns: [{ name: 'recommendation_json', type: 'string', isOptional: true }],
        }),
        addColumns({
          table: TABLES.cachedReelFeedPages,
          columns: [
            { name: 'recommendations_json', type: 'string', isOptional: true },
            { name: 'feed_session_id', type: 'string', isOptional: true },
            { name: 'algorithm_version', type: 'string', isOptional: true },
            { name: 'generated_at', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 7,
      steps: [
        addColumns({
          table: TABLES.cachedReels,
          columns: [
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
          ],
        }),
      ],
    },
  ],
})
