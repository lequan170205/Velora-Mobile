import type { MessageMetadata } from '../types/conversation.types'
import type {
  ReelAuthor,
  ReelFeedListItem,
  ReelProcessingState,
  ReelVisibility,
} from '../types/reel.types'

const MESSAGE_METADATA_KIND = 'velora_ai_reel_recommendations'
const REEL_STATUS_VALUES = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
const REEL_VISIBILITY_VALUES = new Set(['public', 'private'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getTrimmedString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

const getFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.reduce<string[]>((items, item) => {
    const normalizedItem = getTrimmedString(item)
    if (normalizedItem) {
      items.push(normalizedItem)
    }
    return items
  }, [])
}

const parseMetadataRecord = (value: unknown): Record<string, unknown> | null => {
  if (isRecord(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return null
  }

  try {
    const parsedValue = JSON.parse(trimmedValue)
    return isRecord(parsedValue) ? parsedValue : null
  } catch {
    return null
  }
}

const normalizeReelAuthor = (value: unknown): ReelAuthor | null => {
  if (!isRecord(value)) {
    return null
  }

  const username = getTrimmedString(value.username)
  const displayName = getTrimmedString(value.displayName)
  const avatarUrl = getTrimmedString(value.avatarUrl)
  const id =
    getTrimmedString(value.id) ??
    (username ? `username:${username}` : null) ??
    (displayName ? `display:${displayName}` : null) ??
    (avatarUrl ? `avatar:${avatarUrl}` : null)

  if (!id) {
    return null
  }

  return {
    id,
    username,
    displayName,
    avatarUrl,
    isVerified: typeof value.isVerified === 'boolean' ? value.isVerified : null,
  }
}

const normalizeReelFeedListItem = (value: unknown): ReelFeedListItem | null => {
  if (!isRecord(value)) {
    return null
  }

  const id = getTrimmedString(value.id)
  const userId = getTrimmedString(value.userId)
  const mediaKey = getTrimmedString(value.mediaKey)
  const status = getTrimmedString(value.status)
  const visibility = getTrimmedString(value.visibility)
  const viewCount = getFiniteNumber(value.viewCount)
  const streamUrl = getTrimmedString(value.streamUrl)
  const createdAt = getTrimmedString(value.createdAt)

  if (
    !id ||
    !userId ||
    !mediaKey ||
    !status ||
    !REEL_STATUS_VALUES.has(status) ||
    !visibility ||
    !REEL_VISIBILITY_VALUES.has(visibility) ||
    viewCount === null ||
    !streamUrl ||
    !createdAt
  ) {
    return null
  }

  const title = getTrimmedString(value.title)
  const description = getTrimmedString(value.description)
  const thumbnailKey = getTrimmedString(value.thumbnailKey)
  const thumbnailUrl = getTrimmedString(value.thumbnailUrl)
  const localThumbnailUri = getTrimmedString(value.localThumbnailUri)
  const offlineStreamUrl = getTrimmedString(value.offlineStreamUrl)
  const offlineThumbnailUrl = getTrimmedString(value.offlineThumbnailUrl)
  const processingStage = getTrimmedString(value.processingStage)
  const processingMessage = getTrimmedString(value.processingMessage)
  const processingProgress = getFiniteNumber(value.processingProgress)
  const stage = getTrimmedString(value.stage)
  const message = getTrimmedString(value.message)
  const progress = getFiniteNumber(value.progress)
  const author = normalizeReelAuthor(value.author)

  return {
    id,
    userId,
    mediaKey,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    tags: normalizeStringArray(value.tags),
    status: status as ReelProcessingState,
    visibility: visibility as ReelVisibility,
    viewCount,
    ...(thumbnailKey ? { thumbnailKey } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(localThumbnailUri ? { localThumbnailUri } : {}),
    ...(offlineStreamUrl ? { offlineStreamUrl } : {}),
    ...(offlineThumbnailUrl ? { offlineThumbnailUrl } : {}),
    ...(processingStage ? { processingStage } : {}),
    ...(processingMessage ? { processingMessage } : {}),
    ...(processingProgress !== null ? { processingProgress } : {}),
    ...(stage ? { stage } : {}),
    ...(message ? { message } : {}),
    ...(progress !== null ? { progress } : {}),
    streamUrl,
    createdAt,
    ...(author || value.author === null ? { author } : {}),
  }
}

export const normalizeMessageMetadata = (value: unknown): MessageMetadata | undefined => {
  const rawValue = parseMetadataRecord(value)
  if (!rawValue) {
    return undefined
  }

  const rawKind =
    getTrimmedString(rawValue.kind) ??
    getTrimmedString(rawValue.metadataKind) ??
    getTrimmedString(rawValue.metadata_kind)
  const recommendedReelsSource = Array.isArray(rawValue.recommendedReels)
    ? rawValue.recommendedReels
    : Array.isArray(rawValue.recommended_reels)
      ? rawValue.recommended_reels
      : undefined
  const suggestedQueriesSource = Array.isArray(rawValue.suggestedQueries)
    ? rawValue.suggestedQueries
    : Array.isArray(rawValue.suggested_queries)
      ? rawValue.suggested_queries
      : undefined
  const recommendedReels = recommendedReelsSource
    ? recommendedReelsSource
        .map((reel) => normalizeReelFeedListItem(reel))
        .filter((reel): reel is ReelFeedListItem => Boolean(reel))
    : undefined
  const suggestedQueries =
    suggestedQueriesSource !== undefined ? normalizeStringArray(suggestedQueriesSource) : undefined
  const kind =
    rawKind === MESSAGE_METADATA_KIND
      ? rawKind
      : recommendedReelsSource !== undefined || suggestedQueriesSource !== undefined
        ? MESSAGE_METADATA_KIND
        : undefined

  if (!kind && recommendedReels === undefined && suggestedQueries === undefined) {
    return undefined
  }

  return {
    ...(kind ? { kind } : {}),
    ...(recommendedReels !== undefined ? { recommendedReels } : {}),
    ...(suggestedQueries !== undefined ? { suggestedQueries } : {}),
  }
}
