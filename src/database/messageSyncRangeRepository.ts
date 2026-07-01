import { Q } from '@nozbe/watermelondb'

import { database } from './DatabaseManager'
import {
  type MessageSyncRangeModel,
  type MessageSyncRangeSource,
  type MessageSyncRangeType,
} from './models/MessageSyncRangeModel'
import { TABLES } from './schema'

import type { Message } from '../types/conversation.types'

export interface MessageSyncRangeBoundary {
  startMessageId: string | null
  startCreatedAt: number | null
  endMessageId: string | null
  endCreatedAt: number | null
}

export interface MessageSyncRangeSnapshot extends MessageSyncRangeBoundary {
  id: string
  conversationId: string
  rangeType: MessageSyncRangeType
  source: MessageSyncRangeSource
  anchorTargetId: string | null
  remoteHasOlder: boolean
  remoteHasNewer: boolean
  remoteExhaustedOlder: boolean
  remoteExhaustedNewer: boolean
  isContiguous: boolean
  isComplete: boolean
  lastCursor: string | null
  lastSyncedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface UpsertMessageSyncRangeInput extends Partial<MessageSyncRangeBoundary> {
  id?: string
  conversationId: string
  rangeType: MessageSyncRangeType
  source: MessageSyncRangeSource
  anchorTargetId?: string | null
  boundary?: Partial<MessageSyncRangeBoundary>
  remoteHasOlder?: boolean
  remoteHasNewer?: boolean
  remoteExhaustedOlder?: boolean
  remoteExhaustedNewer?: boolean
  isContiguous?: boolean
  isComplete?: boolean
  lastCursor?: string | null
  lastSyncedAt?: number | null
}

export interface MarkRangeRemoteExhaustedInput {
  id?: string
  conversationId: string
  rangeType: MessageSyncRangeType
  source: MessageSyncRangeSource
  anchorTargetId?: string | null
  direction: 'older' | 'newer'
  exhaustedAt?: number
}

const getRangesCollection = () => database.get<MessageSyncRangeModel>(TABLES.messageSyncRanges)

const encodeRangeIdPart = (value: string | null | undefined) => {
  return encodeURIComponent(value ?? 'none')
}

export const buildMessageSyncRangeId = ({
  anchorTargetId,
  conversationId,
  rangeType,
  source,
}: {
  anchorTargetId?: string | null
  conversationId: string
  rangeType: MessageSyncRangeType
  source: MessageSyncRangeSource
}) => {
  // Default IDs are stable per conversation/rangeType/source/anchorTargetId.
  // Callers that need multiple disjoint ranges for the same key must pass an explicit id.
  return [
    'message-sync-range',
    encodeRangeIdPart(conversationId),
    encodeRangeIdPart(rangeType),
    encodeRangeIdPart(source),
    encodeRangeIdPart(anchorTargetId),
  ].join(':')
}

const findRangeRecordById = async (rangeId: string) => {
  try {
    return await getRangesCollection().find(rangeId)
  } catch {
    return null
  }
}

const getRangeRecordId = (input: {
  anchorTargetId?: string | null
  conversationId: string
  id?: string
  rangeType: MessageSyncRangeType
  source: MessageSyncRangeSource
}) => {
  return (
    input.id ??
    buildMessageSyncRangeId({
      anchorTargetId: input.anchorTargetId ?? null,
      conversationId: input.conversationId,
      rangeType: input.rangeType,
      source: input.source,
    })
  )
}

const toTimestamp = (value?: string | null) => {
  if (!value) {
    return null
  }

  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : timestamp
}

const getMessageBoundaryId = (message: Message) => {
  return message.id || message._id || message.clientMessageId || null
}

const compareMessagesNewestFirst = (left: Message, right: Message) => {
  const rightTimestamp = toTimestamp(right.createdAt) ?? 0
  const leftTimestamp = toTimestamp(left.createdAt) ?? 0
  const timestampDelta = rightTimestamp - leftTimestamp

  if (timestampDelta !== 0) {
    return timestampDelta
  }

  return (right.id || right._id || '').localeCompare(left.id || left._id || '')
}

const resolveBoundaryForCreate = (
  input: UpsertMessageSyncRangeInput,
): MessageSyncRangeBoundary => ({
  startMessageId: input.startMessageId ?? input.boundary?.startMessageId ?? null,
  startCreatedAt: input.startCreatedAt ?? input.boundary?.startCreatedAt ?? null,
  endMessageId: input.endMessageId ?? input.boundary?.endMessageId ?? null,
  endCreatedAt: input.endCreatedAt ?? input.boundary?.endCreatedAt ?? null,
})

const resolveBoundaryFieldForUpdate = <T extends number | string>({
  directValue,
  existingValue,
  nestedValue,
}: {
  directValue: T | null | undefined
  existingValue: T | null
  nestedValue: T | null | undefined
}) => {
  if (directValue !== undefined) {
    return directValue
  }

  if (nestedValue !== undefined) {
    return nestedValue
  }

  return existingValue
}

const resolveBoundaryForUpdate = (
  record: MessageSyncRangeModel,
  input: UpsertMessageSyncRangeInput,
): MessageSyncRangeBoundary => ({
  startMessageId: resolveBoundaryFieldForUpdate({
    directValue: input.startMessageId,
    existingValue: record.startMessageId,
    nestedValue: input.boundary?.startMessageId,
  }),
  startCreatedAt: resolveBoundaryFieldForUpdate({
    directValue: input.startCreatedAt,
    existingValue: record.startCreatedAt,
    nestedValue: input.boundary?.startCreatedAt,
  }),
  endMessageId: resolveBoundaryFieldForUpdate({
    directValue: input.endMessageId,
    existingValue: record.endMessageId,
    nestedValue: input.boundary?.endMessageId,
  }),
  endCreatedAt: resolveBoundaryFieldForUpdate({
    directValue: input.endCreatedAt,
    existingValue: record.endCreatedAt,
    nestedValue: input.boundary?.endCreatedAt,
  }),
})

const toMessageSyncRangeSnapshot = (record: MessageSyncRangeModel): MessageSyncRangeSnapshot => ({
  id: record.id,
  conversationId: record.conversationId,
  rangeType: record.rangeType,
  source: record.source,
  anchorTargetId: record.anchorTargetId,
  startMessageId: record.startMessageId,
  startCreatedAt: record.startCreatedAt,
  endMessageId: record.endMessageId,
  endCreatedAt: record.endCreatedAt,
  remoteHasOlder: record.remoteHasOlder,
  remoteHasNewer: record.remoteHasNewer,
  remoteExhaustedOlder: record.remoteExhaustedOlder,
  remoteExhaustedNewer: record.remoteExhaustedNewer,
  isContiguous: record.isContiguous,
  isComplete: record.isComplete,
  lastCursor: record.lastCursor,
  lastSyncedAt: record.lastSyncedAt,
  createdAt: record.createdAt.getTime(),
  updatedAt: record.updatedAt.getTime(),
})

const applyRangeCreateInputToRecord = (
  record: MessageSyncRangeModel,
  input: UpsertMessageSyncRangeInput,
  now: number,
) => {
  const boundary = resolveBoundaryForCreate(input)
  const raw = record._raw as Record<string, string | number | null>

  record.conversationId = input.conversationId
  record.rangeType = input.rangeType
  record.source = input.source
  record.anchorTargetId = input.anchorTargetId ?? null
  record.startMessageId = boundary.startMessageId
  record.startCreatedAt = boundary.startCreatedAt
  record.endMessageId = boundary.endMessageId
  record.endCreatedAt = boundary.endCreatedAt
  record.remoteHasOlder = input.remoteHasOlder ?? false
  record.remoteHasNewer = input.remoteHasNewer ?? false
  record.remoteExhaustedOlder = input.remoteExhaustedOlder ?? false
  record.remoteExhaustedNewer = input.remoteExhaustedNewer ?? false
  record.isContiguous = input.isContiguous ?? false
  record.isComplete = input.isComplete ?? false
  record.lastCursor = input.lastCursor ?? null
  record.lastSyncedAt = input.lastSyncedAt ?? null
  raw.updated_at = now
}

const applyRangeUpdateInputToRecord = (
  record: MessageSyncRangeModel,
  input: UpsertMessageSyncRangeInput,
  now: number,
) => {
  const boundary = resolveBoundaryForUpdate(record, input)
  const raw = record._raw as Record<string, string | number | null>

  record.conversationId = input.conversationId
  record.rangeType = input.rangeType
  record.source = input.source
  record.anchorTargetId =
    input.anchorTargetId !== undefined ? input.anchorTargetId : record.anchorTargetId
  record.startMessageId = boundary.startMessageId
  record.startCreatedAt = boundary.startCreatedAt
  record.endMessageId = boundary.endMessageId
  record.endCreatedAt = boundary.endCreatedAt
  record.remoteHasOlder =
    input.remoteHasOlder !== undefined ? input.remoteHasOlder : record.remoteHasOlder
  record.remoteHasNewer =
    input.remoteHasNewer !== undefined ? input.remoteHasNewer : record.remoteHasNewer
  record.remoteExhaustedOlder =
    input.remoteExhaustedOlder !== undefined
      ? input.remoteExhaustedOlder
      : record.remoteExhaustedOlder
  record.remoteExhaustedNewer =
    input.remoteExhaustedNewer !== undefined
      ? input.remoteExhaustedNewer
      : record.remoteExhaustedNewer
  record.isContiguous = input.isContiguous !== undefined ? input.isContiguous : record.isContiguous
  record.isComplete = input.isComplete !== undefined ? input.isComplete : record.isComplete
  record.lastCursor = input.lastCursor !== undefined ? input.lastCursor : record.lastCursor
  record.lastSyncedAt = input.lastSyncedAt !== undefined ? input.lastSyncedAt : record.lastSyncedAt
  raw.updated_at = now
}

export const buildRangeBoundaryFromMessages = (messages: Message[]): MessageSyncRangeBoundary => {
  if (messages.length === 0) {
    return {
      startMessageId: null,
      startCreatedAt: null,
      endMessageId: null,
      endCreatedAt: null,
    }
  }

  const sortedMessages = [...messages].sort(compareMessagesNewestFirst)
  const newestMessage = sortedMessages[0]
  const oldestMessage = sortedMessages[sortedMessages.length - 1]

  return {
    startMessageId: newestMessage ? getMessageBoundaryId(newestMessage) : null,
    startCreatedAt: newestMessage ? toTimestamp(newestMessage.createdAt) : null,
    endMessageId: oldestMessage ? getMessageBoundaryId(oldestMessage) : null,
    endCreatedAt: oldestMessage ? toTimestamp(oldestMessage.createdAt) : null,
  }
}

export const getMessageSyncRanges = async (conversationId: string) => {
  const records = await getRangesCollection()
    .query(Q.where('conversation_id', conversationId), Q.sortBy('updated_at', Q.desc))
    .fetch()

  return records.map(toMessageSyncRangeSnapshot)
}

export const getLatestMessageSyncRange = async (conversationId: string) => {
  const records = await getRangesCollection()
    .query(
      Q.where('conversation_id', conversationId),
      Q.where('range_type', 'latest'),
      Q.sortBy('updated_at', Q.desc),
      Q.take(1),
    )
    .fetch()

  return records[0] ? toMessageSyncRangeSnapshot(records[0]) : null
}

export const getAnchorMessageSyncRanges = async (
  conversationId: string,
  anchorTargetId: string,
) => {
  const records = await getRangesCollection()
    .query(
      Q.where('conversation_id', conversationId),
      Q.where('range_type', 'anchor'),
      Q.where('anchor_target_id', anchorTargetId),
      Q.sortBy('updated_at', Q.desc),
    )
    .fetch()

  return records.map(toMessageSyncRangeSnapshot)
}

export const upsertMessageSyncRange = async (input: UpsertMessageSyncRangeInput) => {
  const rangeId = getRangeRecordId(input)
  const now = Date.now()
  const existingRecord = await findRangeRecordById(rangeId)

  if (existingRecord) {
    await database.write(async () => {
      await existingRecord.update((record) => {
        applyRangeUpdateInputToRecord(record, input, now)
      })
    })

    const updatedRecord = await findRangeRecordById(rangeId)
    return updatedRecord ? toMessageSyncRangeSnapshot(updatedRecord) : null
  }

  let createdRecord: MessageSyncRangeModel | null = null

  await database.write(async () => {
    createdRecord = await getRangesCollection().create((record) => {
      const raw = record._raw as Record<string, string | number | null>
      raw.id = rangeId
      raw.created_at = now
      applyRangeCreateInputToRecord(record, input, now)
    })
  })

  return createdRecord ? toMessageSyncRangeSnapshot(createdRecord) : null
}

export const markRangeRemoteExhausted = async (input: MarkRangeRemoteExhaustedInput) => {
  const rangeId = getRangeRecordId(input)
  const exhaustedAt = input.exhaustedAt ?? Date.now()
  const record = await findRangeRecordById(rangeId)

  if (!record) {
    return null
  }

  await database.write(async () => {
    await record.update((draft) => {
      const raw = draft._raw as Record<string, string | number | null>

      if (input.direction === 'older') {
        draft.remoteHasOlder = false
        draft.remoteExhaustedOlder = true
      } else {
        draft.remoteHasNewer = false
        draft.remoteExhaustedNewer = true
      }

      draft.lastSyncedAt = exhaustedAt
      raw.updated_at = exhaustedAt
    })
  })

  const updatedRecord = await findRangeRecordById(rangeId)
  return updatedRecord ? toMessageSyncRangeSnapshot(updatedRecord) : null
}

export const deleteMessageSyncRangesForConversation = async (conversationId: string) => {
  const records = await getRangesCollection()
    .query(Q.where('conversation_id', conversationId))
    .fetch()

  if (records.length === 0) {
    return
  }

  await database.write(async () => {
    await database.batch(...records.map((record) => record.prepareDestroyPermanently()))
  })
}
