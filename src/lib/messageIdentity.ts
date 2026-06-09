import type { Message, MessageMedia } from '../types/conversation.types'

type MessageLike = Partial<
  Pick<
    Message,
    'id' | '_id' | 'clientMessageId' | 'createdAt' | 'updatedAt' | 'media' | 'replyPreview'
  >
> & {
  status?: string
}

const isTempId = (value?: string | null) => Boolean(value?.startsWith('temp-'))

const getTimestamp = (message: MessageLike) => {
  const value = message.updatedAt ?? message.createdAt
  return value ? new Date(value).getTime() : 0
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

export const isSameMessageIdentity = (left?: MessageLike | null, right?: MessageLike | null) => {
  const rightTokens = new Set(getMessageIdentityTokens(right))
  return getMessageIdentityTokens(left).some((token) => rightTokens.has(token))
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
  const mergedReplyPreview = mergeReplyPreview(existing.replyPreview, incoming.replyPreview)

  return {
    ...fallback,
    ...preferred,
    ...(mergedMedia ? { media: mergedMedia } : {}),
    ...(mergedReplyPreview ? { replyPreview: mergedReplyPreview } : {}),
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

const mergeReplyPreview = (
  existing?: Message['replyPreview'],
  incoming?: Message['replyPreview'],
): Message['replyPreview'] | undefined => {
  if (!incoming) {
    return existing
  }

  if (!existing) {
    return incoming
  }

  if (typeof existing === 'string' || typeof incoming === 'string') {
    return incoming
  }

  if (incoming.thumbnailUri || !existing.thumbnailUri) {
    return {
      ...incoming,
      ...(incoming.senderId ? {} : { senderId: existing.senderId }),
      ...(incoming.mediaWidth ? {} : { mediaWidth: existing.mediaWidth }),
      ...(incoming.mediaHeight ? {} : { mediaHeight: existing.mediaHeight }),
    }
  }

  return {
    ...incoming,
    thumbnailUri: existing.thumbnailUri,
    ...(incoming.senderId ? {} : { senderId: existing.senderId }),
    ...(incoming.mediaWidth ? {} : { mediaWidth: existing.mediaWidth }),
    ...(incoming.mediaHeight ? {} : { mediaHeight: existing.mediaHeight }),
  }
}
