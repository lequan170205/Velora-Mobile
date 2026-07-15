import { Q } from '@nozbe/watermelondb'

import type { Collection, Model } from '@nozbe/watermelondb'

import { database } from '../DatabaseManager'
import { TABLES } from '../schema'

import type { CachedReelFeedPageInput, CachedReelInput } from './reelCacheMappers'
import type { CachedReelFeedPageModel } from '../models/CachedReelFeedPageModel'
import type { CachedReelModel } from '../models/CachedReelModel'
import type { ReelEventOutboxItemModel } from '../models/ReelEventOutboxItemModel'
import type { ReelVideoCacheRecordModel } from '../models/ReelVideoCacheRecordModel'

export interface ReelVideoCacheRecordInput {
  reelId: string
  streamUrl: string
  localManifestUri: string
  localThumbnailUri: string | null
  downloadedAt: number
  lastAccessedAt: number
  segmentCount: number
  sizeBytes: number
}

export interface ReelEventOutboxItemInput {
  eventId: string
  reelId: string
  sessionId: string | null
  eventType: string
  payloadJson: string
  createdAt: number
  retryCount: number
  lastAttemptedAt: number | null
}

const getCachedReelsCollection = () => database.get<CachedReelModel>(TABLES.cachedReels)
const getCachedFeedPagesCollection = () =>
  database.get<CachedReelFeedPageModel>(TABLES.cachedReelFeedPages)
const getReelVideoCacheRecordsCollection = () =>
  database.get<ReelVideoCacheRecordModel>(TABLES.reelVideoCacheRecords)
const getReelEventOutboxCollection = () =>
  database.get<ReelEventOutboxItemModel>(TABLES.reelEventOutboxItems)

const applyCachedReelInput = (record: CachedReelModel, input: CachedReelInput) => {
  record.reelId = input.reelId
  record.userId = input.userId
  record.mediaKey = input.mediaKey
  record.title = input.title
  record.description = input.description
  record.tagsJson = input.tagsJson
  record.status = input.status
  record.visibility = input.visibility
  record.viewCount = input.viewCount
  record.thumbnailKey = input.thumbnailKey
  record.thumbnailUrl = input.thumbnailUrl
  record.localThumbnailUri = input.localThumbnailUri
  record.streamUrl = input.streamUrl
  record.authorJson = input.authorJson
  record.recommendationJson = input.recommendationJson
  record.createdAtRemote = input.createdAtRemote
  record.cachedAt = input.cachedAt
  record.lastAccessedAt = input.lastAccessedAt
}

const applyCachedReelFeedPageInput = (
  record: CachedReelFeedPageModel,
  input: CachedReelFeedPageInput,
) => {
  record.cacheKey = input.cacheKey
  record.paramsJson = input.paramsJson
  record.cursor = input.cursor
  record.reelIdsJson = input.reelIdsJson
  record.recommendationsJson = input.recommendationsJson
  record.nextCursor = input.nextCursor
  record.feedSessionId = input.feedSessionId
  record.algorithmVersion = input.algorithmVersion
  record.generatedAt = input.generatedAt
  record.cachedAt = input.cachedAt
  record.lastAccessedAt = input.lastAccessedAt
}

const applyReelVideoCacheRecordInput = (
  record: ReelVideoCacheRecordModel,
  input: ReelVideoCacheRecordInput,
) => {
  record.reelId = input.reelId
  record.streamUrl = input.streamUrl
  record.localManifestUri = input.localManifestUri
  record.localThumbnailUri = input.localThumbnailUri
  record.downloadedAt = input.downloadedAt
  record.lastAccessedAt = input.lastAccessedAt
  record.segmentCount = input.segmentCount
  record.sizeBytes = input.sizeBytes
}

const applyReelEventOutboxItemInput = (
  record: ReelEventOutboxItemModel,
  input: ReelEventOutboxItemInput,
) => {
  record.eventId = input.eventId
  record.reelId = input.reelId
  record.sessionId = input.sessionId
  record.eventType = input.eventType
  record.payloadJson = input.payloadJson
  record.createdAt = input.createdAt
  record.retryCount = input.retryCount
  record.lastAttemptedAt = input.lastAttemptedAt
}

const fetchSingleByStringField = async <T extends Model>(
  collection: Collection<T>,
  field: string,
  value: string,
) => {
  const records = await collection.query(Q.where(field, value), Q.take(1)).fetch()
  return records[0] ?? null
}

export const findCachedReelFeedPageByCacheKey = async (cacheKey: string) =>
  fetchSingleByStringField<CachedReelFeedPageModel>(
    getCachedFeedPagesCollection(),
    'cache_key',
    cacheKey,
  )

export const findReelVideoCacheRecordByReelId = async (reelId: string) =>
  fetchSingleByStringField<ReelVideoCacheRecordModel>(
    getReelVideoCacheRecordsCollection(),
    'reel_id',
    reelId,
  )

export const getCachedReelsByReelIds = async (reelIds: string[]) => {
  if (reelIds.length === 0) {
    return []
  }

  return getCachedReelsCollection()
    .query(Q.where('reel_id', Q.oneOf(reelIds)))
    .fetch()
}

export const getAllCachedReels = async () => getCachedReelsCollection().query().fetch()

export const getAllCachedReelFeedPages = async () => getCachedFeedPagesCollection().query().fetch()

export const getAllReelVideoCacheRecords = async () =>
  getReelVideoCacheRecordsCollection().query().fetch()

export const getReelEventOutboxItems = async (limit?: number) =>
  getReelEventOutboxCollection()
    .query(Q.sortBy('created_at', Q.asc), ...(limit ? [Q.take(limit)] : []))
    .fetch()

export const getReelEventOutboxCount = async () =>
  (await getReelEventOutboxCollection().query().fetch()).length

export const upsertCachedReels = async (inputs: CachedReelInput[]) => {
  if (inputs.length === 0) {
    return
  }

  const existingRecords = await getCachedReelsByReelIds(inputs.map((input) => input.reelId))
  const existingByReelId = new Map(existingRecords.map((record) => [record.reelId, record]))

  await database.write(async () => {
    await database.batch(
      ...inputs.map((input) => {
        const existingRecord = existingByReelId.get(input.reelId)

        if (existingRecord) {
          return existingRecord.prepareUpdate((record) => {
            applyCachedReelInput(record, input)
          })
        }

        return getCachedReelsCollection().prepareCreate((record) => {
          const raw = record._raw as Record<string, string | number | null>
          raw.id = input.reelId
          applyCachedReelInput(record, input)
        })
      }),
    )
  })
}

export const upsertCachedReelFeedPage = async (input: CachedReelFeedPageInput) => {
  const existingRecord = await findCachedReelFeedPageByCacheKey(input.cacheKey)

  await database.write(async () => {
    if (existingRecord) {
      await existingRecord.update((record) => {
        applyCachedReelFeedPageInput(record, input)
      })
      return
    }

    await getCachedFeedPagesCollection().create((record) => {
      applyCachedReelFeedPageInput(record, input)
    })
  })
}

export const touchCachedReelFeedPageAndReels = async ({
  page,
  reels,
  touchedAt,
}: {
  page: CachedReelFeedPageModel
  reels: CachedReelModel[]
  touchedAt: number
}) => {
  await database.write(async () => {
    await database.batch(
      page.prepareUpdate((record) => {
        record.lastAccessedAt = touchedAt
      }),
      ...reels.map((reel) =>
        reel.prepareUpdate((record) => {
          record.lastAccessedAt = touchedAt
        }),
      ),
    )
  })
}

export const deleteCachedReelFeedPages = async (records: CachedReelFeedPageModel[]) => {
  if (records.length === 0) {
    return
  }

  await database.write(async () => {
    await database.batch(...records.map((record) => record.prepareDestroyPermanently()))
  })
}

export const deleteCachedReels = async (records: CachedReelModel[]) => {
  if (records.length === 0) {
    return
  }

  await database.write(async () => {
    await database.batch(...records.map((record) => record.prepareDestroyPermanently()))
  })
}

export const upsertReelVideoCacheRecord = async (input: ReelVideoCacheRecordInput) => {
  const existingRecord = await findReelVideoCacheRecordByReelId(input.reelId)

  await database.write(async () => {
    if (existingRecord) {
      await existingRecord.update((record) => {
        applyReelVideoCacheRecordInput(record, input)
      })
      return
    }

    await getReelVideoCacheRecordsCollection().create((record) => {
      const raw = record._raw as Record<string, string | number | null>
      raw.id = input.reelId
      applyReelVideoCacheRecordInput(record, input)
    })
  })
}

export const deleteReelVideoCacheRecords = async (records: ReelVideoCacheRecordModel[]) => {
  if (records.length === 0) {
    return
  }

  await database.write(async () => {
    await database.batch(...records.map((record) => record.prepareDestroyPermanently()))
  })
}

export const insertReelEventOutboxItems = async (inputs: ReelEventOutboxItemInput[]) => {
  if (inputs.length === 0) {
    return
  }

  await database.write(async () => {
    await database.batch(
      ...inputs.map((input) =>
        getReelEventOutboxCollection().prepareCreate((record) => {
          const raw = record._raw as Record<string, string | number | null>
          raw.id = input.eventId
          applyReelEventOutboxItemInput(record, input)
        }),
      ),
    )
  })
}

export const markReelEventOutboxItemsAttempted = async (
  records: ReelEventOutboxItemModel[],
  attemptedAt: number,
) => {
  if (records.length === 0) {
    return
  }

  await database.write(async () => {
    await database.batch(
      ...records.map((record) =>
        record.prepareUpdate((draft) => {
          draft.retryCount = draft.retryCount + 1
          draft.lastAttemptedAt = attemptedAt
        }),
      ),
    )
  })
}

export const deleteReelEventOutboxItems = async (records: ReelEventOutboxItemModel[]) => {
  if (records.length === 0) {
    return
  }

  await database.write(async () => {
    await database.batch(...records.map((record) => record.prepareDestroyPermanently()))
  })
}
