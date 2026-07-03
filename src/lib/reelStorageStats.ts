import {
  getAllCachedReelFeedPages,
  getAllCachedReels,
  getAllReelVideoCacheRecords,
  getReelEventOutboxCount,
} from '../database/reels/reelOfflineStore'

type LegacyFileInfo =
  | {
      exists: true
      isDirectory?: boolean
      size?: number
      uri?: string
    }
  | {
      exists: false
      isDirectory?: false
      size?: undefined
      uri?: string
    }

type LegacyFileSystemModule = {
  getInfoAsync: (uri: string) => Promise<LegacyFileInfo>
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const FileSystem = require('expo-file-system/legacy') as LegacyFileSystemModule

const MB = 1024 * 1024

export interface ReelStorageStats {
  cachedReelsCount: number
  cachedFeedPagesCount: number
  videoCacheRecordsCount: number
  videoCacheSizeBytes: number
  videoCacheSizeMb: number
  outboxEventCount: number
  missingVideoFileCount: number
  oldestVideoCacheAccessedAt: number | null
  newestVideoCacheAccessedAt: number | null
}

const fileExists = async (uri: string) => {
  try {
    const info = await FileSystem.getInfoAsync(uri)
    return info.exists === true
  } catch {
    return false
  }
}

export const getReelStorageStats = async (): Promise<ReelStorageStats> => {
  const [cachedReels, cachedFeedPages, videoCacheRecords, outboxEventCount] = await Promise.all([
    getAllCachedReels(),
    getAllCachedReelFeedPages(),
    getAllReelVideoCacheRecords(),
    getReelEventOutboxCount(),
  ])

  const missingVideoFileCount = (
    await Promise.all(videoCacheRecords.map((record) => fileExists(record.localManifestUri)))
  ).filter((exists) => !exists).length

  const videoCacheSizeBytes = videoCacheRecords.reduce((sum, record) => sum + record.sizeBytes, 0)
  const accessedAtValues = videoCacheRecords
    .map((record) => record.lastAccessedAt)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)

  return {
    cachedReelsCount: cachedReels.length,
    cachedFeedPagesCount: cachedFeedPages.length,
    videoCacheRecordsCount: videoCacheRecords.length,
    videoCacheSizeBytes,
    videoCacheSizeMb: Math.round((videoCacheSizeBytes / MB) * 100) / 100,
    outboxEventCount,
    missingVideoFileCount,
    oldestVideoCacheAccessedAt: accessedAtValues[0] ?? null,
    newestVideoCacheAccessedAt: accessedAtValues[accessedAtValues.length - 1] ?? null,
  }
}
