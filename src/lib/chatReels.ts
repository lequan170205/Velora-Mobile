import type { Message } from '../types/conversation.types'
import type { Reel, ReelAuthor, ReelFeedListItem } from '../types/reel.types'

export const CHAT_SHARED_REEL_FALLBACK_ID_PREFIX = 'shared-message:'
const ROUTE_REEL_CONTEXT_STATUS_VALUES = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
const ROUTE_REEL_CONTEXT_VISIBILITY_VALUES = new Set(['public', 'private'])

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

const normalizeRouteReelAuthor = (value: unknown): ReelAuthor | null => {
  if (!isRecord(value)) {
    return null
  }

  const id = getTrimmedString(value.id)
  if (!id) {
    return null
  }

  return {
    id,
    username: getTrimmedString(value.username),
    displayName: getTrimmedString(value.displayName),
    avatarUrl: getTrimmedString(value.avatarUrl),
    isVerified: typeof value.isVerified === 'boolean' ? value.isVerified : null,
  }
}

const normalizeRouteReel = (value: unknown): Reel | null => {
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
    !ROUTE_REEL_CONTEXT_STATUS_VALUES.has(status) ||
    !visibility ||
    !ROUTE_REEL_CONTEXT_VISIBILITY_VALUES.has(visibility) ||
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
  const author = normalizeRouteReelAuthor(value.author)

  return {
    id,
    userId,
    mediaKey,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    tags: normalizeStringArray(value.tags),
    status: status as Reel['status'],
    visibility: visibility as Reel['visibility'],
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
    ...(author ? { author } : {}),
  }
}

export const isSharedReelMessage = (message?: Pick<Message, 'type' | 'media'> | null): boolean => {
  return (
    message?.type === 'reel' ||
    message?.media?.mimeType === 'application/vnd.velora.reel' ||
    Boolean(message?.media?.reelId)
  )
}

export const getSharedReelRouteId = (
  message?: Pick<Message, 'id' | 'media'> | null,
): string | null => {
  const reelId = message?.media?.reelId?.trim()
  if (reelId) {
    return reelId
  }

  const messageId = message?.id?.trim()
  if (!messageId) {
    return null
  }

  return `${CHAT_SHARED_REEL_FALLBACK_ID_PREFIX}${messageId}`
}

const getReelOwnerIdentity = (media: Message['media'], routeId: string) => {
  const ownerUsername = media?.reelOwnerUsername?.trim().replace(/^@+/, '') || null
  const ownerId =
    media?.reelOwnerId ?? (ownerUsername ? `username:${ownerUsername}` : `reel:${routeId}`)

  return {
    ownerId,
    ownerUsername,
  }
}

export const buildSharedReelFromMessage = (message: Message): Reel | null => {
  const media = message.media
  const routeId = getSharedReelRouteId(message)
  const streamUrl = media?.fileUrl?.trim()
  const thumbnailUrl = media?.thumbnailUrl?.trim()
  const thumbnailKey = media?.thumbnailKey?.trim()

  if (!media || !routeId || !streamUrl) {
    return null
  }

  const { ownerId, ownerUsername } = getReelOwnerIdentity(media, routeId)
  const hasAuthorMetadata =
    Boolean(media.reelOwnerUsername) ||
    Boolean(media.reelOwnerId) ||
    Boolean(media.reelOwnerAvatarUrl)

  return {
    id: routeId,
    userId: ownerId,
    mediaKey: media.fileKey ?? routeId,
    title: media.reelTitle?.trim() || message.content?.trim() || 'Shared reel',
    ...(media.reelDescription ? { description: media.reelDescription } : {}),
    tags: [],
    status: 'COMPLETED',
    visibility: 'public',
    viewCount: 0,
    ...(hasAuthorMetadata
      ? {
          author: {
            id: ownerId,
            username: ownerUsername,
            displayName: null,
            avatarUrl: media.reelOwnerAvatarUrl ?? null,
            isVerified: null,
          },
        }
      : {}),
    ...(thumbnailKey ? { thumbnailKey } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    streamUrl,
    createdAt: message.createdAt,
  }
}

export const buildChatReelMediaFromReel = (
  reel: ReelFeedListItem,
): NonNullable<Message['media']> => {
  const normalizedTags = normalizeStringArray(reel.tags)
  const thumbnailUrl = reel.thumbnailUrl ?? reel.localThumbnailUri

  return {
    fileKey: reel.mediaKey,
    fileUrl: reel.streamUrl,
    ...(reel.thumbnailKey ? { thumbnailKey: reel.thumbnailKey } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    mimeType: 'application/vnd.velora.reel',
    reelId: reel.id,
    reelOwnerId: reel.userId,
    ...(reel.author?.avatarUrl ? { reelOwnerAvatarUrl: reel.author.avatarUrl } : {}),
    ...(reel.author?.username ? { reelOwnerUsername: reel.author.username } : {}),
    ...(reel.title ? { reelTitle: reel.title } : {}),
    ...(reel.description ? { reelDescription: reel.description } : {}),
    ...(normalizedTags.length > 0 ? { reelTags: normalizedTags } : {}),
    status: 'ready',
  }
}

export const serializeChatReelRouteContext = (reels: Reel[]): string | null => {
  if (!reels.length) {
    return null
  }

  try {
    return encodeURIComponent(JSON.stringify(reels))
  } catch {
    return null
  }
}

export const parseChatReelRouteContext = (value?: string | string[] | null): Reel[] => {
  const rawValue = Array.isArray(value) ? value[0] : value
  if (!rawValue) {
    return []
  }

  const parseCandidates = [rawValue]

  try {
    const decodedValue = decodeURIComponent(rawValue)
    if (decodedValue !== rawValue) {
      parseCandidates.push(decodedValue)
    }
  } catch {
    // Ignore decode errors and fall back to parsing the raw value.
  }

  for (const candidate of parseCandidates) {
    try {
      const parsedValue = JSON.parse(candidate)
      if (!Array.isArray(parsedValue)) {
        continue
      }

      return parsedValue.flatMap((item) => {
        const normalizedReel = normalizeRouteReel(item)
        return normalizedReel ? [normalizedReel] : []
      })
    } catch {
      continue
    }
  }

  return []
}
