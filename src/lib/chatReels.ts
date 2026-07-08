import type { Message } from '../types/conversation.types'
import type { Reel } from '../types/reel.types'

export const CHAT_SHARED_REEL_FALLBACK_ID_PREFIX = 'shared-message:'

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
