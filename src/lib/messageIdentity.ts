import { mergeReplyPreview } from './replyPreview'

import type { OptimisticSortAnchor } from '../stores/chatStore'
import type { Message, MessageMedia, MessageMetadata } from '../types/conversation.types'

type MessageLike = Partial<
  Pick<
    Message,
    | 'id'
    | '_id'
    | 'clientMessageId'
    | 'createdAt'
    | 'updatedAt'
    | 'media'
    | 'metadata'
    | 'readBy'
    | 'replyPreview'
  >
> & {
  status?: string
}

const isTempId = (value?: string | null) => Boolean(value?.startsWith('temp-'))

const getTimestamp = (message: MessageLike) => {
  const value = message.updatedAt ?? message.createdAt
  return value ? new Date(value).getTime() : 0
}

type ReadByEntry = NonNullable<Message['readBy']>[number]

const getStatusRank = (status?: string) => {
  switch (status) {
    case 'READ':
      return 4
    case 'DELIVERED':
      return 3
    case 'SENT':
      return 2
    case 'PENDING':
      return 1
    case 'FAILED':
      return 0
    default:
      return -1
  }
}

export const getMessageIdentityTokens = (message?: MessageLike | null) => {
  if (!message) return []

  return Array.from(
    new Set(
      [message.id, message._id, message.clientMessageId].filter((value): value is string =>
        Boolean(value),
      ),
    ),
  )
}

export const getMessageIdentityKey = (message?: MessageLike | null) => {
  if (!message) return null
  return message.clientMessageId ?? message.id ?? message._id ?? null
}

export const getMessageAnchorIdentityKey = (
  message?:
    | Pick<MessageLike, 'clientMessageId' | 'id' | '_id'>
    | {
        clientMessageId?: string | null
        id?: string | null
        _id?: string | null
      }
    | null,
) => {
  if (!message) {
    return null
  }

  return message.clientMessageId ?? message.id ?? message._id ?? null
}

export const isSameMessageIdentity = (left?: MessageLike | null, right?: MessageLike | null) => {
  const rightTokens = new Set(getMessageIdentityTokens(right))
  return getMessageIdentityTokens(left).some((token) => rightTokens.has(token))
}

export const mergeMessageCollectionByIdentity = <T extends MessageLike>(messages: T[]) => {
  const mergedMessages: T[] = []

  for (const message of messages) {
    const existingIndex = mergedMessages.findIndex((candidate) =>
      isSameMessageIdentity(candidate, message),
    )

    if (existingIndex === -1) {
      mergedMessages.push(message)
      continue
    }

    const existingMessage = mergedMessages[existingIndex]
    if (!existingMessage) {
      continue
    }

    mergedMessages[existingIndex] = mergeMessageRecords(existingMessage, message)
  }

  return mergedMessages
}

export const isMessageBeyondOptimisticReadFrontier = ({
  anchorsByMessageId,
  frontierIdentityKey,
  message,
}: {
  anchorsByMessageId: Record<string, OptimisticSortAnchor>
  frontierIdentityKey?: string | null
  message?:
    | Pick<MessageLike, 'clientMessageId' | 'id' | '_id'>
    | {
        clientMessageId?: string | null
        id?: string | null
        _id?: string | null
      }
    | null
}) => {
  if (!frontierIdentityKey) {
    return false
  }

  const frontierAnchor = anchorsByMessageId[frontierIdentityKey]
  const messageIdentityKey = getMessageAnchorIdentityKey(message)
  const messageAnchor = messageIdentityKey ? anchorsByMessageId[messageIdentityKey] : undefined

  if (!frontierAnchor || !messageAnchor) {
    return false
  }

  const sharesBatch =
    Boolean(frontierAnchor.batchId) &&
    Boolean(messageAnchor.batchId) &&
    frontierAnchor.batchId === messageAnchor.batchId
  const sharesFrontierGroup =
    frontierAnchor.frontierCreatedAtMs === messageAnchor.frontierCreatedAtMs &&
    (frontierAnchor.frontierMessageId ?? null) === (messageAnchor.frontierMessageId ?? null)

  if (!sharesBatch && !sharesFrontierGroup) {
    return false
  }

  return messageAnchor.sequence > frontierAnchor.sequence
}

export const mergeReadByEntries = (
  existing?: Message['readBy'] | null,
  incoming?: Message['readBy'] | null,
): Message['readBy'] | undefined => {
  if (!Array.isArray(existing) && !Array.isArray(incoming)) {
    return undefined
  }

  const mergedByUserId = new Map<string, ReadByEntry>()

  const mergeEntries = (entries?: Message['readBy'] | null) => {
    if (!Array.isArray(entries)) {
      return
    }

    entries.forEach((entry) => {
      if (!entry?.userId) {
        return
      }

      const currentEntry = mergedByUserId.get(entry.userId)
      if (!currentEntry) {
        mergedByUserId.set(entry.userId, entry)
        return
      }

      const currentAtMs = Date.parse(currentEntry.at)
      const nextAtMs = Date.parse(entry.at)
      if (!Number.isFinite(currentAtMs) || nextAtMs > currentAtMs) {
        mergedByUserId.set(entry.userId, entry)
      }
    })
  }

  mergeEntries(existing)
  mergeEntries(incoming)

  return mergedByUserId.size > 0 ? Array.from(mergedByUserId.values()) : undefined
}

export const mergeMessageStatus = (existingStatus?: string, incomingStatus?: string) => {
  const safeExistingStatus = existingStatus?.toUpperCase()
  const safeIncomingStatus = incomingStatus?.toUpperCase()

  if (safeExistingStatus === 'FAILED' && safeIncomingStatus && safeIncomingStatus !== 'FAILED') {
    return safeIncomingStatus
  }

  if (safeIncomingStatus === 'FAILED' && safeExistingStatus && safeExistingStatus !== 'FAILED') {
    return safeExistingStatus
  }

  return getStatusRank(safeExistingStatus) >= getStatusRank(safeIncomingStatus)
    ? safeExistingStatus
    : safeIncomingStatus
}

export const mergeMessageMetadata = (
  existing?: MessageMetadata | null,
  incoming?: MessageMetadata | null,
): MessageMetadata | undefined => {
  if (!existing && !incoming) {
    return undefined
  }

  const kind =
    incoming && Object.prototype.hasOwnProperty.call(incoming, 'kind')
      ? incoming.kind
      : existing?.kind
  const citations =
    incoming && Object.prototype.hasOwnProperty.call(incoming, 'citations')
      ? incoming.citations
      : existing?.citations
  const recommendedReels =
    incoming && Object.prototype.hasOwnProperty.call(incoming, 'recommendedReels')
      ? incoming.recommendedReels
      : existing?.recommendedReels
  const suggestedQueries =
    incoming && Object.prototype.hasOwnProperty.call(incoming, 'suggestedQueries')
      ? incoming.suggestedQueries
      : existing?.suggestedQueries
  const groupActivity =
    incoming && Object.prototype.hasOwnProperty.call(incoming, 'groupActivity')
      ? incoming.groupActivity
      : existing?.groupActivity

  if (
    !kind &&
    citations === undefined &&
    recommendedReels === undefined &&
    suggestedQueries === undefined &&
    groupActivity === undefined
  ) {
    return undefined
  }

  return {
    ...(kind ? { kind } : {}),
    ...(citations !== undefined ? { citations } : {}),
    ...(recommendedReels !== undefined ? { recommendedReels } : {}),
    ...(suggestedQueries !== undefined ? { suggestedQueries } : {}),
    ...(groupActivity !== undefined ? { groupActivity } : {}),
  }
}

export const mergeMessageRecords = <T extends MessageLike>(existing: T, incoming: T): T => {
  const existingHasStableId = Boolean(existing.id && !isTempId(existing.id))
  const incomingHasStableId = Boolean(incoming.id && !isTempId(incoming.id))
  const existingIsPending = String(existing.status || '').toLowerCase() === 'sending'
  const incomingIsPending = String(incoming.status || '').toLowerCase() === 'sending'

  let preferred = incoming
  let fallback = existing

  if (existingHasStableId !== incomingHasStableId) {
    preferred = existingHasStableId ? existing : incoming
    fallback = preferred === existing ? incoming : existing
  } else if (existingIsPending !== incomingIsPending) {
    preferred = existingIsPending ? incoming : existing
    fallback = preferred === existing ? incoming : existing
  } else if (getTimestamp(existing) > getTimestamp(incoming)) {
    preferred = existing
    fallback = incoming
  }

  const mergedMedia = mergeMessageMedia(existing.media, incoming.media)
  const mergedMetadata = mergeMessageMetadata(existing.metadata, incoming.metadata)
  const mergedReadBy = mergeReadByEntries(existing.readBy, incoming.readBy)
  const mergedReplyPreview = mergeReplyPreview(existing.replyPreview, incoming.replyPreview)
  const mergedStatus = mergeMessageStatus(existing.status, incoming.status)

  return {
    ...fallback,
    ...preferred,
    ...(mergedMedia ? { media: mergedMedia } : {}),
    ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
    ...(mergedReadBy ? { readBy: mergedReadBy } : {}),
    ...(mergedReplyPreview ? { replyPreview: mergedReplyPreview } : {}),
    ...(mergedStatus ? { status: mergedStatus } : {}),
  }
}

const mergeMessageMedia = (
  existing?: MessageMedia | null,
  incoming?: MessageMedia | null,
): MessageMedia | undefined => {
  if (!existing && !incoming) {
    return undefined
  }

  return {
    ...(existing ?? {}),
    ...(incoming ?? {}),
  }
}
