import {
  getMediaUploadStage,
  getResolvedMediaPosterUri,
  getResolvedMediaUri,
  isRemoteMediaUri,
} from '../chatMedia'
import { getMessageIdentityKey } from '../messageIdentity'

import { getPrimaryStatusLabel } from './conversationMessagePolicies'

import type { ChatMediaGalleryItem } from '../../components/chat/ChatMediaViewer'
import type { ChatParticipant, Conversation, Message } from '../../types/conversation.types'

export const EMPTY_READ_RECEIPT_PARTICIPANTS: ChatParticipant[] = []
export const ANCHOR_MEDIA_VIEWER_WINDOW_RADIUS = 4

export const buildConversationMediaGalleryItems = (orderedMessages: Message[]) => {
  return [...orderedMessages].reverse().flatMap<ChatMediaGalleryItem>((message) => {
    if (
      (message.type !== 'image' && message.type !== 'video') ||
      message.isRecalled === true ||
      message.is_recalled === true
    ) {
      return []
    }

    const uri = getResolvedMediaUri(message.media)
    if (!uri) {
      return []
    }

    const mediaStage = getMediaUploadStage(message.media)
    const posterUri = getResolvedMediaPosterUri(message.media)
    return [
      {
        id: getMessageIdentityKey(message) ?? message.id,
        canSave:
          (mediaStage === null || mediaStage === 'ready') &&
          message.status !== 'PENDING' &&
          isRemoteMediaUri(uri),
        message,
        type: message.type,
        uri,
        ...(posterUri ? { posterUri } : {}),
      },
    ]
  })
}

export const getConversationMediaViewerItems = ({
  items,
  sourceIndex,
  timelineMode,
}: {
  items: ChatMediaGalleryItem[]
  sourceIndex: number
  timelineMode: 'latest' | 'anchor'
}) => {
  if (timelineMode !== 'anchor') return items

  return items.slice(
    Math.max(0, sourceIndex - ANCHOR_MEDIA_VIEWER_WINDOW_RADIUS),
    Math.min(items.length, sourceIndex + ANCHOR_MEDIA_VIEWER_WINDOW_RADIUS + 1),
  )
}

export const getConversationHeaderIdentity = ({
  conversation,
  currentUserId,
}: {
  conversation?: Conversation | null
  currentUserId?: string | null
}) => {
  let displayName = 'Unknown'
  let avatarUrl: string | undefined
  let otherUserId: string | undefined

  if (conversation) {
    if (!conversation.isGroup) {
      const otherUser = conversation.participants?.find(
        (participant) => participant.id !== currentUserId,
      )
      if (otherUser) {
        displayName = otherUser.name || otherUser.fullName || otherUser.email || 'Unknown'
        avatarUrl = otherUser.picture
        otherUserId = otherUser.id
      }
    } else {
      displayName = conversation.name || 'Group Chat'
      avatarUrl = conversation.picture ?? undefined
    }
  }

  return { displayName, avatarUrl, otherUserId }
}

export const getGroupTypingLabel = ({
  activeTypers,
  conversation,
  currentUserId,
}: {
  activeTypers: string[]
  conversation?: Conversation | null
  currentUserId?: string | null
}) => {
  if (!conversation?.isGroup || !currentUserId) return null

  const participantById = new Map(
    (conversation.participants ?? []).map((participant) => [participant.id, participant]),
  )
  const names = activeTypers
    .filter((typerId) => typerId !== currentUserId)
    .map((typerId) => {
      const participant = participantById.get(typerId)
      return (
        participant?.name || participant?.fullName || participant?.email?.split('@')[0] || 'Someone'
      )
    })

  if (names.length === 0) return null
  if (names.length === 1) return `${names[0]} is typing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
  return `${names.length} people are typing`
}

export const buildConversationReceiptModel = ({
  conversation,
  currentUserId,
  orderedMessages,
  otherParticipant,
}: {
  conversation?: Conversation | null
  currentUserId?: string | null
  orderedMessages: Message[]
  otherParticipant?: ChatParticipant | null
}) => {
  const primaryStatusMap = new Map<string, string>()
  const readReceiptMap = new Map<string, ChatParticipant[]>()

  if (!currentUserId) {
    return {
      latestOutgoingIdentityKey: null,
      primaryStatusByIdentityKey: primaryStatusMap,
      readReceiptsByIdentityKey: readReceiptMap,
    }
  }

  const latestOutgoingMessage =
    orderedMessages.find((message) => message.senderId === currentUserId) ?? null
  const nextLatestOutgoingIdentityKey = getMessageIdentityKey(latestOutgoingMessage)

  let newestReadReceiptAnchorIndex = -1
  if (conversation?.isGroup) {
    const groupParticipants = (conversation.participants ?? []).filter(
      (participant) => participant.id !== currentUserId,
    )

    groupParticipants.forEach((participant) => {
      const newestReadMessage =
        orderedMessages.find(
          (message) =>
            Array.isArray(message.readBy) &&
            message.readBy.some((entry) => entry.userId === participant.id),
        ) ?? null
      const newestParticipantMessage =
        orderedMessages.find((message) => message.senderId === participant.id) ?? null
      const newestReadMessageIndex = newestReadMessage
        ? orderedMessages.indexOf(newestReadMessage)
        : -1
      const newestParticipantMessageIndex = newestParticipantMessage
        ? orderedMessages.indexOf(newestParticipantMessage)
        : -1
      const shouldAnchorToParticipantActivity =
        newestParticipantMessageIndex >= 0 &&
        (newestReadMessageIndex === -1 || newestParticipantMessageIndex < newestReadMessageIndex)
      const receiptAnchorMessage = shouldAnchorToParticipantActivity
        ? newestParticipantMessage
        : newestReadMessage
      const receiptIdentityKey = getMessageIdentityKey(receiptAnchorMessage)

      if (!receiptAnchorMessage || !receiptIdentityKey) return

      const receiptIndex = orderedMessages.indexOf(receiptAnchorMessage)
      const existingParticipants = readReceiptMap.get(receiptIdentityKey) ?? []
      readReceiptMap.set(receiptIdentityKey, [...existingParticipants, participant])
      newestReadReceiptAnchorIndex =
        newestReadReceiptAnchorIndex === -1
          ? receiptIndex
          : Math.min(newestReadReceiptAnchorIndex, receiptIndex)
    })
  } else if (otherParticipant) {
    const newestReadOutgoingMessage =
      orderedMessages.find((message) => {
        if (message.senderId !== currentUserId) return false

        const messageIdentityKey = getMessageIdentityKey(message)
        if (!messageIdentityKey || !Array.isArray(message.readBy)) return false

        return message.readBy.some((entry) => entry.userId === otherParticipant.id)
      }) ?? null
    const newestOtherParticipantMessage =
      orderedMessages.find((message) => message.senderId === otherParticipant.id) ?? null
    const newestReadOutgoingIndex = newestReadOutgoingMessage
      ? orderedMessages.indexOf(newestReadOutgoingMessage)
      : -1
    const newestOtherParticipantIndex = newestOtherParticipantMessage
      ? orderedMessages.indexOf(newestOtherParticipantMessage)
      : -1
    const shouldAnchorToOtherParticipantActivity =
      newestOtherParticipantIndex >= 0 &&
      (newestReadOutgoingIndex === -1 || newestOtherParticipantIndex < newestReadOutgoingIndex)
    const receiptAnchorMessage = shouldAnchorToOtherParticipantActivity
      ? newestOtherParticipantMessage
      : newestReadOutgoingMessage
    const readReceiptIdentityKey = getMessageIdentityKey(receiptAnchorMessage)

    newestReadReceiptAnchorIndex = receiptAnchorMessage
      ? orderedMessages.indexOf(receiptAnchorMessage)
      : -1
    if (readReceiptIdentityKey) {
      readReceiptMap.set(readReceiptIdentityKey, [otherParticipant])
    }
  }

  const latestOutgoingIndex = latestOutgoingMessage
    ? orderedMessages.indexOf(latestOutgoingMessage)
    : -1
  const hasReadActivityAtOrBeyondLatestOutgoing =
    newestReadReceiptAnchorIndex >= 0 &&
    latestOutgoingIndex >= 0 &&
    newestReadReceiptAnchorIndex <= latestOutgoingIndex

  if (
    latestOutgoingMessage &&
    nextLatestOutgoingIdentityKey &&
    !hasReadActivityAtOrBeyondLatestOutgoing
  ) {
    const primaryStatusLabel = getPrimaryStatusLabel({
      hasReadActivityAtOrBeyondMessage: hasReadActivityAtOrBeyondLatestOutgoing,
      message: latestOutgoingMessage,
    })
    if (primaryStatusLabel) {
      primaryStatusMap.set(nextLatestOutgoingIdentityKey, primaryStatusLabel)
    }
  }

  return {
    latestOutgoingIdentityKey: nextLatestOutgoingIdentityKey,
    primaryStatusByIdentityKey: primaryStatusMap,
    readReceiptsByIdentityKey: readReceiptMap,
  }
}
