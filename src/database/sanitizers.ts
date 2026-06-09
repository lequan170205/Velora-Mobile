import type {
  Message as ConversationMessage,
  MessageMedia,
  ReplyPreviewData,
  ReactionMap,
} from '../types/conversation.types'

type MessageReadBy = NonNullable<ConversationMessage['readBy']>
type MessageReadReceipt = MessageReadBy[number]
type MessageReplyPreview = string | ReplyPreviewData | null

const MEDIA_STATUS_VALUES = new Set(['ready', 'processing', 'failed'])
const MEDIA_UPLOAD_STAGE_VALUES = new Set([
  'queued',
  'uploading',
  'syncing',
  'ready',
  'processing',
  'failed',
])
const REPLY_PREVIEW_TYPES = new Set(['text', 'image', 'video', 'file', 'call'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sanitizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const sanitizeNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return value
}

export const sanitizeParticipantIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(value.map(sanitizeString).filter((item): item is string => item !== null)),
  )
}

export const sanitizeMessageMedia = (value: unknown): MessageMedia | null => {
  if (!isRecord(value)) {
    return null
  }

  const nextMedia: MessageMedia = {}
  const fileKey = sanitizeString(value.fileKey)
  const fileUrl = sanitizeString(value.fileUrl)
  const thumbnailKey = sanitizeString(value.thumbnailKey)
  const thumbnailUrl = sanitizeString(value.thumbnailUrl)
  const mimeType = sanitizeString(value.mimeType)
  const width = sanitizeNumber(value.width)
  const height = sanitizeNumber(value.height)
  const durationMs = sanitizeNumber(value.durationMs)
  const failureReason = sanitizeString(value.failureReason)
  const localFileUri = sanitizeString(value.localFileUri)
  const localPosterUri = sanitizeString(value.localPosterUri)
  const displayWidth = sanitizeNumber(value.displayWidth)
  const displayHeight = sanitizeNumber(value.displayHeight)
  const uploadStartedAt = sanitizeNumber(value.uploadStartedAt)
  const lastProgressAt = sanitizeNumber(value.lastProgressAt)
  const status = sanitizeString(value.status)
  const uploadStage = sanitizeString(value.uploadStage)

  if (fileKey) nextMedia.fileKey = fileKey
  if (fileUrl) nextMedia.fileUrl = fileUrl
  if (thumbnailKey) nextMedia.thumbnailKey = thumbnailKey
  if (thumbnailUrl) nextMedia.thumbnailUrl = thumbnailUrl
  if (mimeType) nextMedia.mimeType = mimeType
  if (width !== null) nextMedia.width = width
  if (height !== null) nextMedia.height = height
  if (durationMs !== null) nextMedia.durationMs = durationMs
  if (failureReason) nextMedia.failureReason = failureReason
  if (localFileUri) nextMedia.localFileUri = localFileUri
  if (localPosterUri) nextMedia.localPosterUri = localPosterUri
  if (displayWidth !== null) nextMedia.displayWidth = displayWidth
  if (displayHeight !== null) nextMedia.displayHeight = displayHeight
  if (uploadStartedAt !== null) nextMedia.uploadStartedAt = uploadStartedAt
  if (lastProgressAt !== null) nextMedia.lastProgressAt = lastProgressAt
  if (status && MEDIA_STATUS_VALUES.has(status)) {
    nextMedia.status = status as NonNullable<MessageMedia['status']>
  }
  if (uploadStage && MEDIA_UPLOAD_STAGE_VALUES.has(uploadStage)) {
    nextMedia.uploadStage = uploadStage as NonNullable<MessageMedia['uploadStage']>
  }

  return Object.keys(nextMedia).length > 0 ? nextMedia : null
}

export const sanitizeReadBy = (value: unknown): MessageReadBy | null => {
  if (!Array.isArray(value)) {
    return null
  }

  const nextReadBy = value.reduce<MessageReadReceipt[]>((items, item) => {
    if (!isRecord(item)) {
      return items
    }

    const userId = sanitizeString(item.userId)
    const at = sanitizeString(item.at)

    if (!userId || !at) {
      return items
    }

    items.push({ userId, at })
    return items
  }, [])

  return nextReadBy.length > 0 ? nextReadBy : null
}

export const sanitizeReplyPreview = (value: unknown): MessageReplyPreview => {
  const stringValue = sanitizeString(value)
  if (stringValue) {
    return stringValue
  }

  if (!isRecord(value)) {
    return null
  }

  const senderName = sanitizeString(value.senderName)
  const senderId = sanitizeString(value.senderId)
  const content = sanitizeString(value.content)
  const thumbnailUri = sanitizeString(value.thumbnailUri)
  const mediaWidth = sanitizeNumber(value.mediaWidth)
  const mediaHeight = sanitizeNumber(value.mediaHeight)
  const type = sanitizeString(value.type)

  if (!senderName || !content || !type || !REPLY_PREVIEW_TYPES.has(type)) {
    return null
  }

  return {
    senderName,
    ...(senderId ? { senderId } : {}),
    content,
    ...(thumbnailUri ? { thumbnailUri } : {}),
    ...(mediaWidth !== null ? { mediaWidth } : {}),
    ...(mediaHeight !== null ? { mediaHeight } : {}),
    type: type as ReplyPreviewData['type'],
  }
}

export const sanitizeReactions = (value: unknown): ReactionMap | null => {
  if (!isRecord(value)) {
    return null
  }

  const nextReactions = Object.entries(value).reduce<ReactionMap>((items, [userId, reaction]) => {
    if (!isRecord(reaction)) {
      return items
    }

    const normalizedUserId = sanitizeString(userId)
    const emoji = sanitizeString(reaction.emoji)
    const createdAt = sanitizeString(reaction.createdAt)

    if (!normalizedUserId || !emoji || !createdAt) {
      return items
    }

    items[normalizedUserId] = {
      emoji,
      createdAt,
    }

    return items
  }, {})

  return Object.keys(nextReactions).length > 0 ? nextReactions : null
}
