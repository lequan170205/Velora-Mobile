import { resolveAllowedVideoType } from './reels'

import type { MessageMedia, MessageMediaUploadStage } from '../types/conversation.types'
import type { AllowedVideoType } from '../types/reel.types'

export const CHAT_IMAGE_PLACEHOLDER = '[Hình ảnh]'
export const CHAT_VIDEO_PLACEHOLDER = '[Video]'

export const allowedChatImageTypes = ['image/jpeg', 'image/png', 'image/webp'] as const
export const allowedChatVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime'] as const
export const allowedChatThumbnailTypes = ['image/jpeg', 'image/png', 'image/webp'] as const

export type AllowedChatImageType = (typeof allowedChatImageTypes)[number]
export type AllowedChatVideoType = AllowedVideoType
export type AllowedChatMediaType = AllowedChatImageType | AllowedChatVideoType

const imageExtensionToMimeType: Record<string, AllowedChatImageType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export const resolveAllowedChatImageType = (
  mimeType?: string | null,
  fileNameOrUri?: string | null,
): AllowedChatImageType | null => {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') {
    return mimeType
  }

  if (!fileNameOrUri) {
    return null
  }

  const normalizedPath = fileNameOrUri.split('?')[0]?.toLowerCase() ?? ''
  const extension = normalizedPath.split('.').pop()

  if (!extension) {
    return null
  }

  return imageExtensionToMimeType[extension] ?? null
}

export const resolveAllowedChatMediaType = ({
  mimeType,
  fileNameOrUri,
  kind,
}: {
  mimeType?: string | null
  fileNameOrUri?: string | null
  kind: 'image' | 'video'
}) => {
  if (kind === 'image') {
    return resolveAllowedChatImageType(mimeType, fileNameOrUri)
  }

  return resolveAllowedVideoType(mimeType, fileNameOrUri)
}

export const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value))
}

/** The caption a user typed under a photo, or '' when the content is only the composer placeholder. */
export const getChatImageCaption = (content?: string | null) => {
  const trimmed = content?.trim() ?? ''
  return trimmed === CHAT_IMAGE_PLACEHOLDER ? '' : trimmed
}

/** Most characters a caption to Velora AI may carry; the AI reads only the start of a long one. */
export const MAX_CHAT_IMAGE_CAPTION_LENGTH = 500

/**
 * JPEG quality for photos picked to ask Velora AI about. Phone photos are several MB at full
 * quality, and the AI reads photos up to 4 MB; this keeps typical shots well inside it.
 */
export const BOT_IMAGE_PICK_QUALITY = 0.7

export const getMediaPlaceholderLabel = (type: 'image' | 'video') => {
  return type === 'video' ? CHAT_VIDEO_PLACEHOLDER : CHAT_IMAGE_PLACEHOLDER
}

export const getChatMediaMaxWidth = (screenWidth: number) => {
  return Math.max(196, Math.min(Math.floor(screenWidth * 0.62), 260))
}

export const calculateChatMediaDisplaySize = ({
  width,
  height,
  maxWidth,
}: {
  width?: number | null
  height?: number | null
  maxWidth: number
}) => {
  const normalizedWidth = width && width > 0 ? width : 200
  const normalizedHeight = height && height > 0 ? height : 200
  const maxHeight = 340
  const widthScale = maxWidth / normalizedWidth
  const heightScale = maxHeight / normalizedHeight
  const scale = Math.min(widthScale, heightScale, 1)

  const calculatedWidth = normalizedWidth * scale
  const calculatedHeight = normalizedHeight * scale

  return {
    displayWidth: Math.max(1, Math.round(calculatedWidth)),
    displayHeight: Math.max(1, Math.round(calculatedHeight)),
  }
}

export const isRemoteMediaUri = (uri?: string | null) =>
  typeof uri === 'string' && /^https?:\/\//i.test(uri)

export const getMediaUploadStage = (
  media?: MessageMedia | null,
): MessageMediaUploadStage | null => {
  if (!media) {
    return null
  }

  if (media.uploadStage) {
    return media.uploadStage
  }

  if (media.status === 'processing') {
    return 'processing'
  }

  if (media.status === 'failed') {
    return 'failed'
  }

  if (media.status === 'ready') {
    return 'ready'
  }

  return null
}

export const getResolvedMediaUri = (media?: MessageMedia | null) => {
  if (!media) return null
  const isProcessing = getMediaUploadStage(media) === 'processing'

  if (isProcessing) {
    return media.localFileUri ?? null
  }

  return media.fileUrl ?? media.localFileUri ?? null
}

export const getResolvedMediaPosterUri = (media?: MessageMedia | null) => {
  if (!media) return null
  const isProcessing = getMediaUploadStage(media) === 'processing'

  if (isProcessing) {
    return media.localPosterUri ?? null
  }

  return media.thumbnailUrl ?? media.localPosterUri ?? null
}
