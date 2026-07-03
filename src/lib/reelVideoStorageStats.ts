import { getAllReelVideoCacheRecords } from '../database/reels/reelOfflineStore'

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

export interface SavedReelVideoStorageStats {
  videoCount: number
  sizeBytes: number
  sizeLabel: string
}

const formatSizeLabel = (sizeBytes: number) => {
  if (sizeBytes >= GB) {
    const sizeGb = sizeBytes / GB
    return `${sizeGb >= 10 ? Math.round(sizeGb) : sizeGb.toFixed(1)} GB`
  }

  if (sizeBytes >= MB) {
    return `${Math.max(1, Math.round(sizeBytes / MB))} MB`
  }

  if (sizeBytes >= KB) {
    return `${Math.max(1, Math.round(sizeBytes / KB))} KB`
  }

  return '0 MB'
}

export const getSavedReelVideoStorageStats = async (): Promise<SavedReelVideoStorageStats> => {
  const records = await getAllReelVideoCacheRecords()
  const sizeBytes = records.reduce((sum, record) => sum + record.sizeBytes, 0)

  return {
    videoCount: records.length,
    sizeBytes,
    sizeLabel: formatSizeLabel(sizeBytes),
  }
}
