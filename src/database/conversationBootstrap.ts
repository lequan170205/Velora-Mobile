import type { Collection, Model } from '@nozbe/watermelondb'

import { database } from './DatabaseManager'
import { type MessageModel } from './models/MessageModel'
import { TABLES } from './schema'

import type { ConversationModel } from './models/ConversationModel'
import type { UserModel } from './models/UserModel'
import type {
  ChatParticipant,
  Conversation,
  Message,
  ReactionMap,
} from '../types/conversation.types'
import type { UserSession, UserSummary } from '../types/user.types'

type ConversationBootstrapInput = {
  conversationId: string
  conversation?: Conversation | null
  currentUser?: UserSession | null
}

type BootstrapUserRecord = {
  id: string
  email: string
  username: string | null
  fullName: string | null
  picture: string | null
  isVerified: boolean
  lastSeenAt: number | null
  serverUpdatedAt: number
  createdAt: number
  updatedAt: number
}

const FALLBACK_EMAIL_DOMAIN = 'local.velora'
type MutableRawRecord = Record<string, string | number | null>

const toTimestamp = (value?: string | number | Date | null) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : 0
  }

  if (typeof value === 'string') {
    const nextTimestamp = Date.parse(value)
    return Number.isFinite(nextTimestamp) ? nextTimestamp : 0
  }

  return 0
}

const toIsoString = (value?: Date | string | number | null) => {
  const timestamp = toTimestamp(value)
  const normalizedTimestamp = timestamp || Date.now()

  return new Date(normalizedTimestamp).toISOString()
}

const toNullableString = (value?: string | null) => {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : null
}

const setRawTimestamps = (record: Model, createdAt: number, updatedAt: number) => {
  const raw = record._raw as MutableRawRecord
  raw.created_at = createdAt
  raw.updated_at = updatedAt
}

const findRecordById = async <T extends Model>(collection: Collection<T>, id: string) => {
  try {
    return await collection.find(id)
  } catch {
    return null
  }
}

const buildFallbackEmail = (id: string) => `${id}@${FALLBACK_EMAIL_DOMAIN}`

const buildCurrentUserFullName = (currentUser?: UserSession | null) => {
  if (!currentUser) return null

  return (
    toNullableString(currentUser.fullName) ??
    toNullableString([currentUser.firstName, currentUser.lastName].filter(Boolean).join(' '))
  )
}

const collectBootstrapUsers = ({
  conversation,
  currentUser,
}: Omit<ConversationBootstrapInput, 'conversationId'>) => {
  const usersById = new Map<string, BootstrapUserRecord>()
  const fallbackTimestamp = Date.now()

  const upsertUser = (userRecord: BootstrapUserRecord) => {
    usersById.set(userRecord.id, userRecord)
  }

  if (currentUser?.id) {
    const currentUserCreatedAt = toTimestamp(currentUser.createdAt) || fallbackTimestamp

    upsertUser({
      id: currentUser.id,
      email: currentUser.email,
      username: toNullableString(currentUser.username),
      fullName: buildCurrentUserFullName(currentUser),
      picture: toNullableString(currentUser.picture ?? null),
      isVerified: currentUser.isEmailVerified,
      lastSeenAt: null,
      serverUpdatedAt: fallbackTimestamp,
      createdAt: currentUserCreatedAt,
      updatedAt: fallbackTimestamp,
    })
  }

  for (const participant of conversation?.participants ?? []) {
    const existingUser = usersById.get(participant.id)
    const email =
      toNullableString(participant.email) ??
      existingUser?.email ??
      buildFallbackEmail(participant.id)
    const fullName = toNullableString(participant.fullName) ?? existingUser?.fullName ?? null
    const picture = toNullableString(participant.picture ?? null) ?? existingUser?.picture ?? null

    upsertUser({
      id: participant.id,
      email,
      username: existingUser?.username ?? null,
      fullName,
      picture,
      isVerified: existingUser?.isVerified ?? false,
      lastSeenAt: existingUser?.lastSeenAt ?? null,
      serverUpdatedAt: fallbackTimestamp,
      createdAt: existingUser?.createdAt ?? fallbackTimestamp,
      updatedAt: fallbackTimestamp,
    })
  }

  return Array.from(usersById.values())
}

const getConversationParticipantIds = ({
  conversation,
  currentUser,
  conversationId,
}: ConversationBootstrapInput) => {
  const participantIds = new Set<string>()

  for (const participantId of conversation?.participantIds ?? []) {
    if (participantId) {
      participantIds.add(participantId)
    }
  }

  for (const participant of conversation?.participants ?? []) {
    if (participant.id) {
      participantIds.add(participant.id)
    }
  }

  if (currentUser?.id) {
    participantIds.add(currentUser.id)
  }

  if (participantIds.size === 0) {
    participantIds.add(conversation?.creatorId ?? currentUser?.id ?? conversationId)
  }

  return Array.from(participantIds)
}

export const ensureConversationBootstrap = async ({
  conversationId,
  conversation,
  currentUser,
}: ConversationBootstrapInput) => {
  const usersCollection = database.get<UserModel>(TABLES.users)
  const conversationsCollection = database.get<ConversationModel>(TABLES.conversations)
  const participantIds = getConversationParticipantIds({
    conversationId,
    conversation: conversation ?? null,
    currentUser: currentUser ?? null,
  })
  const creatorId =
    conversation?.creatorId ?? currentUser?.id ?? participantIds[0] ?? conversationId
  const createdAt = toTimestamp(conversation?.createdAt) || Date.now()
  const updatedAt =
    toTimestamp(conversation?.updatedAt) || toTimestamp(conversation?.lastMessageAt) || Date.now()
  const lastMessageAt = toTimestamp(conversation?.lastMessageAt)
  const users = collectBootstrapUsers({
    conversation: conversation ?? null,
    currentUser: currentUser ?? null,
  })

  return database.write(async () => {
    for (const userRecord of users) {
      const existingUser = await findRecordById(usersCollection, userRecord.id)

      if (!existingUser) {
        await usersCollection.create((record) => {
          const raw = record._raw as MutableRawRecord
          raw.id = userRecord.id
          record.email = userRecord.email
          record.username = userRecord.username
          record.fullName = userRecord.fullName
          record.picture = userRecord.picture
          record.isVerified = userRecord.isVerified
          record.lastSeenAt = userRecord.lastSeenAt
          record.serverUpdatedAt = userRecord.serverUpdatedAt
          setRawTimestamps(record, userRecord.createdAt, userRecord.updatedAt)
        })
        continue
      }

      await existingUser.update((record) => {
        record.email = userRecord.email || record.email
        record.username = userRecord.username ?? record.username
        record.fullName = userRecord.fullName ?? record.fullName
        record.picture = userRecord.picture ?? record.picture
        record.isVerified = userRecord.isVerified || record.isVerified
        record.lastSeenAt = userRecord.lastSeenAt ?? record.lastSeenAt
        record.serverUpdatedAt = Math.max(record.serverUpdatedAt, userRecord.serverUpdatedAt)
        ;(record._raw as MutableRawRecord).updated_at = userRecord.updatedAt
      })
    }

    const existingConversation = await findRecordById(conversationsCollection, conversationId)

    if (!existingConversation) {
      return conversationsCollection.create((record) => {
        const raw = record._raw as MutableRawRecord
        raw.id = conversationId
        record.creatorId = creatorId
        record.participantIds = participantIds
        record.name = toNullableString(conversation?.name) ?? null
        record.picture = toNullableString(conversation?.picture ?? null)
        record.isGroup = conversation?.isGroup ?? false
        record.lastMessage = toNullableString(conversation?.lastMessage ?? null)
        record.lastMessageAt = lastMessageAt || null
        record.unreadCount = conversation?.unreadCount ?? 0
        record.serverUpdatedAt = updatedAt
        setRawTimestamps(record, createdAt, updatedAt)
      })
    }

    await existingConversation.update((record) => {
      record.creatorId = creatorId
      record.participantIds = participantIds
      record.name = toNullableString(conversation?.name) ?? record.name
      record.picture = toNullableString(conversation?.picture ?? null) ?? record.picture
      record.isGroup = conversation?.isGroup ?? record.isGroup
      record.lastMessage = toNullableString(conversation?.lastMessage ?? null) ?? record.lastMessage
      record.lastMessageAt = lastMessageAt || record.lastMessageAt
      record.unreadCount = conversation?.unreadCount ?? record.unreadCount
      record.serverUpdatedAt = Math.max(record.serverUpdatedAt, updatedAt)
      ;(record._raw as MutableRawRecord).updated_at = updatedAt
    })

    return existingConversation
  })
}

const getMessageSender = ({
  senderId,
  currentUser,
  participantsMap,
}: {
  senderId: string
  currentUser?: UserSession | null
  participantsMap: Map<string, ChatParticipant>
}): UserSummary => {
  const participant = participantsMap.get(senderId)
  const fallbackEmail =
    participant?.email ??
    (currentUser?.id === senderId ? currentUser.email : null) ??
    buildFallbackEmail(senderId)

  return {
    id: senderId,
    email: fallbackEmail,
    picture:
      participant?.picture ?? (currentUser?.id === senderId ? (currentUser.picture ?? null) : null),
  }
}

export const toConversationMessageFromModel = ({
  currentUser,
  message,
  participantsMap,
}: {
  currentUser?: UserSession | null
  message: MessageModel
  participantsMap: Map<string, ChatParticipant>
}): Message => {
  const raw = message._raw as Record<string, unknown>
  const senderId = String(raw.sender_id)
  const conversationId = String(raw.conversation_id)
  const content =
    (typeof raw.content === 'string' && raw.content.length > 0 ? raw.content : null) ??
    (typeof raw.body === 'string' && raw.body.length > 0 ? raw.body : null) ??
    message.content
  const createdAt = toIsoString(message.createdAt)
  const updatedAt = toIsoString(message.updatedAt)
  const recalledAt = message.recalledAt ? toIsoString(message.recalledAt) : undefined
  const replyPreviewValue =
    typeof message.replyPreview === 'string' ? message.replyPreview : message.replyPreview
  const reactions = message.reactions ?? undefined
  const response: Message = {
    id: message.id,
    _id: message.id,
    conversationId,
    senderId,
    sender: getMessageSender({ senderId, currentUser: currentUser ?? null, participantsMap }),
    content,
    type: message.type,
    status: message.status,
    createdAt,
    updatedAt,
    ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
    ...(message.media ? { media: message.media } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {}),
    ...(message.readBy ? { readBy: message.readBy } : {}),
    ...(message.replyToId ? { replyToId: message.replyToId, reply_to_id: message.replyToId } : {}),
    ...(replyPreviewValue
      ? {
          replyPreview: replyPreviewValue,
          ...(typeof replyPreviewValue === 'string' ? { reply_preview: replyPreviewValue } : {}),
        }
      : {}),
    ...(reactions ? { reactions: reactions as ReactionMap } : {}),
    ...(message.isDeleted ? { isDeleted: true } : {}),
    ...(message.isRecalled ? { isRecalled: true, is_recalled: true } : {}),
    ...(recalledAt ? { recalledAt, recalled_at: recalledAt } : {}),
  }

  return response
}
