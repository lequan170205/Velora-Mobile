import { Q } from '@nozbe/watermelondb'

import { database } from '../DatabaseManager'
import { TABLES } from '../schema'

import type { CallTelemetryOutboxItemModel } from '../models/CallTelemetryOutboxItemModel'

export interface CallTelemetryOutboxItemInput {
  eventId: string
  payloadJson: string
  createdAt: number
  retryCount: number
  lastAttemptedAt: number | null
}

const collection = () => database.get<CallTelemetryOutboxItemModel>(TABLES.callTelemetryOutboxItems)

export const getCallTelemetryOutboxItems = async (limit: number) =>
  collection().query(Q.sortBy('created_at', Q.asc), Q.take(limit)).fetch()

export const getCallTelemetryOutboxCount = async () => (await collection().query().fetch()).length

export const insertCallTelemetryOutboxItems = async (inputs: CallTelemetryOutboxItemInput[]) => {
  if (inputs.length === 0) {
    return
  }

  await database.write(async () => {
    await database.batch(
      ...inputs.map((input) =>
        collection().prepareCreate((record) => {
          const raw = record._raw as Record<string, string | number | null>
          raw.id = input.eventId
          record.eventId = input.eventId
          record.payloadJson = input.payloadJson
          record.createdAt = input.createdAt
          record.retryCount = input.retryCount
          record.lastAttemptedAt = input.lastAttemptedAt
        }),
      ),
    )
  })
}

export const markCallTelemetryOutboxItemsAttempted = async (
  records: CallTelemetryOutboxItemModel[],
  attemptedAt: number,
) => {
  if (records.length === 0) {
    return
  }

  await database.write(async () => {
    await database.batch(
      ...records.map((record) =>
        record.prepareUpdate((draft) => {
          draft.retryCount += 1
          draft.lastAttemptedAt = attemptedAt
        }),
      ),
    )
  })
}

export const deleteCallTelemetryOutboxItems = async (records: CallTelemetryOutboxItemModel[]) => {
  if (records.length === 0) {
    return
  }

  await database.write(async () => {
    await database.batch(...records.map((record) => record.prepareDestroyPermanently()))
  })
}

export const dropOldestCallTelemetryQualitySamples = async (count: number) => {
  if (count <= 0) {
    return 0
  }

  const recordsToDelete = await collection()
    .query(
      Q.where('payload_json', Q.like('%"eventType":"quality_sample"%')),
      Q.sortBy('created_at', Q.asc),
      Q.take(count),
    )
    .fetch()
  await deleteCallTelemetryOutboxItems(recordsToDelete)
  return recordsToDelete.length
}
