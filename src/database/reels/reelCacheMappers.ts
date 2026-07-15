import { DEFAULT_REELS_LIMIT } from '../../constants/reels'

import type { RecommendationMetadata } from '../../types/recommendation.types'
import type {
  ListReelsParams,
  Reel,
  ReelAuthor,
  ReelProcessingState,
  ReelVisibility,
} from '../../types/reel.types'
import type { CachedReelFeedPageModel } from '../models/CachedReelFeedPageModel'
import type { CachedReelModel } from '../models/CachedReelModel'

export interface CacheableFeedParams extends Omit<ListReelsParams, 'cursor'> {
  excludeRecentlySeen?: boolean
  feedSessionId?: string
  recommended?: boolean
}

export interface CachedReelInput {
  reelId: string
  userId: string
  mediaKey: string
  title: string | null
  description: string | null
  tagsJson: string
  status: string
  visibility: string
  viewCount: number
  thumbnailKey: string | null
  thumbnailUrl: string | null
  localThumbnailUri: string | null
  streamUrl: string
  authorJson: string | null
  recommendationJson: string | null
  createdAtRemote: string
  cachedAt: number
  lastAccessedAt: number
}

export interface CachedReelFeedPageInput {
  cacheKey: string
  paramsJson: string
  cursor: string | null
  reelIdsJson: string
  recommendationsJson: string | null
  nextCursor: string | null
  feedSessionId: string | null
  algorithmVersion: string | null
  generatedAt: string | null
  cachedAt: number
  lastAccessedAt: number
}

const FEED_CACHE_KEY_PREFIX = '@velora/reels/feed-page/v2'

const REEL_STATUS_VALUES: ReelProcessingState[] = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']
const REEL_VISIBILITY_VALUES: ReelVisibility[] = ['public', 'private']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const safeParseJson = (value: string | null): unknown => {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const toNullableTrimmedString = (value: unknown) => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

const stableStringify = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = value[key]
        return result
      }, {}),
  )

export const normalizeFeedParams = (params: CacheableFeedParams = {}) => ({
  limit: params.limit ?? DEFAULT_REELS_LIMIT,
  ...(params.userId ? { userId: params.userId } : {}),
  ...(params.visibility ? { visibility: params.visibility } : {}),
  ...(params.ranked !== undefined ? { ranked: params.ranked } : {}),
  ...(params.excludeRecentlySeen !== undefined
    ? { excludeRecentlySeen: params.excludeRecentlySeen }
    : {}),
  ...(params.feedSessionId ? { feedSessionId: params.feedSessionId } : {}),
  ...(params.recommended ? { recommended: true } : {}),
})

export const serializeAuthor = (author?: ReelAuthor | null) => {
  if (!author) {
    return null
  }

  return JSON.stringify({
    id: author.id,
    username: author.username,
    displayName: author.displayName,
    avatarUrl: author.avatarUrl,
    isVerified: author.isVerified,
  })
}

export const deserializeAuthor = (authorJson: string | null): ReelAuthor | null => {
  const parsed = safeParseJson(authorJson)

  if (!isRecord(parsed)) {
    return null
  }

  const id = toNullableTrimmedString(parsed.id)

  if (!id) {
    return null
  }

  const isVerified = typeof parsed.isVerified === 'boolean' ? parsed.isVerified : null

  return {
    id,
    username: toNullableTrimmedString(parsed.username),
    displayName: toNullableTrimmedString(parsed.displayName),
    avatarUrl: toNullableTrimmedString(parsed.avatarUrl),
    isVerified,
  }
}

export const serializeTags = (tags: string[]) =>
  JSON.stringify(Array.from(new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))))

export const deserializeTags = (tagsJson: string | null) => {
  const parsed = safeParseJson(tagsJson)

  if (!Array.isArray(parsed)) {
    return []
  }

  return Array.from(
    new Set(
      parsed
        .map((tag) => toNullableTrimmedString(tag))
        .filter((tag): tag is string => tag !== null),
    ),
  )
}

export const serializeFeedParams = (params: CacheableFeedParams = {}) =>
  stableStringify(normalizeFeedParams(params))

export const deserializeFeedParams = (paramsJson: string | null): CacheableFeedParams => {
  const parsed = safeParseJson(paramsJson)

  if (!isRecord(parsed)) {
    return normalizeFeedParams({})
  }

  const limit =
    typeof parsed.limit === 'number' && Number.isFinite(parsed.limit) ? parsed.limit : undefined
  const userId = toNullableTrimmedString(parsed.userId)
  const visibility = toNullableTrimmedString(parsed.visibility)
  const ranked = typeof parsed.ranked === 'boolean' ? parsed.ranked : undefined
  const excludeRecentlySeen =
    typeof parsed.excludeRecentlySeen === 'boolean' ? parsed.excludeRecentlySeen : undefined
  const feedSessionId = toNullableTrimmedString(parsed.feedSessionId)
  const recommended = parsed.recommended === true

  return normalizeFeedParams({
    ...(limit !== undefined ? { limit } : {}),
    ...(userId ? { userId } : {}),
    ...(visibility && REEL_VISIBILITY_VALUES.includes(visibility as ReelVisibility)
      ? { visibility: visibility as ReelVisibility }
      : {}),
    ...(ranked !== undefined ? { ranked } : {}),
    ...(excludeRecentlySeen !== undefined ? { excludeRecentlySeen } : {}),
    ...(feedSessionId ? { feedSessionId } : {}),
    ...(recommended ? { recommended: true } : {}),
  })
}

export const serializeRecommendationMetadata = (recommendation?: RecommendationMetadata) =>
  recommendation ? JSON.stringify(recommendation) : null

export const deserializeRecommendationMetadata = (value: string | null) => {
  const parsed = safeParseJson(value)

  if (!isRecord(parsed)) {
    return undefined
  }

  const recommendationId = toNullableTrimmedString(parsed.recommendationId)
  const feedSessionId = toNullableTrimmedString(parsed.feedSessionId)
  const algorithmVersion = toNullableTrimmedString(parsed.algorithmVersion)
  const candidateSource = toNullableTrimmedString(parsed.candidateSource)
  const generatedAt = toNullableTrimmedString(parsed.generatedAt)
  const rank = parsed.rank

  if (
    !recommendationId ||
    !feedSessionId ||
    !algorithmVersion ||
    !candidateSource ||
    !generatedAt ||
    typeof rank !== 'number' ||
    !Number.isFinite(rank)
  ) {
    return undefined
  }

  return {
    recommendationId,
    feedSessionId,
    algorithmVersion,
    candidateSource,
    rank,
    generatedAt,
  }
}

export const serializeReelRecommendations = (reels: Reel[]) => {
  const recommendations = reels.reduce<Record<string, RecommendationMetadata>>((result, reel) => {
    if (reel.recommendation) {
      result[reel.id] = reel.recommendation
    }

    return result
  }, {})

  return Object.keys(recommendations).length > 0 ? JSON.stringify(recommendations) : null
}

export const deserializeReelRecommendations = (value: string | null) => {
  const parsed = safeParseJson(value)

  if (!isRecord(parsed)) {
    return {} as Record<string, RecommendationMetadata>
  }

  return Object.entries(parsed).reduce<Record<string, RecommendationMetadata>>((result, entry) => {
    const [reelId, recommendation] = entry
    const serializedRecommendation =
      recommendation && typeof recommendation === 'object' ? JSON.stringify(recommendation) : null
    const parsedRecommendation = deserializeRecommendationMetadata(serializedRecommendation)

    if (parsedRecommendation) {
      result[reelId] = parsedRecommendation
    }

    return result
  }, {})
}

export const serializeReelIds = (reelIds: string[]) =>
  JSON.stringify(
    Array.from(
      new Set(reelIds.map((reelId) => reelId.trim()).filter((reelId) => reelId.length > 0)),
    ),
  )

export const deserializeReelIds = (reelIdsJson: string | null) => {
  const parsed = safeParseJson(reelIdsJson)

  if (!Array.isArray(parsed)) {
    return []
  }

  return Array.from(
    new Set(
      parsed
        .map((reelId) => toNullableTrimmedString(reelId))
        .filter((reelId): reelId is string => reelId !== null),
    ),
  )
}

export const createFeedCacheKey = (params: CacheableFeedParams = {}, cursor?: string) => {
  const paramsKey = serializeFeedParams(params)
  const cursorKey = cursor ?? 'FIRST_PAGE'

  return `${FEED_CACHE_KEY_PREFIX}/${paramsKey}/${cursorKey}`
}

export const serializeReelToCachedReelInput = (reel: Reel): CachedReelInput => {
  const now = Date.now()

  return {
    reelId: reel.id,
    userId: reel.userId,
    mediaKey: reel.mediaKey,
    title: toNullableTrimmedString(reel.title),
    description: toNullableTrimmedString(reel.description),
    tagsJson: serializeTags(reel.tags),
    status: reel.status,
    visibility: reel.visibility,
    viewCount: reel.viewCount,
    thumbnailKey: toNullableTrimmedString(reel.thumbnailKey),
    thumbnailUrl: toNullableTrimmedString(reel.thumbnailUrl),
    localThumbnailUri: toNullableTrimmedString(reel.localThumbnailUri),
    streamUrl: reel.streamUrl,
    authorJson: serializeAuthor(reel.author),
    recommendationJson: serializeRecommendationMetadata(reel.recommendation),
    createdAtRemote: reel.createdAt,
    cachedAt: now,
    lastAccessedAt: now,
  }
}

export const deserializeCachedReelToReel = (
  record:
    | CachedReelModel
    | Pick<
        CachedReelModel,
        | 'reelId'
        | 'userId'
        | 'mediaKey'
        | 'title'
        | 'description'
        | 'tagsJson'
        | 'status'
        | 'visibility'
        | 'viewCount'
        | 'thumbnailKey'
        | 'thumbnailUrl'
        | 'localThumbnailUri'
        | 'streamUrl'
        | 'authorJson'
        | 'recommendationJson'
        | 'createdAtRemote'
      >,
): Reel => {
  const status = REEL_STATUS_VALUES.includes(record.status as ReelProcessingState)
    ? (record.status as ReelProcessingState)
    : 'COMPLETED'
  const visibility = REEL_VISIBILITY_VALUES.includes(record.visibility as ReelVisibility)
    ? (record.visibility as ReelVisibility)
    : 'public'
  const author = deserializeAuthor(record.authorJson)
  const recommendation = deserializeRecommendationMetadata(record.recommendationJson)

  return {
    id: record.reelId,
    userId: record.userId,
    mediaKey: record.mediaKey,
    tags: deserializeTags(record.tagsJson),
    status,
    visibility,
    viewCount:
      typeof record.viewCount === 'number' && Number.isFinite(record.viewCount)
        ? record.viewCount
        : 0,
    streamUrl: record.streamUrl,
    createdAt: record.createdAtRemote,
    ...(record.title ? { title: record.title } : {}),
    ...(record.description ? { description: record.description } : {}),
    ...(record.thumbnailKey ? { thumbnailKey: record.thumbnailKey } : {}),
    ...(record.thumbnailUrl ? { thumbnailUrl: record.thumbnailUrl } : {}),
    ...(record.localThumbnailUri ? { localThumbnailUri: record.localThumbnailUri } : {}),
    ...(author ? { author } : {}),
    ...(recommendation ? { recommendation } : {}),
  }
}

export const toCachedReelFeedPageInput = ({
  cacheKey,
  params,
  cursor,
  reelIds,
  recommendations,
  nextCursor,
  feedSessionId,
  algorithmVersion,
  generatedAt,
  cachedAt,
  lastAccessedAt,
}: {
  cacheKey: string
  params: CacheableFeedParams
  cursor?: string
  reelIds: string[]
  recommendations?: string | null
  nextCursor?: string | null
  feedSessionId?: string
  algorithmVersion?: string
  generatedAt?: string
  cachedAt: number
  lastAccessedAt: number
}): CachedReelFeedPageInput => ({
  cacheKey,
  paramsJson: serializeFeedParams(params),
  cursor: toNullableTrimmedString(cursor),
  reelIdsJson: serializeReelIds(reelIds),
  recommendationsJson: recommendations ?? null,
  nextCursor: toNullableTrimmedString(nextCursor),
  feedSessionId: toNullableTrimmedString(feedSessionId),
  algorithmVersion: toNullableTrimmedString(algorithmVersion),
  generatedAt: toNullableTrimmedString(generatedAt),
  cachedAt,
  lastAccessedAt,
})

export const getCachedFeedPageReelIds = (record: Pick<CachedReelFeedPageModel, 'reelIdsJson'>) =>
  deserializeReelIds(record.reelIdsJson)
