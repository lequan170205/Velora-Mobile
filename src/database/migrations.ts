import { addColumns, createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations'

import {
  CACHED_REEL_FEED_PAGES_TABLE_SCHEMA,
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
  ],
})
