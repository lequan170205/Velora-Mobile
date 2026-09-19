import type { Message } from '../types/conversation.types'
import type {
  Reel,
  ReelAuthor,
  ReelFeedListItem,
  ReelPlaybackPresentation,
  ReelSourceOrientation,
} from '../types/reel.types'

export const CHAT_SHARED_REEL_FALLBACK_ID_PREFIX = 'shared-message:'
const ROUTE_REEL_CONTEXT_STATUS_VALUES = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
const ROUTE_REEL_CONTEXT_VISIBILITY_VALUES = new Set(['public', 'friends', 'private'])

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
  const sourceOrientation = getTrimmedString(value.sourceOrientation)
  const sourceAspectRatio = getFiniteNumber(value.sourceAspectRatio)
  const sourceEffectiveWidth = getFiniteNumber(value.sourceEffectiveWidth)
  const sourceEffectiveHeight = getFiniteNumber(value.sourceEffectiveHeight)
  const sourceWidth = getFiniteNumber(value.sourceWidth)
  const sourceHeight = getFiniteNumber(value.sourceHeight)
  const playbackPresentation = getTrimmedString(value.playbackPresentation)

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
    ...(sourceOrientation ? { sourceOrientation: sourceOrientation as ReelSourceOrientation } : {}),
    ...(sourceAspectRatio !== null ? { sourceAspectRatio } : {}),
    ...(sourceEffectiveWidth !== null ? { sourceEffectiveWidth } : {}),
    ...(sourceEffectiveHeight !== null ? { sourceEffectiveHeight } : {}),
    ...(sourceWidth !== null ? { sourceWidth } : {}),
    ...(sourceHeight !== null ? { sourceHeight } : {}),
    ...(playbackPresentation
      ? { playbackPresentation: playbackPresentation as ReelPlaybackPresentation }
      : {}),
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

  const rawOrientation =
    (media.reelSourceOrientation as ReelSourceOrientation | undefined) ??
    (media.sourceOrientation as ReelSourceOrientation | undefined)
  const sourceOrientation: ReelSourceOrientation | undefined =
    rawOrientation === 'PORTRAIT' || rawOrientation === 'LANDSCAPE' || rawOrientation === 'SQUARE'
      ? rawOrientation
      : typeof media.width === 'number' && typeof media.height === 'number' && media.height > 0
        ? media.width / media.height >= 1.1
          ? 'LANDSCAPE'
          : media.width / media.height <= 0.9
            ? 'PORTRAIT'
            : 'SQUARE'
        : undefined

  const sourceAspectRatio =
    (typeof media.reelSourceAspectRatio === 'number' &&
    Number.isFinite(media.reelSourceAspectRatio) &&
    media.reelSourceAspectRatio > 0
      ? media.reelSourceAspectRatio
      : undefined) ??
    (typeof media.sourceAspectRatio === 'number' &&
    Number.isFinite(media.sourceAspectRatio) &&
    media.sourceAspectRatio > 0
      ? media.sourceAspectRatio
      : undefined) ??
    (typeof media.width === 'number' && typeof media.height === 'number' && media.height > 0
      ? media.width / media.height
      : undefined)

  const rawPresentation =
    (media.reelPlaybackPresentation as ReelPlaybackPresentation | undefined) ??
    (media.playbackPresentation as ReelPlaybackPresentation | undefined)
  const playbackPresentation: ReelPlaybackPresentation | undefined =
    rawPresentation === 'PORTRAIT_COVER' || rawPresentation === 'FIT_WITH_LETTERBOX'
      ? rawPresentation
      : sourceOrientation === 'LANDSCAPE'
        ? 'FIT_WITH_LETTERBOX'
        : undefined

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
    ...(sourceOrientation ? { sourceOrientation } : {}),
    ...(typeof sourceAspectRatio === 'number' ? { sourceAspectRatio } : {}),
    ...(playbackPresentation ? { playbackPresentation } : {}),
    ...(typeof media.width === 'number'
      ? { sourceEffectiveWidth: media.width, sourceWidth: media.width }
      : {}),
    ...(typeof media.height === 'number'
      ? { sourceEffectiveHeight: media.height, sourceHeight: media.height }
      : {}),
    streamUrl,
    createdAt: message.createdAt,
  }
}

export const buildChatReelMediaFromReel = (
  reel: ReelFeedListItem,
): NonNullable<Message['media']> => {
  const normalizedTags = normalizeStringArray(reel.tags)
  const thumbnailUrl = reel.thumbnailUrl ?? reel.localThumbnailUri
  const resolvedWidth =
    typeof reel.sourceEffectiveWidth === 'number' && Number.isFinite(reel.sourceEffectiveWidth)
      ? reel.sourceEffectiveWidth
      : typeof reel.sourceWidth === 'number' && Number.isFinite(reel.sourceWidth)
        ? reel.sourceWidth
        : undefined
  const resolvedHeight =
    typeof reel.sourceEffectiveHeight === 'number' && Number.isFinite(reel.sourceEffectiveHeight)
      ? reel.sourceEffectiveHeight
      : typeof reel.sourceHeight === 'number' && Number.isFinite(reel.sourceHeight)
        ? reel.sourceHeight
        : undefined

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
    ...(reel.sourceOrientation
      ? {
          reelSourceOrientation: reel.sourceOrientation,
          sourceOrientation: reel.sourceOrientation,
        }
      : {}),
    ...(typeof reel.sourceAspectRatio === 'number' && Number.isFinite(reel.sourceAspectRatio)
      ? {
          reelSourceAspectRatio: reel.sourceAspectRatio,
          sourceAspectRatio: reel.sourceAspectRatio,
        }
      : {}),
    ...(reel.playbackPresentation
      ? {
          reelPlaybackPresentation: reel.playbackPresentation,
          playbackPresentation: reel.playbackPresentation,
        }
      : {}),
    ...(typeof resolvedWidth === 'number' ? { width: resolvedWidth } : {}),
    ...(typeof resolvedHeight === 'number' ? { height: resolvedHeight } : {}),
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
