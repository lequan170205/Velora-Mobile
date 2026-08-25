import { getMessageIdentityKey } from '../messageIdentity'
import { buildReplyPreviewFromMessage, normalizeReplyPreviewContent } from '../replyPreview'

import type { Conversation, Message } from '../../types/conversation.types'

export const EMPTY_CONVERSATION_MESSAGES: Message[] = []

const renderableOptimisticMessagesCache = new WeakMap<Message[], Message[]>()
const GENERIC_REEL_REPLY_PREVIEW_CONTENT = new Set([
  'Tin nhắn mới',
  'Tin nhan moi',
  'New message',
  'new message',
  '[Reel]',
  'Reel',
])

export const isPersistedServerMessageId = (messageId?: string | null) =>
  Boolean(messageId && !messageId.startsWith('temp-'))

export const hasRecommendationMessageContent = (message: Message) =>
  message.metadata?.kind === 'velora_ai_reel_recommendations' &&
  ((message.metadata.recommendedReels?.length ?? 0) > 0 ||
    (message.metadata.suggestedQueries?.length ?? 0) > 0)

export const getClientMessageIdentity = (message?: Message | null) => {
  if (!message) {
    return null
  }

  if (message.clientMessageId) {
    return message.clientMessageId
  }

  if (message.id?.startsWith('temp-')) {
    return message.id
  }

  if (message._id?.startsWith('temp-')) {
    return message._id
  }

  return null
}

export const getOrderDebugSample = (messages: Message[], replyTargetId?: string | null) => {
  return messages.slice(0, 5).map((message, index) => ({
    index,
    id: message.id,
    createdAt: message.createdAt,
    clientMessageId: message.clientMessageId ?? null,
    isReplyTarget: (replyTargetId ? message.id === replyTargetId : false) || false,
  }))
}

export const getRenderableOptimisticMessages = (messages?: Message[]) => {
  if (!messages?.length) {
    return EMPTY_CONVERSATION_MESSAGES
  }

  const cachedMessages = renderableOptimisticMessagesCache.get(messages)
  if (cachedMessages) {
    return cachedMessages
  }

  const hasConfirmedMessages = messages.some(
    (message) => message.status !== 'FAILED' && !message.id.startsWith('temp-'),
  )
  const nextMessages = hasConfirmedMessages
    ? messages.filter((message) => message.status === 'FAILED' || message.id.startsWith('temp-'))
    : messages

  renderableOptimisticMessagesCache.set(messages, nextMessages)
  return nextMessages
}

export const backfillReplyPreviewFromResolvedTarget = ({
  conversation,
  currentUserId,
  message,
  replyTo,
}: {
  conversation?: Conversation | null
  currentUserId?: string | null
  message: Message
  replyTo?: Message | null
}) => {
  if (!replyTo) {
    return message
  }

  const localReplyPreview = buildReplyPreviewFromMessage({
    conversation: conversation ?? null,
    currentUserId: currentUserId ?? null,
    message: replyTo,
  })

  const shouldReplaceWithLocalReelPreview =
    replyTo.type === 'reel' &&
    localReplyPreview &&
    (!message.replyPreview ||
      typeof message.replyPreview === 'string' ||
      message.replyPreview.type !== 'reel' ||
      GENERIC_REEL_REPLY_PREVIEW_CONTENT.has(
        normalizeReplyPreviewContent(message.replyPreview.content),
      ))

  if (shouldReplaceWithLocalReelPreview) {
    return {
      ...message,
      replyPreview: localReplyPreview,
    }
  }

  if (
    !message.replyPreview ||
    typeof message.replyPreview === 'string' ||
    message.replyPreview.senderId ||
    !replyTo.senderId
  ) {
    return message
  }

  return {
    ...message,
    replyPreview: {
      ...message.replyPreview,
      senderId: replyTo.senderId,
    },
  }
}

export const getPrimaryStatusLabel = ({
  hasReadActivityAtOrBeyondMessage,
  message,
}: {
  hasReadActivityAtOrBeyondMessage: boolean
  message: Message
}) => {
  const normalizedStatus = String(message.status ?? '').toUpperCase()

  if (normalizedStatus === 'FAILED') return 'Failed'
  if (hasReadActivityAtOrBeyondMessage) return null

  const isTempOptimistic =
    normalizedStatus !== 'FAILED' &&
    (Boolean(message.id?.startsWith('temp-')) || Boolean(message._id?.startsWith('temp-')))

  if (normalizedStatus === 'PENDING' || isTempOptimistic) return 'Sending...'
  if (normalizedStatus === 'READ') return null
  if (normalizedStatus === 'SENT') return 'Sent'
  if (normalizedStatus === 'DELIVERED') return 'Sent'

  return 'Sent'
}

export const getConversationMessageItemType = (item: Message) => {
  if (item.isRecalled === true || item.is_recalled === true) {
    return 'recalled'
  }

  if (hasRecommendationMessageContent(item)) {
    return `${item.type || 'text'}:velora_ai_reel_recommendations`
  }

  return item.type || 'text'
}

export const getConversationMessageKey = (item: Message, index: number) => {
  const baseKey = getMessageIdentityKey(item) ?? item.id ?? item._id ?? `fallback-${index}`

  if (!hasRecommendationMessageContent(item)) {
    return baseKey
  }

  return [
    baseKey,
    item.metadata?.kind ?? 'metadata',
    item.metadata?.recommendedReels?.length ?? 0,
    item.metadata?.suggestedQueries?.length ?? 0,
  ].join(':')
}
