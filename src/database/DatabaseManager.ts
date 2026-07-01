import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'

import { migrations } from './migrations'
import { ConversationModel } from './models/ConversationModel'
import { MessageModel } from './models/MessageModel'
import { MessageSyncRangeModel } from './models/MessageSyncRangeModel'
import { UserModel } from './models/UserModel'
import { schema } from './schema'

const DATABASE_NAME = 'velora_messages'

export class DatabaseManager {
  private static instance: DatabaseManager | null = null

  readonly database: Database

  private constructor() {
    const adapter = new SQLiteAdapter({
      dbName: DATABASE_NAME,
      migrations,
      schema,
      jsi: false,
      onSetUpError: (error) => {
        console.error('[WatermelonDB] Failed to initialize local database', error)
      },
    })

    this.database = new Database({
      adapter,
      modelClasses: [UserModel, ConversationModel, MessageModel, MessageSyncRangeModel],
    })
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager()
    }

    return DatabaseManager.instance
  }
}

export const databaseManager = DatabaseManager.getInstance()
export const database = databaseManager.database

export const resetLocalDatabase = async () => {
  await database.write(async () => {
    await database.unsafeResetDatabase()
  })
}
