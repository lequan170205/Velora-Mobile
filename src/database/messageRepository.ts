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

  const cursorCreatedAt = cursorRecord?.createdAt.getTime() ?? null

  const records = await messagesCollection
    .query(
      Q.where('conversation_id', conversationId),
      ...(cursorCreatedAt ? [Q.where('created_at', Q.lt(cursorCreatedAt))] : []),
      Q.sortBy('created_at', Q.desc),
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
