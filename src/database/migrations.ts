import { createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations'

import { MESSAGE_SYNC_RANGES_TABLE_SCHEMA } from './schema'

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [createTable(MESSAGE_SYNC_RANGES_TABLE_SCHEMA)],
    },
  ],
})
