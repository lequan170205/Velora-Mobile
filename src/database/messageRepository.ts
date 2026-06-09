import { Q } from '@nozbe/watermelondb'

import { toConversationMessageFromModel } from './conversationBootstrap'
import { database } from './DatabaseManager'
import { TABLES } from './schema'

import type { MessageModel } from './models/MessageModel'
import type { ChatParticipant, Conversation, Message } from '../types/conversation.types'
import type { UserSession } from '../types/user.types'

const findMessageRecordById = async (messageId: string) => {
  try {
    return await database.get<MessageModel>(TABLES.messages).find(messageId)
  } catch {
    return null
  }
}

const buildParticipantsMap = (conversation?: Conversation | null) => {
  const map = new Map<string, ChatParticipant>()

  for (const participant of conversation?.participants ?? []) {
    map.set(participant.id, participant)
  }

  return map
}

export interface LocalMessageWindowAroundId {
  targetMessageId: string
  messages: Message[]
  hasOlder?: boolean
  hasNewer?: boolean
  oldestCursor?: string
  newestCursor?: string
  source: 'local'
}

const MESSAGE_ORDER_BY_DESC = [Q.sortBy('created_at', Q.desc), Q.sortBy('id', Q.desc)] as const
const MESSAGE_ORDER_BY_ASC = [Q.sortBy('created_at', Q.asc), Q.sortBy('id', Q.asc)] as const

const buildNewerThanBoundaryClauses = ({
  conversationId,
  createdAt,
  messageId,
}: {
  conversationId: string
  createdAt: number
  messageId: string
}) =>
  [
    Q.where('conversation_id', conversationId),
    Q.or(
      Q.where('created_at', Q.gt(createdAt)),
      Q.and(Q.where('created_at', createdAt), Q.where('id', Q.gt(messageId))),
    ),
    ...MESSAGE_ORDER_BY_ASC,
  ] as const

const buildOlderThanBoundaryClauses = ({
  conversationId,
  createdAt,
  messageId,
}: {
  conversationId: string
  createdAt: number
  messageId: string
}) =>
  [
    Q.where('conversation_id', conversationId),
    Q.or(
      Q.where('created_at', Q.lt(createdAt)),
      Q.and(Q.where('created_at', createdAt), Q.where('id', Q.lt(messageId))),
    ),
    ...MESSAGE_ORDER_BY_DESC,
  ] as const

export const getLocalMessagesPage = async ({
  conversation,
  conversationId,
  currentUser,
  cursor,
  limit,
}: {
  conversation?: Conversation | null
  conversationId: string
  currentUser?: UserSession | null
  cursor?: string
  limit: number
}): Promise<Message[]> => {
  const messagesCollection = database.get<MessageModel>(TABLES.messages)

  const cursorRecord = cursor ? await findMessageRecordById(cursor) : null

  if (cursor && !cursorRecord) {
    return []
  }

  if (cursorRecord && cursorRecord.conversationId !== conversationId) {
    return []
  }

  const records = await messagesCollection
    .query(
      ...(cursorRecord
        ? buildOlderThanBoundaryClauses({
            conversationId,
            createdAt: cursorRecord.createdAt.getTime(),
            messageId: cursorRecord.id,
          })
        : [Q.where('conversation_id', conversationId), ...MESSAGE_ORDER_BY_DESC]),
      Q.take(limit),
    )
    .fetch()

  const participantsMap = buildParticipantsMap(conversation)

  return records.map((message) =>
    toConversationMessageFromModel({
      currentUser: currentUser ?? null,
      message,
      participantsMap,
    }),
  )
}

export const getLocalMessageWindowAroundId = async (
  conversationId: string,
  messageId: string,
  options: {
    before: number
    after: number
    currentUser?: UserSession | null
    conversation?: Conversation | null
  },
): Promise<LocalMessageWindowAroundId | null> => {
  const targetRecord = await findMessageRecordById(messageId)

  if (!targetRecord || targetRecord.conversationId !== conversationId) {
    return null
  }

  const participantsMap = buildParticipantsMap(options.conversation)
  const targetCreatedAt = targetRecord.createdAt.getTime()
  const beforeLimit = Math.max(0, options.before)
  const afterLimit = Math.max(0, options.after)
  const newerFetchLimit = beforeLimit + 1
  const olderFetchLimit = afterLimit + 1
  const messagesCollection = database.get<MessageModel>(TABLES.messages)

  const [rawNewerRecords, rawOlderRecords] = await Promise.all([
    beforeLimit > 0
      ? messagesCollection
          .query(
            ...buildNewerThanBoundaryClauses({
              conversationId,
              createdAt: targetCreatedAt,
              messageId: targetRecord.id,
            }),
            Q.take(newerFetchLimit),
          )
          .fetch()
      : Promise.resolve([]),
    afterLimit > 0
      ? messagesCollection
          .query(
            ...buildOlderThanBoundaryClauses({
              conversationId,
              createdAt: targetCreatedAt,
              messageId: targetRecord.id,
            }),
            Q.take(olderFetchLimit),
          )
          .fetch()
      : Promise.resolve([]),
  ])

  const hasNewer = rawNewerRecords.length > beforeLimit
  const hasOlder = rawOlderRecords.length > afterLimit
  const newerRecords = rawNewerRecords.slice(0, beforeLimit)
  const olderRecords = rawOlderRecords.slice(0, afterLimit)

  const combinedRecords = [[...newerRecords].reverse(), [targetRecord], olderRecords].flat()
  const messages = combinedRecords.map((message) =>
    toConversationMessageFromModel({
      currentUser: options.currentUser ?? null,
      message,
      participantsMap,
    }),
  )

  const newestRecord = combinedRecords[0] ?? targetRecord
  const oldestRecord = combinedRecords[combinedRecords.length - 1] ?? targetRecord

  return {
    targetMessageId: targetRecord.id,
    messages,
    hasOlder,
    hasNewer,
    ...(oldestRecord?.id ? { oldestCursor: oldestRecord.id } : {}),
    ...(newestRecord?.id ? { newestCursor: newestRecord.id } : {}),
    source: 'local',
  }
}
