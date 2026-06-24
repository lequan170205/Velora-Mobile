import { getResolvedMediaPosterUri, getResolvedMediaUri } from './chatMedia'

import type { Conversation, Message, ReplyPreviewData } from '../types/conversation.types'

export const RECALLED_PREVIEW_TEXT = 'Tin nhắn đã thu hồi'
export const REEL_PREVIEW_FALLBACK_TEXT = 'Reel'

const RECALLED_PREVIEW_ALIASES = new Set([
  RECALLED_PREVIEW_TEXT,
  'Message recalled',
  'message recalled',
])

const GENERIC_REEL_PREVIEW_ALIASES = new Set([
  'Tin nhắn mới',
  'Tin nhan moi',
  'New message',
  'new message',
])

const getEmailLabel = (email?: string | null) => {
  const normalizedEmail = email?.trim()
  return normalizedEmail ? normalizedEmail.split('@')[0] || normalizedEmail : ''
}

export const getReplyPreviewSenderName = ({
  conversation,
  currentUserId,
  senderEmail,
  senderId,
}: {
  conversation?: Conversation | null
  currentUserId?: string | null | undefined
  senderEmail?: string | null | undefined
  senderId?: string | null | undefined
}) => {
  if (currentUserId && senderId === currentUserId) {
    return 'You'
  }

  const participant = conversation?.participants?.find((candidate) => candidate.id === senderId)
  const participantName = participant?.name?.trim()
  if (participantName) {
    return participantName
  }

  const participantEmailLabel = getEmailLabel(participant?.email)
  if (participantEmailLabel) {
    return participantEmailLabel
  }

  const senderEmailLabel = getEmailLabel(senderEmail)
  return senderEmailLabel || 'User'
}

export const isMessageRecalled = (message?: Pick<Message, 'isRecalled' | 'is_recalled'> | null) => {
  return message?.isRecalled === true || message?.is_recalled === true
}

export const isRecalledPreviewContent = (content?: string | null) => {
  const normalizedContent = content?.trim()
  return normalizedContent ? RECALLED_PREVIEW_ALIASES.has(normalizedContent) : false
}

export const normalizeReplyPreviewContent = (content?: string | null) => {
  const normalizedContent = content?.trim() ?? ''
  return isRecalledPreviewContent(normalizedContent) ? RECALLED_PREVIEW_TEXT : normalizedContent
}

export const getPreferredReelReplyPreviewContent = ({
  content,
  reelTitle,
}: {
  content?: string | null | undefined
  reelTitle?: string | null | undefined
}) => {
  const normalizedReelTitle = normalizeReplyPreviewContent(reelTitle)
  if (normalizedReelTitle) {
    return normalizedReelTitle
  }

  const normalizedContent = normalizeReplyPreviewContent(content)
  if (normalizedContent && !GENERIC_REEL_PREVIEW_ALIASES.has(normalizedContent)) {
    return normalizedContent
  }

  return REEL_PREVIEW_FALLBACK_TEXT
}

export const toTextOnlyReplyPreview = (
  replyPreview?: Message['replyPreview'] | null,
  content: string = RECALLED_PREVIEW_TEXT,
): Message['replyPreview'] | undefined => {
  const normalizedContent = normalizeReplyPreviewContent(content) || RECALLED_PREVIEW_TEXT

  if (!replyPreview) {
    return undefined
  }

  if (typeof replyPreview === 'string') {
    return normalizedContent
  }

  return {
    senderName: replyPreview.senderName,
    ...(replyPreview.senderId ? { senderId: replyPreview.senderId } : {}),
    content: normalizedContent,
    type: 'text',
  }
}

export const normalizeReplyPreview = (
  replyPreview?: Message['replyPreview'] | null,
): Message['replyPreview'] | undefined => {
  if (!replyPreview) {
    return undefined
  }

  if (typeof replyPreview === 'string') {
    const normalizedContent = normalizeReplyPreviewContent(replyPreview)
    return normalizedContent || undefined
  }

  const normalizedContent = normalizeReplyPreviewContent(replyPreview.content)
  if (isRecalledPreviewContent(normalizedContent)) {
    return toTextOnlyReplyPreview(replyPreview, normalizedContent)
  }

  return {
    ...replyPreview,
    content: normalizedContent,
  }
}

export const mergeReplyPreview = (
  remoteReplyPreview?: Message['replyPreview'] | null,
  localReplyPreview?: Message['replyPreview'] | null,
): Message['replyPreview'] | undefined => {
  const normalizedRemoteReplyPreview = normalizeReplyPreview(remoteReplyPreview)
  const normalizedLocalReplyPreview = normalizeReplyPreview(localReplyPreview)

  if (!normalizedRemoteReplyPreview) {
    return normalizedLocalReplyPreview
  }

  if (!normalizedLocalReplyPreview) {
    return normalizedRemoteReplyPreview
  }

  if (
    typeof normalizedRemoteReplyPreview === 'string' ||
    typeof normalizedLocalReplyPreview === 'string'
  ) {
    return normalizedRemoteReplyPreview
  }

  if (normalizedRemoteReplyPreview.type === 'text') {
    return normalizedRemoteReplyPreview
  }

  if (normalizedRemoteReplyPreview.thumbnailUri || !normalizedLocalReplyPreview.thumbnailUri) {
    return {
      ...normalizedRemoteReplyPreview,
      ...(normalizedRemoteReplyPreview.senderId
        ? {}
        : { senderId: normalizedLocalReplyPreview.senderId }),
      ...(normalizedRemoteReplyPreview.mediaWidth
        ? {}
        : { mediaWidth: normalizedLocalReplyPreview.mediaWidth }),
      ...(normalizedRemoteReplyPreview.mediaHeight
        ? {}
        : { mediaHeight: normalizedLocalReplyPreview.mediaHeight }),
    }
  }

  return {
    ...normalizedRemoteReplyPreview,
    thumbnailUri: normalizedLocalReplyPreview.thumbnailUri,
    ...(normalizedRemoteReplyPreview.senderId
      ? {}
      : { senderId: normalizedLocalReplyPreview.senderId }),
    ...(normalizedRemoteReplyPreview.mediaWidth
      ? {}
      : { mediaWidth: normalizedLocalReplyPreview.mediaWidth }),
    ...(normalizedRemoteReplyPreview.mediaHeight
      ? {}
      : { mediaHeight: normalizedLocalReplyPreview.mediaHeight }),
  }
}

export const isReplyPreviewRecalled = ({
  replyPreview,
  replyTo,
}: {
  replyPreview?: Message['replyPreview'] | undefined
  replyTo?: Pick<Message, 'isRecalled' | 'is_recalled'> | null | undefined
}) => {
  if (isMessageRecalled(replyTo)) {
    return true
  }

  if (!replyPreview) {
    return false
  }

  if (typeof replyPreview === 'string') {
    return isRecalledPreviewContent(replyPreview)
  }

  return isRecalledPreviewContent(replyPreview.content)
}

export const buildReplyPreviewFromMessage = ({
  conversation,
  currentUserId,
  message,
}: {
  conversation?: Conversation | null
  currentUserId?: string | null | undefined
  message?: Message | null
}): ReplyPreviewData | undefined => {
  if (!message?.id) {
    return undefined
  }

  const senderName = getReplyPreviewSenderName({
    conversation: conversation ?? null,
    currentUserId,
    senderEmail: message.sender?.email ?? null,
    senderId: message.senderId,
  })

  if (isMessageRecalled(message)) {
    return {
      senderName,
      ...(message.senderId ? { senderId: message.senderId } : {}),
      content: RECALLED_PREVIEW_TEXT,
      type: 'text',
    }
  }

  let thumbnailUri: string | undefined
  if (message.type === 'video') {
    thumbnailUri = getResolvedMediaPosterUri(message.media) ?? undefined
  } else if (message.type === 'image') {
    thumbnailUri = getResolvedMediaUri(message.media) ?? undefined
  } else if (message.type === 'reel') {
    thumbnailUri = message.media?.thumbnailUrl ?? undefined
  }

  const mediaWidth = message.media?.width ?? message.media?.displayWidth ?? undefined
  const mediaHeight = message.media?.height ?? message.media?.displayHeight ?? undefined
  const content =
    message.type === 'reel'
      ? getPreferredReelReplyPreviewContent({
          content: message.content,
          reelTitle: message.media?.reelTitle,
        })
      : normalizeReplyPreviewContent(message.content ?? '')

  return {
    senderName,
    ...(message.senderId ? { senderId: message.senderId } : {}),
    content,
    ...(thumbnailUri ? { thumbnailUri } : {}),
    ...(mediaWidth ? { mediaWidth } : {}),
    ...(mediaHeight ? { mediaHeight } : {}),
    type: (message.type === 'voice' ? 'text' : message.type) as ReplyPreviewData['type'],
  }
}
