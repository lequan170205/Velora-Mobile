import type {
  Reel,
  ReelIndexStatus,
  ReelMediaStatus,
  ReelProcessingState,
  ReelProcessingStatusResponse,
} from '../types/reel.types'

export type NormalizedReelProcessingState = {
  mediaStatus: ReelMediaStatus
  indexStatus: ReelIndexStatus
  isPlayable: boolean
  isSemanticReady: boolean
}

type ReelProcessingStateInput = Pick<Reel, 'status' | 'streamUrl'> & {
  mediaStatus?: ReelMediaStatus | undefined
  indexStatus?: ReelIndexStatus | undefined
  hlsMasterKey?: string | undefined
  hlsMasterUrl?: string | undefined
}

const MEDIA_STATUSES: ReelMediaStatus[] = [
  'PENDING',
  'PROBING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]
const INDEX_STATUSES: ReelIndexStatus[] = [
  'NOT_REQUESTED',
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'DEGRADED',
  'FAILED',
]

const isMediaStatus = (value: unknown): value is ReelMediaStatus =>
  typeof value === 'string' && MEDIA_STATUSES.includes(value as ReelMediaStatus)

const isIndexStatus = (value: unknown): value is ReelIndexStatus =>
  typeof value === 'string' && INDEX_STATUSES.includes(value as ReelIndexStatus)

export const mapLegacyProcessingStatusToMediaStatus = (
  status?: ReelProcessingState | null,
): ReelMediaStatus => {
  switch (status) {
    case 'COMPLETED':
      return 'COMPLETED'
    case 'FAILED':
      return 'FAILED'
    case 'PROCESSING':
      return 'PROCESSING'
    case 'PENDING':
    default:
      return 'PENDING'
  }
}

export const deriveLegacyIndexStatus = (status?: ReelProcessingState | null): ReelIndexStatus =>
  status === 'COMPLETED' ? 'COMPLETED' : 'NOT_REQUESTED'

const toLegacyProcessingStatus = (mediaStatus: ReelMediaStatus): ReelProcessingState => {
  switch (mediaStatus) {
    case 'COMPLETED':
      return 'COMPLETED'
    case 'FAILED':
      return 'FAILED'
    case 'PENDING':
    case 'PROBING':
      return 'PENDING'
    case 'PROCESSING':
    default:
      return 'PROCESSING'
  }
}

export const normalizeReelProcessingState = (
  reel: ReelProcessingStateInput,
): NormalizedReelProcessingState => {
  const mediaStatus: ReelMediaStatus = isMediaStatus(reel.mediaStatus)
    ? reel.mediaStatus
    : mapLegacyProcessingStatusToMediaStatus(reel.status)
  const indexStatus: ReelIndexStatus = isIndexStatus(reel.indexStatus)
    ? reel.indexStatus
    : deriveLegacyIndexStatus(reel.status)

  return {
    mediaStatus,
    indexStatus,
    isPlayable:
      mediaStatus === 'COMPLETED' &&
      Boolean(reel.hlsMasterUrl || reel.hlsMasterKey || reel.streamUrl),
    isSemanticReady: indexStatus === 'COMPLETED',
  }
}

export const normalizeReelApiResponse = <T extends Reel>(reel: T): T => {
  const processing = normalizeReelProcessingState(reel)
  const hlsMasterUrl = reel.hlsMasterUrl || reel.streamUrl

  return {
    ...reel,
    status: toLegacyProcessingStatus(processing.mediaStatus),
    mediaStatus: processing.mediaStatus,
    indexStatus: processing.indexStatus,
    ...(hlsMasterUrl ? { hlsMasterUrl, streamUrl: hlsMasterUrl } : {}),
  } as T
}

export const normalizeReelProcessingStatusResponse = (
  status: ReelProcessingStatusResponse,
): ReelProcessingStatusResponse => {
  const normalized = normalizeReelProcessingState({
    status: status.status ?? 'PENDING',
    mediaStatus: status.mediaStatus,
    indexStatus: status.indexStatus,
    hlsMasterKey: status.hlsMasterKey,
    hlsMasterUrl: status.hlsMasterUrl,
    streamUrl: status.streamUrl ?? '',
  })

  return {
    ...status,
    status: toLegacyProcessingStatus(normalized.mediaStatus),
    mediaStatus: normalized.mediaStatus,
    indexStatus: normalized.indexStatus,
    ...(status.hlsMasterUrl || status.streamUrl
      ? {
          hlsMasterUrl: status.hlsMasterUrl ?? status.streamUrl,
          streamUrl: status.hlsMasterUrl ?? status.streamUrl,
        }
      : {}),
  }
}

export const mergeReelProcessingStatus = <T extends Reel>(
  reel: T,
  status: ReelProcessingStatusResponse,
): T => {
  const normalizedStatus = normalizeReelProcessingStatusResponse(status)
  const processing = normalizeReelProcessingState({
    status: normalizedStatus.status ?? 'PENDING',
    ...(normalizedStatus.mediaStatus ? { mediaStatus: normalizedStatus.mediaStatus } : {}),
    ...(normalizedStatus.indexStatus ? { indexStatus: normalizedStatus.indexStatus } : {}),
    ...(normalizedStatus.hlsMasterKey ? { hlsMasterKey: normalizedStatus.hlsMasterKey } : {}),
    ...(normalizedStatus.hlsMasterUrl ? { hlsMasterUrl: normalizedStatus.hlsMasterUrl } : {}),
    streamUrl: normalizedStatus.streamUrl ?? reel.streamUrl,
  })
  const merged = normalizeReelApiResponse({
    ...reel,
    id: normalizedStatus.reelId || reel.id,
    ...(normalizedStatus.mediaKey ? { mediaKey: normalizedStatus.mediaKey } : {}),
    ...(normalizedStatus.thumbnailKey ? { thumbnailKey: normalizedStatus.thumbnailKey } : {}),
    ...(normalizedStatus.thumbnailUrl ? { thumbnailUrl: normalizedStatus.thumbnailUrl } : {}),
    ...(normalizedStatus.streamUrl ? { streamUrl: normalizedStatus.streamUrl } : {}),
    ...(normalizedStatus.hlsMasterKey ? { hlsMasterKey: normalizedStatus.hlsMasterKey } : {}),
    ...(normalizedStatus.hlsMasterUrl ? { hlsMasterUrl: normalizedStatus.hlsMasterUrl } : {}),
    ...(normalizedStatus.mediaStage ? { mediaStage: normalizedStatus.mediaStage } : {}),
    ...(normalizedStatus.mediaMessage ? { mediaMessage: normalizedStatus.mediaMessage } : {}),
    ...(typeof normalizedStatus.mediaProgress === 'number'
      ? { mediaProgress: normalizedStatus.mediaProgress }
      : {}),
    ...(normalizedStatus.indexStage ? { indexStage: normalizedStatus.indexStage } : {}),
    ...(normalizedStatus.indexMessage ? { indexMessage: normalizedStatus.indexMessage } : {}),
    ...(typeof normalizedStatus.indexProgress === 'number'
      ? { indexProgress: normalizedStatus.indexProgress }
      : {}),
    mediaStatus: processing.mediaStatus,
    indexStatus: processing.indexStatus,
    ...(normalizedStatus.stage
      ? { stage: normalizedStatus.stage, processingStage: normalizedStatus.stage }
      : {}),
    ...(normalizedStatus.message
      ? { message: normalizedStatus.message, processingMessage: normalizedStatus.message }
      : {}),
    ...(typeof normalizedStatus.progress === 'number'
      ? { progress: normalizedStatus.progress, processingProgress: normalizedStatus.progress }
      : {}),
  })

  return merged as T
}

export const isReelPlayable = (reel: Reel) => normalizeReelProcessingState(reel).isPlayable
export const isReelMediaProcessing = (reel: Reel) => {
  const { mediaStatus } = normalizeReelProcessingState(reel)
  return mediaStatus === 'PENDING' || mediaStatus === 'PROBING' || mediaStatus === 'PROCESSING'
}
export const isReelMediaFailed = (reel: Reel) =>
  normalizeReelProcessingState(reel).mediaStatus === 'FAILED'
export const isReelIndexing = (reel: Reel) => {
  const { indexStatus } = normalizeReelProcessingState(reel)
  return indexStatus === 'PENDING' || indexStatus === 'PROCESSING'
}
export const isReelSemanticReady = (reel: Reel) =>
  normalizeReelProcessingState(reel).isSemanticReady
export const isReelSemanticUnavailable = (reel: Reel) => {
  const { indexStatus } = normalizeReelProcessingState(reel)
  return indexStatus === 'DEGRADED' || indexStatus === 'FAILED'
}
export const isLongVideo = (reel: Reel) => reel.sourceLengthClass === 'LONG'
export const isLandscapeVideo = (reel: Reel) => reel.sourceOrientation === 'LANDSCAPE'
export const shouldOpenDedicatedPlayer = (reel: Reel) => isLongVideo(reel)
