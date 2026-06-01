import { getMediaUploadStage, getResolvedMediaUri, isRemoteMediaUri } from '../../../lib/chatMedia'

import {
  MESSAGE_CONTEXT_ACTIONS,
  RECALL_WINDOW_MS,
  RESTRICTED_MESSAGE_TYPES,
  type MessageContextActionConfig,
} from './constants'

import type { Message, Reaction, ReactionMap } from '../../../types/conversation.types'

type ReactionEntry = Pick<Reaction, 'emoji' | 'userId'>

interface AvailableActionsParams {
  isOwn: boolean
  message: Message
  onForward?: (() => void) | undefined
  onRecall?: (() => void) | undefined
  onReply?: (() => void) | undefined
  onSave?: (() => void) | undefined
}

function getReactionEntries(message: Message): ReactionEntry[] {
  const { reactions } = message

  if (!reactions || typeof reactions !== 'object') {
    return []
  }

  if (Array.isArray(reactions)) {
    return reactions.filter(
      (reaction): reaction is ReactionEntry =>
        Boolean(reaction?.userId) && typeof reaction?.emoji === 'string',
    )
  }

  return Object.entries(reactions as ReactionMap).flatMap(([userId, value]) =>
    value?.emoji ? [{ userId, emoji: value.emoji }] : [],
  )
}

export function isMessageRecalled(message: Message) {
  return message.isRecalled === true || message.is_recalled === true
}

export function isMessageRecallExpired(message: Message) {
  return Date.now() - new Date(message.createdAt).getTime() > RECALL_WINDOW_MS
}

export function isRestrictedMessageType(message: Message) {
  return RESTRICTED_MESSAGE_TYPES.includes(
    message.type as (typeof RESTRICTED_MESSAGE_TYPES)[number],
  )
}

export function getCurrentUserReaction(message: Message, userId?: string) {
  if (!userId) {
    return undefined
  }

  return getReactionEntries(message).find((reaction) => reaction.userId === userId)?.emoji
}

export function getAvailableMessageActions({
  isOwn,
  message,
  onForward,
  onRecall,
  onReply,
  onSave,
}: AvailableActionsParams): MessageContextActionConfig[] {
  const isRecalled = isMessageRecalled(message)
  const isExpired = isMessageRecallExpired(message)
  const isRestrictedType = isRestrictedMessageType(message)
  const mediaStage = getMediaUploadStage(message.media)
  const mediaUri = getResolvedMediaUri(message.media)
  const canSaveMedia =
    (message.type === 'image' || message.type === 'video') &&
    (mediaStage === null || mediaStage === 'ready') &&
    message.status !== 'PENDING' &&
    isRemoteMediaUri(mediaUri)

  return MESSAGE_CONTEXT_ACTIONS.filter((action) => {
    if (action.id === 'reply') return !isRecalled && Boolean(onReply)
    if (action.id === 'copy') return message.type === 'text' && !isRecalled
    if (action.id === 'save') return canSaveMedia && !isRecalled && Boolean(onSave)
    if (action.id === 'forward') return !isRecalled && Boolean(onForward)
    if (action.id === 'recall') {
      return Boolean(onRecall) && isOwn && !isRecalled && !isExpired && !isRestrictedType
    }

    return false
  })
}
