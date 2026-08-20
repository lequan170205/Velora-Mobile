import type {
  AiRagCitation,
  GroupSystemActivity,
  GroupSystemActivityType,
  MessageMetadata,
} from '../types/conversation.types'
import type {
  ReelAuthor,
  ReelFeedListItem,
  ReelProcessingState,
  ReelVisibility,
} from '../types/reel.types'

const AI_RESPONSE_METADATA_KIND = 'velora_ai_response'
const AI_RECOMMENDATION_METADATA_KIND = 'velora_ai_reel_recommendations'
const GROUP_SYSTEM_ACTIVITY_METADATA_KIND = 'group_system_activity'
const AI_RAG_EVIDENCE_TYPES = new Set(['TRANSCRIPT', 'VISUAL', 'METADATA'])
const REEL_STATUS_VALUES = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
const REEL_VISIBILITY_VALUES = new Set(['public', 'private'])
const GROUP_SYSTEM_ACTIVITY_TYPES = new Set<GroupSystemActivityType>([
  'GROUP_CREATED',
  'MEMBER_ADDED',
  'MEMBER_LEFT',
  'MEMBER_REMOVED',
  'MEMBER_PROMOTED',
  'MEMBER_DEMOTED',
  'OWNERSHIP_TRANSFERRED',
  'GROUP_RENAMED',
  'GROUP_PICTURE_CHANGED',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getTrimmedString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

const getNullableString = (value: unknown): string | null | undefined => {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  return value.trim()
}

const getFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const getNonNegativeNumber = (value: unknown) => {
  const numberValue = getFiniteNumber(value)
  return numberValue !== null && numberValue >= 0 ? numberValue : null
}

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

const normalizeGroupSystemActivity = (value: unknown): GroupSystemActivity | null => {
  if (!isRecord(value)) {
    return null
  }

  const type = getTrimmedString(value.type)?.toUpperCase() as GroupSystemActivityType | undefined
  const actorUserId = getTrimmedString(value.actorUserId ?? value.actor_user_id)

  if (!type || !GROUP_SYSTEM_ACTIVITY_TYPES.has(type) || !actorUserId) {
    return null
  }

  const actorName = getTrimmedString(value.actorName ?? value.actor_name)
  const targetUserId = getTrimmedString(value.targetUserId ?? value.target_user_id)
  const targetName = getTrimmedString(value.targetName ?? value.target_name)
  const previousValue = getNullableString(value.previousValue ?? value.previous_value)
  const nextValue = getNullableString(value.nextValue ?? value.next_value)

  return {
    type,
    actorUserId,
    ...(actorName ? { actorName } : {}),
    ...(targetUserId ? { targetUserId } : {}),
    ...(targetName ? { targetName } : {}),
    ...(previousValue !== undefined ? { previousValue } : {}),
    ...(nextValue !== undefined ? { nextValue } : {}),
  }
}

const normalizeAiRagCitation = (value: unknown): AiRagCitation | null => {
  if (!isRecord(value)) {
    return null
  }

  const sourceType = getTrimmedString(value.sourceType ?? value.source_type)
  const reelId = getTrimmedString(value.reelId ?? value.reel_id)
  const evidenceType = getTrimmedString(value.evidenceType ?? value.evidence_type)?.toUpperCase()

  if (
    sourceType?.toUpperCase() !== 'REEL' ||
    !reelId ||
    !evidenceType ||
    !AI_RAG_EVIDENCE_TYPES.has(evidenceType)
  ) {
    return null
  }

  const title = getTrimmedString(value.title)
  const quote = getTrimmedString(value.quote)
  const startTime = getNonNegativeNumber(value.startTime ?? value.start_time)
  const rawEndTime = getNonNegativeNumber(value.endTime ?? value.end_time)
  const endTime =
    rawEndTime !== null && (startTime === null || rawEndTime >= startTime) ? rawEndTime : null

  return {
    sourceType: 'REEL',
    reelId,
    evidenceType: evidenceType as AiRagCitation['evidenceType'],
    ...(title ? { title } : {}),
    ...(startTime !== null ? { startTime } : {}),
    ...(endTime !== null ? { endTime } : {}),
    ...(quote ? { quote } : {}),
  }
}

const normalizeAiRagCitations = (value: unknown): AiRagCitation[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const citations: AiRagCitation[] = []
  const seen = new Set<string>()

  for (const item of value) {
    const citation = normalizeAiRagCitation(item)
    if (!citation) {
      continue
    }

    const key = [
      citation.reelId,
      citation.evidenceType,
      citation.startTime ?? '',
      citation.endTime ?? '',
      citation.quote ?? '',
    ].join(':')

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    citations.push(citation)

    if (citations.length >= 8) {
      break
    }
  }

  return citations
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

  if (rawKind === GROUP_SYSTEM_ACTIVITY_METADATA_KIND) {
    const groupActivity = normalizeGroupSystemActivity(
      rawValue.groupActivity ?? rawValue.group_activity,
    )

    return {
      kind: GROUP_SYSTEM_ACTIVITY_METADATA_KIND,
      ...(groupActivity ? { groupActivity } : {}),
    }
  }

  const citationsSource = Array.isArray(rawValue.citations)
    ? rawValue.citations
    : Array.isArray(rawValue.ragCitations)
      ? rawValue.ragCitations
      : Array.isArray(rawValue.rag_citations)
        ? rawValue.rag_citations
        : undefined
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
  const citations = citationsSource ? normalizeAiRagCitations(citationsSource) : undefined
  const recommendedReels = recommendedReelsSource
    ? recommendedReelsSource
        .map((reel) => normalizeReelFeedListItem(reel))
        .filter((reel): reel is ReelFeedListItem => Boolean(reel))
    : undefined
  const suggestedQueries =
    suggestedQueriesSource !== undefined ? normalizeStringArray(suggestedQueriesSource) : undefined
  const isKnownKind =
    rawKind === AI_RESPONSE_METADATA_KIND || rawKind === AI_RECOMMENDATION_METADATA_KIND
  const kind = isKnownKind
    ? rawKind
    : recommendedReelsSource !== undefined || suggestedQueriesSource !== undefined
      ? AI_RECOMMENDATION_METADATA_KIND
      : citationsSource !== undefined
        ? AI_RESPONSE_METADATA_KIND
        : undefined

  if (
    !kind &&
    citations === undefined &&
    recommendedReels === undefined &&
    suggestedQueries === undefined
  ) {
    return undefined
  }

  return {
    ...(kind ? { kind } : {}),
    ...(citations !== undefined ? { citations } : {}),
    ...(recommendedReels !== undefined ? { recommendedReels } : {}),
    ...(suggestedQueries !== undefined ? { suggestedQueries } : {}),
  }
}
