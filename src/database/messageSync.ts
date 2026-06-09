import { Q } from '@nozbe/watermelondb'

import type { Collection, Model } from '@nozbe/watermelondb'

import { ensureConversationBootstrap } from './conversationBootstrap'
import { database } from './DatabaseManager'
import { TABLES } from './schema'

import type { ConversationModel } from './models/ConversationModel'
import type { MessageModel, MessageStatusValue } from './models/MessageModel'
import type { UserModel } from './models/UserModel'
import type { Conversation, Message, ReplyPreviewData } from '../types/conversation.types'
import type { UserSession } from '../types/user.types'

type MutableRawRecord = Record<string, string | number | null>

type MessageContext = {
  conversation?: Conversation | null
  currentUser?: UserSession | null
  incrementUnread?: boolean
}

type PendingTextMessageInput = MessageContext & {
  clientMessageId: string
  content: string
  conversationId: string
  replyPreview?: string | ReplyPreviewData | null
  replyToId?: string | null
}

type PendingMediaMessageInput = PendingTextMessageInput & {
  media: NonNullable<Message['media']>
  type: 'image' | 'video'
}

type MediaProcessingPayload = {
  conversationId?: string
  fileKey?: string
  media?: Message['media']
  messageIds?: string[]
}

type ConversationUpdateAggregate = {
  latestCreatedAt: number
  latestMessageContent: string
  maxUpdatedAt: number
  unreadIncrement: number
}

type PreparedRemoteMessage = {
  content: string
  createdAt: number
  normalizedMessage: Message
  updatedAt: number
}

const FALLBACK_EMAIL_DOMAIN = 'local.velora'

const compactBatchOperations = <T>(operations: (T | null | undefined | false)[]) =>
  operations.filter(Boolean) as T[]

const toNullableString = (value?: string | null) => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

const toTimestamp = (value?: string | number | Date | null) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : 0
  }

  if (typeof value === 'string') {
    const parsedValue = Date.parse(value)
    return Number.isFinite(parsedValue) ? parsedValue : 0
  }

  return 0
}

const toIsoString = (value?: string | number | Date | null) => {
  const timestamp = toTimestamp(value) || Date.now()
  return new Date(timestamp).toISOString()
}

const buildFallbackEmail = (id: string) => `${id}@${FALLBACK_EMAIL_DOMAIN}`

const getMessageContent = (message: Partial<Message> & { body?: unknown }) => {
  if (typeof message.content === 'string' && message.content.length > 0) {
    return message.content
  }

  if (typeof message.body === 'string' && message.body.length > 0) {
    return message.body
  }

  return ''
}

const getMessageReplyToId = (message: Partial<Message>) => {
  return toNullableString(message.replyToId ?? message.reply_to_id ?? null)
}

const getMessageReplyPreview = (message: Partial<Message>) => {
  return message.replyPreview ?? message.reply_preview ?? null
}

const mergeReplyPreview = (
  existingReplyPreview: string | ReplyPreviewData | null,
  incomingReplyPreview: string | ReplyPreviewData | null,
) => {
  if (!incomingReplyPreview) {
    return existingReplyPreview
  }

  if (!existingReplyPreview) {
    return incomingReplyPreview
  }

  if (typeof existingReplyPreview === 'string' || typeof incomingReplyPreview === 'string') {
    return incomingReplyPreview
  }

  if (incomingReplyPreview.thumbnailUri || !existingReplyPreview.thumbnailUri) {
    return {
      ...incomingReplyPreview,
      ...(incomingReplyPreview.senderId ? {} : { senderId: existingReplyPreview.senderId }),
      ...(incomingReplyPreview.mediaWidth ? {} : { mediaWidth: existingReplyPreview.mediaWidth }),
      ...(incomingReplyPreview.mediaHeight
        ? {}
        : { mediaHeight: existingReplyPreview.mediaHeight }),
    }
  }

  return {
    ...incomingReplyPreview,
    thumbnailUri: existingReplyPreview.thumbnailUri,
    ...(incomingReplyPreview.senderId ? {} : { senderId: existingReplyPreview.senderId }),
    ...(incomingReplyPreview.mediaWidth ? {} : { mediaWidth: existingReplyPreview.mediaWidth }),
    ...(incomingReplyPreview.mediaHeight ? {} : { mediaHeight: existingReplyPreview.mediaHeight }),
  }
}

const getMessageRecalledAt = (message: Partial<Message>) => {
  return toTimestamp(message.recalledAt ?? message.recalled_at ?? null) || null
}

const getMessageCreatedAt = (message: Partial<Message>) => {
  return toTimestamp(message.createdAt) || Date.now()
}

const getMessageUpdatedAt = (message: Partial<Message>) => {
  return toTimestamp(message.updatedAt) || getMessageCreatedAt(message)
}

const normalizeMessageStatus = (status?: string | null): MessageStatusValue => {
  switch (status) {
    case 'PENDING':
    case 'SENT':
    case 'DELIVERED':
    case 'READ':
    case 'FAILED':
      return status
    default:
      return 'SENT'
  }
}

const buildConversationContextFromMessage = ({
  message,
  conversation,
  currentUser,
}: {
  message: Message
  conversation?: Conversation | null
  currentUser?: UserSession | null
}): Conversation => {
  if (conversation) {
    return conversation
  }

  const participantIds = Array.from(
    new Set(
      [currentUser?.id ?? null, message.senderId].filter((value): value is string =>
        Boolean(value),
      ),
    ),
  )

  const senderParticipant =
    message.senderId && message.sender
      ? [
          {
            id: message.senderId,
            email: message.sender.email,
            ...(message.sender.picture ? { picture: message.sender.picture } : {}),
          },
        ]
      : []

  return {
    id: message.conversationId,
    creatorId: currentUser?.id ?? message.senderId,
    participantIds,
    participants: senderParticipant,
    lastMessage: getMessageContent(message),
    lastMessageAt: message.createdAt ?? toIsoString(Date.now()),
    createdAt: message.createdAt ?? toIsoString(Date.now()),
    updatedAt: message.updatedAt ?? message.createdAt ?? toIsoString(Date.now()),
    isGroup: false,
  }
}

const buildUserRecordFromMessage = (message: Message, currentUser?: UserSession | null) => {
  const isCurrentUser = currentUser?.id === message.senderId
  const fullName = isCurrentUser
    ? toNullableString(
        currentUser.fullName ??
          [currentUser.firstName, currentUser.lastName].filter(Boolean).join(' '),
      )
    : null

  return {
    id: message.senderId,
    email: toNullableString(message.sender?.email) ?? (isCurrentUser ? currentUser.email : null),
    fullName,
    picture: toNullableString(
      message.sender?.picture ?? (isCurrentUser ? (currentUser.picture ?? null) : null),
    ),
    isVerified: isCurrentUser ? currentUser.isEmailVerified : false,
    createdAt: getMessageCreatedAt(message),
    updatedAt: getMessageUpdatedAt(message),
  }
}

const findRecordById = async <T extends Model>(collection: Collection<T>, id: string) => {
  try {
    return await collection.find(id)
  } catch {
    return null
  }
}

const findMessageByClientMessageId = async ({
  clientMessageId,
  conversationId,
}: {
  clientMessageId: string
  conversationId?: string
}) => {
  const messagesCollection = database.get<MessageModel>(TABLES.messages)
  const queryConditions = [
    ...(conversationId ? [Q.where('conversation_id', conversationId)] : []),
    Q.where('client_message_id', clientMessageId),
  ]

  const records = await messagesCollection.query(...queryConditions).fetch()
  return records[0] ?? null
}

const prepareMessageRecord = ({
  content,
  createdAt,
  existingReplyPreview,
  message,
  record,
  status,
  updatedAt,
}: {
  content: string
  createdAt: number
  existingReplyPreview?: string | ReplyPreviewData | null
  message: Message
  record: MessageModel
  status: MessageStatusValue
  updatedAt: number
}) => {
  record.clientMessageId = message.clientMessageId ?? null
  record.content = content
  record.media = message.media ?? null
  record.type = message.type
  record.status = status
  record.readBy = message.readBy ?? null
  record.replyToId = getMessageReplyToId(message)
  record.replyPreview = mergeReplyPreview(
    existingReplyPreview ?? null,
    getMessageReplyPreview(message),
  )
  record.reactions = message.reactions ?? null
  record.isDeleted = message.isDeleted ?? false
  record.isRecalled = message.isRecalled === true || message.is_recalled === true
  record.recalledAt = getMessageRecalledAt(message)
  record.serverUpdatedAt = updatedAt

  const raw = record._raw as MutableRawRecord
  raw.created_at = createdAt
  raw.updated_at = updatedAt
}

const prepareRemoteMessage = (message: Message): PreparedRemoteMessage => {
  const normalizedMessage: Message = {
    ...message,
    id: message.id || message._id || message.clientMessageId || '',
    content: getMessageContent(message),
    createdAt: message.createdAt ?? toIsoString(Date.now()),
    updatedAt: message.updatedAt ?? message.createdAt ?? toIsoString(Date.now()),
    status: normalizeMessageStatus(message.status),
  }

  return {
    content: getMessageContent(normalizedMessage),
    createdAt: getMessageCreatedAt(normalizedMessage),
    normalizedMessage,
    updatedAt: getMessageUpdatedAt(normalizedMessage),
  }
}

const accumulateConversationUpdate = ({
  aggregateByConversationId,
  incrementUnread,
  message,
}: {
  aggregateByConversationId: Map<string, ConversationUpdateAggregate>
  incrementUnread: boolean
  message: PreparedRemoteMessage
}) => {
  const conversationId = message.normalizedMessage.conversationId
  const existingAggregate = aggregateByConversationId.get(conversationId)

  if (!existingAggregate) {
    aggregateByConversationId.set(conversationId, {
      latestCreatedAt: message.createdAt,
      latestMessageContent: message.content,
      maxUpdatedAt: message.updatedAt,
      unreadIncrement: incrementUnread ? 1 : 0,
    })
    return
  }

  if (message.createdAt >= existingAggregate.latestCreatedAt) {
    existingAggregate.latestCreatedAt = message.createdAt
    existingAggregate.latestMessageContent = message.content
  }

  existingAggregate.maxUpdatedAt = Math.max(existingAggregate.maxUpdatedAt, message.updatedAt)
  if (incrementUnread) {
    existingAggregate.unreadIncrement += 1
  }
}

const ensureSenderRecord = async ({
  currentUser,
  message,
}: {
  currentUser?: UserSession | null
  message: Message
}) => {
  const usersCollection = database.get<UserModel>(TABLES.users)
  const senderRecord = buildUserRecordFromMessage(message, currentUser)

  return database.write(async () => {
    const existingSender = await findRecordById(usersCollection, senderRecord.id)

    if (!existingSender) {
      return usersCollection.create((record) => {
        const raw = record._raw as MutableRawRecord
        raw.id = senderRecord.id
        raw.created_at = senderRecord.createdAt
        raw.updated_at = senderRecord.updatedAt
        record.email = senderRecord.email ?? buildFallbackEmail(senderRecord.id)
        record.username = null
        record.fullName = senderRecord.fullName
        record.picture = senderRecord.picture
        record.isVerified = senderRecord.isVerified
        record.lastSeenAt = null
        record.serverUpdatedAt = senderRecord.updatedAt
      })
    }

    return existingSender.update((record) => {
      record.email = senderRecord.email ?? record.email
      record.fullName = senderRecord.fullName ?? record.fullName
      record.picture = senderRecord.picture ?? record.picture
      record.isVerified = senderRecord.isVerified || record.isVerified
      record.serverUpdatedAt = Math.max(record.serverUpdatedAt, senderRecord.updatedAt)
      ;(record._raw as MutableRawRecord).updated_at = senderRecord.updatedAt
    })
  })
}

export const createPendingTextMessage = async ({
  clientMessageId,
  content,
  conversation,
  conversationId,
  currentUser,
  replyPreview,
  replyToId,
}: PendingTextMessageInput) => {
  if (!currentUser?.id) {
    throw new Error('User is not authenticated')
  }

  const now = Date.now()
  const conversationRecord = await ensureConversationBootstrap({
    conversationId,
    conversation: conversation ?? null,
    currentUser,
  })

  return conversationRecord.addMessage({
    senderId: currentUser.id,
    clientMessageId,
    content,
    type: 'text',
    status: 'PENDING',
    readBy: [{ userId: currentUser.id, at: new Date(now).toISOString() }],
    replyToId: replyToId ?? null,
    replyPreview: replyPreview ?? null,
    serverUpdatedAt: now,
    lastMessageAt: now,
  })
}

export const createPendingMediaMessage = async ({
  clientMessageId,
  content,
  conversation,
  conversationId,
  currentUser,
  media,
  replyPreview,
  replyToId,
  type,
}: PendingMediaMessageInput) => {
  if (!currentUser?.id) {
    throw new Error('User is not authenticated')
  }

  const now = Date.now()
  const conversationRecord = await ensureConversationBootstrap({
    conversationId,
    conversation: conversation ?? null,
    currentUser,
  })

  return conversationRecord.addMessage({
    senderId: currentUser.id,
    clientMessageId,
    content,
    media,
    type,
    status: 'PENDING',
    readBy: [{ userId: currentUser.id, at: new Date(now).toISOString() }],
    replyToId: replyToId ?? null,
    replyPreview: replyPreview ?? null,
    serverUpdatedAt: now,
    lastMessageAt: now,
  })
}

export const patchLocalMediaMessage = async ({
  clientMessageId,
  clearFailureReason,
  conversationId,
  mediaPatch,
  status,
}: {
  clientMessageId: string
  clearFailureReason?: boolean
  conversationId: string
  mediaPatch: Partial<NonNullable<Message['media']>>
  status?: MessageStatusValue
}) => {
  const existingMessage = await findMessageByClientMessageId({
    clientMessageId,
    conversationId,
  })

  if (!existingMessage) {
    return
  }

  const nextUpdatedAt = Date.now()
  await database.write(async () => {
    await existingMessage.update((record) => {
      const nextMedia: NonNullable<Message['media']> = {
        ...(record.media ?? {}),
        ...mediaPatch,
      }

      if (clearFailureReason) {
        delete nextMedia.failureReason
      }

      record.media = nextMedia
      if (status) {
        record.status = status
      }
      record.serverUpdatedAt = nextUpdatedAt
      ;(record._raw as MutableRawRecord).updated_at = nextUpdatedAt
    })
  })
}

export const markMediaMessageFailed = async ({
  clientMessageId,
  conversationId,
  failureReason,
}: {
  clientMessageId: string
  conversationId: string
  failureReason: string
}) => {
  await patchLocalMediaMessage({
    clientMessageId,
    conversationId,
    mediaPatch: {
      failureReason,
      uploadStage: 'failed',
    },
    status: 'FAILED',
  })
}

export const deletePendingMediaMessage = async ({
  clientMessageId,
  conversationId,
}: {
  clientMessageId: string
  conversationId: string
}) => {
  const existingMessage = await findMessageByClientMessageId({
    clientMessageId,
    conversationId,
  })

  if (!existingMessage || !existingMessage.id.startsWith('temp-')) {
    return
  }

  await database.write(async () => {
    await existingMessage.destroyPermanently()
  })

  const remainingMessages = await database
    .get<MessageModel>(TABLES.messages)
    .query(Q.where('conversation_id', conversationId), Q.sortBy('created_at', Q.desc), Q.take(1))
    .fetch()
  const latestMessage = remainingMessages[0] ?? null
  const conversation = await findRecordById(
    database.get<ConversationModel>(TABLES.conversations),
    conversationId,
  )

  if (!conversation) {
    return
  }

  await database.write(async () => {
    const nextUpdatedAt = Date.now()
    await conversation.update((record) => {
      record.lastMessage = latestMessage?.content ?? null
      record.lastMessageAt = latestMessage?.createdAt.getTime() ?? null
      record.serverUpdatedAt = nextUpdatedAt
      ;(record._raw as MutableRawRecord).updated_at = nextUpdatedAt
    })
  })
}

export const upsertRemoteMessage = async ({
  conversation,
  currentUser,
  incrementUnread,
  message,
}: MessageContext & {
  message: Message
}) => {
  const upsertedIds = await upsertRemoteMessages({
    conversation: conversation ?? null,
    currentUser: currentUser ?? null,
    ...(incrementUnread !== undefined ? { incrementUnread } : {}),
    messages: [message],
  })

  return upsertedIds[0] ?? null
}

export const upsertRemoteMessages = async ({
  conversation,
  currentUser,
  incrementUnread,
  messages,
}: MessageContext & {
  messages: Message[]
}) => {
  const preparedMessages = messages
    .map(prepareRemoteMessage)
    .filter((message) => Boolean(message.normalizedMessage.id))

  if (preparedMessages.length === 0) {
    return []
  }

  const latestMessageByConversationId = new Map<string, Message>()
  const latestMessageBySenderId = new Map<string, Message>()

  for (const preparedMessage of preparedMessages) {
    const existingConversationMessage = latestMessageByConversationId.get(
      preparedMessage.normalizedMessage.conversationId,
    )
    if (
      !existingConversationMessage ||
      preparedMessage.createdAt >= getMessageCreatedAt(existingConversationMessage)
    ) {
      latestMessageByConversationId.set(
        preparedMessage.normalizedMessage.conversationId,
        preparedMessage.normalizedMessage,
      )
    }

    const existingSenderMessage = latestMessageBySenderId.get(
      preparedMessage.normalizedMessage.senderId,
    )
    if (
      !existingSenderMessage ||
      preparedMessage.updatedAt >= getMessageUpdatedAt(existingSenderMessage)
    ) {
      latestMessageBySenderId.set(
        preparedMessage.normalizedMessage.senderId,
        preparedMessage.normalizedMessage,
      )
    }
  }

  for (const preparedMessage of preparedMessages) {
    const existingConversationMessage = latestMessageByConversationId.get(
      preparedMessage.normalizedMessage.conversationId,
    )
    if (existingConversationMessage !== preparedMessage.normalizedMessage) {
      continue
    }

    await ensureConversationBootstrap({
      conversationId: preparedMessage.normalizedMessage.conversationId,
      conversation: buildConversationContextFromMessage({
        message: preparedMessage.normalizedMessage,
        conversation: conversation ?? null,
        currentUser: currentUser ?? null,
      }),
      currentUser: currentUser ?? null,
    })
  }

  for (const senderMessage of latestMessageBySenderId.values()) {
    await ensureSenderRecord({
      currentUser: currentUser ?? null,
      message: senderMessage,
    })
  }

  const messagesCollection = database.get<MessageModel>(TABLES.messages)
  const conversationsCollection = database.get<ConversationModel>(TABLES.conversations)
  const uniqueConversationIds = Array.from(
    new Set(preparedMessages.map((message) => message.normalizedMessage.conversationId)),
  )
  const uniqueMessageIds = Array.from(
    new Set(preparedMessages.map((message) => message.normalizedMessage.id)),
  )
  const uniqueClientMessageIds = Array.from(
    new Set(
      preparedMessages
        .map((message) => message.normalizedMessage.clientMessageId)
        .filter((clientMessageId): clientMessageId is string => Boolean(clientMessageId)),
    ),
  )

  return database.write(async () => {
    const existingById = uniqueMessageIds.length
      ? await messagesCollection.query(Q.where('id', Q.oneOf(uniqueMessageIds))).fetch()
      : []
    const existingByIdMap = new Map(existingById.map((record) => [record.id, record]))

    const existingByClientMessageId = uniqueClientMessageIds.length
      ? await messagesCollection
          .query(Q.where('client_message_id', Q.oneOf(uniqueClientMessageIds)))
          .fetch()
      : []
    const existingByClientMessageIdMap = new Map(
      existingByClientMessageId
        .filter((record) => record.clientMessageId)
        .map((record) => [record.clientMessageId as string, record]),
    )

    const conversationRecords = uniqueConversationIds.length
      ? await conversationsCollection.query(Q.where('id', Q.oneOf(uniqueConversationIds))).fetch()
      : []
    const conversationRecordMap = new Map(conversationRecords.map((record) => [record.id, record]))

    const conversationUpdateAggregateById = new Map<string, ConversationUpdateAggregate>()
    const messageOperations = preparedMessages.flatMap((preparedMessage) => {
      const normalizedMessage = preparedMessage.normalizedMessage
      const existingMessageById = existingByIdMap.get(normalizedMessage.id) ?? null
      const existingMessageByClientMessageId = normalizedMessage.clientMessageId
        ? (existingByClientMessageIdMap.get(normalizedMessage.clientMessageId) ?? null)
        : null
      const pendingLocalRecord =
        existingMessageByClientMessageId &&
        existingMessageByClientMessageId.id.startsWith('temp-') &&
        existingMessageByClientMessageId.id !== normalizedMessage.id
          ? existingMessageByClientMessageId
          : null
      const shouldIncrementConversationUnread = Boolean(
        incrementUnread && !existingMessageById && !existingMessageByClientMessageId,
      )

      accumulateConversationUpdate({
        aggregateByConversationId: conversationUpdateAggregateById,
        incrementUnread: shouldIncrementConversationUnread,
        message: preparedMessage,
      })

      if (existingMessageById) {
        return compactBatchOperations([
          pendingLocalRecord?.prepareDestroyPermanently(),
          existingMessageById.prepareUpdate((record) => {
            prepareMessageRecord({
              content: preparedMessage.content,
              createdAt: preparedMessage.createdAt,
              existingReplyPreview: record.replyPreview,
              message: normalizedMessage,
              record,
              status: normalizeMessageStatus(normalizedMessage.status),
              updatedAt: preparedMessage.updatedAt,
            })
          }),
        ])
      }

      return compactBatchOperations([
        pendingLocalRecord?.prepareDestroyPermanently(),
        messagesCollection.prepareCreate((record) => {
          const raw = record._raw as MutableRawRecord
          raw.id = normalizedMessage.id
          record.conversationId = normalizedMessage.conversationId
          record.senderId = normalizedMessage.senderId
          prepareMessageRecord({
            content: preparedMessage.content,
            createdAt: preparedMessage.createdAt,
            existingReplyPreview: pendingLocalRecord?.replyPreview ?? null,
            message: normalizedMessage,
            record,
            status: normalizeMessageStatus(normalizedMessage.status),
            updatedAt: preparedMessage.updatedAt,
          })
        }),
      ])
    })

    const conversationOperations = Array.from(conversationUpdateAggregateById.entries()).map(
      ([conversationId, aggregate]) => {
        const conversationRecord = conversationRecordMap.get(conversationId)

        if (!conversationRecord) {
          return null
        }

        const shouldUpdateLastMessage =
          conversationRecord.lastMessageAt === null ||
          aggregate.latestCreatedAt >= conversationRecord.lastMessageAt
        const nextServerUpdatedAt = Math.max(
          conversationRecord.serverUpdatedAt,
          aggregate.maxUpdatedAt,
        )
        const nextRawUpdatedAt = Math.max(
          toTimestamp((conversationRecord._raw as MutableRawRecord).updated_at),
          aggregate.maxUpdatedAt,
        )
        const shouldApplyUpdate =
          shouldUpdateLastMessage ||
          aggregate.unreadIncrement > 0 ||
          nextServerUpdatedAt !== conversationRecord.serverUpdatedAt ||
          nextRawUpdatedAt !== toTimestamp((conversationRecord._raw as MutableRawRecord).updated_at)

        if (!shouldApplyUpdate) {
          return null
        }

        return conversationRecord.prepareUpdate((record) => {
          if (shouldUpdateLastMessage) {
            record.lastMessage = aggregate.latestMessageContent
            record.lastMessageAt = aggregate.latestCreatedAt
          }

          record.serverUpdatedAt = nextServerUpdatedAt
          if (aggregate.unreadIncrement > 0) {
            record.unreadCount += aggregate.unreadIncrement
          }

          ;(record._raw as MutableRawRecord).updated_at = nextRawUpdatedAt
        })
      },
    )

    const operations = compactBatchOperations([...messageOperations, ...conversationOperations])

    if (operations.length === 0) {
      return []
    }

    await database.batch(...operations.filter(Boolean))
    return preparedMessages.map((message) => message.normalizedMessage.id)
  })
}

export const markMessageFailed = async ({
  clientMessageId,
  conversationId,
}: {
  clientMessageId: string
  conversationId?: string
}) => {
  const existingMessage =
    (await findMessageByClientMessageId({
      clientMessageId,
      ...(conversationId ? { conversationId } : {}),
    })) ??
    (conversationId
      ? await findRecordById(database.get<MessageModel>(TABLES.messages), clientMessageId)
      : null)

  if (!existingMessage) {
    return
  }

  await database.write(async () => {
    const nextUpdatedAt = Date.now()

    await existingMessage.update((record) => {
      record.status = 'FAILED'
      record.serverUpdatedAt = nextUpdatedAt
      ;(record._raw as MutableRawRecord).updated_at = nextUpdatedAt
    })
  })
}

export const markMessageRecalled = async ({
  messageId,
  recalledAt,
}: {
  messageId: string
  recalledAt?: string
}) => {
  const messageRecord =
    (await findRecordById(database.get<MessageModel>(TABLES.messages), messageId)) ??
    (await findMessageByClientMessageId({ clientMessageId: messageId }))

  if (!messageRecord) {
    return
  }

  const recalledAtTimestamp = toTimestamp(recalledAt) || Date.now()

  await database.write(async () => {
    await messageRecord.update((record) => {
      record.isRecalled = true
      record.recalledAt = recalledAtTimestamp
      record.reactions = null
      record.serverUpdatedAt = recalledAtTimestamp
      ;(record._raw as MutableRawRecord).updated_at = recalledAtTimestamp
    })
  })
}

export const applyReplyPreviewUpdate = async ({
  messageIds,
  previewContent,
}: {
  messageIds: string[]
  previewContent: string
}) => {
  const messagesCollection = database.get<MessageModel>(TABLES.messages)
  const records = await messagesCollection.query(Q.where('id', Q.oneOf(messageIds))).fetch()

  if (records.length === 0) {
    return
  }

  const nextUpdatedAt = Date.now()

  await database.write(async () => {
    const operations = records
      .filter((record) => record.replyPreview)
      .map((record) =>
        record.prepareUpdate((draft) => {
          const nextReplyPreview =
            typeof draft.replyPreview === 'object' && draft.replyPreview
              ? { ...draft.replyPreview, content: previewContent }
              : previewContent

          draft.replyPreview = nextReplyPreview
          draft.serverUpdatedAt = nextUpdatedAt
          ;(draft._raw as MutableRawRecord).updated_at = nextUpdatedAt
        }),
      )

    if (operations.length > 0) {
      await database.batch(...compactBatchOperations(operations))
    }
  })
}

export const applyMediaProcessingUpdate = async ({
  conversationId,
  fileKey,
  media,
  messageIds,
}: MediaProcessingPayload) => {
  if (!media) {
    return
  }

  const messagesCollection = database.get<MessageModel>(TABLES.messages)
  const normalizedIds = (messageIds ?? []).filter(Boolean)
  let records: MessageModel[] = []

  if (conversationId && normalizedIds.length > 0) {
    records = await messagesCollection
      .query(Q.where('conversation_id', conversationId), Q.where('id', Q.oneOf(normalizedIds)))
      .fetch()
  } else if (normalizedIds.length > 0) {
    records = await messagesCollection.query(Q.where('id', Q.oneOf(normalizedIds))).fetch()
  } else if (fileKey) {
    records = await messagesCollection.query(Q.where('media', Q.like(`%${fileKey}%`))).fetch()
  }

  if (records.length === 0) {
    return
  }

  const nextUpdatedAt = Date.now()

  await database.write(async () => {
    const operations = records.map((record) =>
      record.prepareUpdate((draft) => {
        draft.media = {
          ...(draft.media ?? {}),
          ...media,
        }
        draft.serverUpdatedAt = nextUpdatedAt
        ;(draft._raw as MutableRawRecord).updated_at = nextUpdatedAt
      }),
    )

    await database.batch(...compactBatchOperations(operations))
  })
}

export const applyReadReceiptUpdate = async ({
  at,
  conversationId,
  currentUserId,
  readByUserId,
}: {
  at?: string
  conversationId: string
  currentUserId: string
  readByUserId: string
}) => {
  const messagesCollection = database.get<MessageModel>(TABLES.messages)
  const records = await messagesCollection
    .query(Q.where('conversation_id', conversationId), Q.where('sender_id', currentUserId))
    .fetch()

  if (records.length === 0) {
    return
  }

  const seenAt = at ?? new Date().toISOString()
  const nextUpdatedAt = toTimestamp(seenAt) || Date.now()

  await database.write(async () => {
    const operations = records.map((record) =>
      record.prepareUpdate((draft) => {
        const nextReadBy = Array.isArray(draft.readBy) ? [...draft.readBy] : []
        const alreadyMarked = nextReadBy.some((entry) => entry.userId === readByUserId)

        if (!alreadyMarked) {
          nextReadBy.push({ userId: readByUserId, at: seenAt })
        }

        draft.readBy = nextReadBy
        draft.status = 'READ'
        draft.serverUpdatedAt = nextUpdatedAt
        ;(draft._raw as MutableRawRecord).updated_at = nextUpdatedAt
      }),
    )

    await database.batch(...compactBatchOperations(operations))
  })
}
