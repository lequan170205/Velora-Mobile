import {
  getMessageIdentityKey,
  getMessageIdentityTokens,
  mergeMessageCollectionByIdentity,
} from './messageIdentity'

import type { OptimisticSortAnchor } from '../stores/chatStore'
import type { Message } from '../types/conversation.types'

export type MessageLayout = {
  showDateSeparator: boolean
  separatorLabel: string
  isGroupedTop: boolean
  isGroupedBottom: boolean
  showAvatar: boolean
  timeLabel: string
}

const DEFAULT_LAYOUT: MessageLayout = {
  showDateSeparator: false,
  separatorLabel: '',
  isGroupedTop: false,
  isGroupedBottom: false,
  showAvatar: false,
  timeLabel: '',
}

const createdAtTimestampCache = new Map<string, number>()
const createdAtDayStartCache = new Map<string, number>()
const createdAtTimeLabelCache = new Map<string, string>()

const getMessageCreatedAtMs = (dateString?: string) => {
  if (!dateString) return 0

  const cachedTimestamp = createdAtTimestampCache.get(dateString)
  if (cachedTimestamp !== undefined) {
    return cachedTimestamp
  }

  const nextTimestamp = new Date(dateString).getTime()
  const normalizedTimestamp = Number.isFinite(nextTimestamp) ? nextTimestamp : 0
  createdAtTimestampCache.set(dateString, normalizedTimestamp)

  return normalizedTimestamp
}

const getMessageDayStartMs = (dateString?: string) => {
  if (!dateString) return 0

  const cachedDayStart = createdAtDayStartCache.get(dateString)
  if (cachedDayStart !== undefined) {
    return cachedDayStart
  }

  const createdAtMs = getMessageCreatedAtMs(dateString)
  if (!createdAtMs) {
    createdAtDayStartCache.set(dateString, 0)
    return 0
  }

  const nextDayStart = new Date(createdAtMs)
  nextDayStart.setHours(0, 0, 0, 0)

  const normalizedDayStart = nextDayStart.getTime()
  createdAtDayStartCache.set(dateString, normalizedDayStart)

  return normalizedDayStart
}

const getMessageTimeLabel = (dateString?: string) => {
  if (!dateString) return ''

  const cachedTimeLabel = createdAtTimeLabelCache.get(dateString)
  if (cachedTimeLabel !== undefined) {
    return cachedTimeLabel
  }

  const createdAtMs = getMessageCreatedAtMs(dateString)
  if (!createdAtMs) {
    createdAtTimeLabelCache.set(dateString, '')
    return ''
  }

  const nextTimeLabel = new Date(createdAtMs).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })

  createdAtTimeLabelCache.set(dateString, nextTimeLabel)
  return nextTimeLabel
}

const buildSeparatorLabel = (dayStartMs: number) => {
  if (!dayStartMs) return ''

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const todayDayStartMs = today.getTime()
  const yesterdayDayStartMs = todayDayStartMs - 24 * 60 * 60 * 1000

  if (dayStartMs === todayDayStartMs) return 'Today'
  if (dayStartMs === yesterdayDayStartMs) return 'Yesterday'

  return new Date(dayStartMs).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const getStableLayout = (previousLayout: MessageLayout | undefined, nextLayout: MessageLayout) => {
  if (
    previousLayout &&
    previousLayout.showDateSeparator === nextLayout.showDateSeparator &&
    previousLayout.separatorLabel === nextLayout.separatorLabel &&
    previousLayout.isGroupedTop === nextLayout.isGroupedTop &&
    previousLayout.isGroupedBottom === nextLayout.isGroupedBottom &&
    previousLayout.showAvatar === nextLayout.showAvatar &&
    previousLayout.timeLabel === nextLayout.timeLabel
  ) {
    return previousLayout
  }

  return nextLayout
}

export const DEFAULT_MESSAGE_LAYOUT = DEFAULT_LAYOUT

const isLocalOptimisticMessage = (message: Message) => {
  const normalizedStatus = String(message.status ?? '').toUpperCase()
  return (
    normalizedStatus !== 'FAILED' &&
    (Boolean(message.id?.startsWith('temp-')) || Boolean(message._id?.startsWith('temp-')))
  )
}

const getMessageStableId = (message: Message) => {
  return message.id || message._id || message.clientMessageId || ''
}

const getSortAnchorIdentityKey = (message: Message) => {
  return message.clientMessageId || message.id || message._id || ''
}

const compareIdsDesc = (leftId?: string | null, rightId?: string | null) => {
  const safeLeftId = leftId ?? ''
  const safeRightId = rightId ?? ''
  return safeRightId.localeCompare(safeLeftId)
}

const compareMessageIdsDesc = (left: Message, right: Message) => {
  return compareIdsDesc(getMessageStableId(left), getMessageStableId(right))
}

const isMessageAfterOptimisticFrontier = (message: Message, anchor: OptimisticSortAnchor) => {
  const messageCreatedAtMs = getMessageCreatedAtMs(message.createdAt)

  if (messageCreatedAtMs > anchor.frontierCreatedAtMs) {
    return true
  }

  if (messageCreatedAtMs < anchor.frontierCreatedAtMs) {
    return false
  }

  if (!anchor.frontierMessageId) {
    return false
  }

  return getMessageStableId(message).localeCompare(anchor.frontierMessageId) > 0
}

const compareMessagesCanonicalNewestFirst = (left: Message, right: Message) => {
  const timestampDelta =
    getMessageCreatedAtMs(right.createdAt) - getMessageCreatedAtMs(left.createdAt)

  if (timestampDelta !== 0) {
    return timestampDelta
  }

  return (right.id || right._id || '').localeCompare(left.id || left._id || '')
}

export const sortMessagesCanonicalNewestFirst = (messages: Message[]) => {
  return [...messages].sort(compareMessagesCanonicalNewestFirst)
}

export const sortMessagesNewestFirstStable = (messages: Message[]) => {
  return [...messages].sort(
    (left, right) => getMessageCreatedAtMs(right.createdAt) - getMessageCreatedAtMs(left.createdAt),
  )
}

export const mergeMessageCollectionsNewestFirst = (existing: Message[], incoming: Message[]) => {
  return sortMessagesCanonicalNewestFirst(
    mergeMessageCollectionByIdentity(sortMessagesCanonicalNewestFirst([...existing, ...incoming])),
  )
}

export const buildMessageListState = ({
  localOptimistic,
  optimisticSortAnchorsByMessageId,
  previousLayoutById,
  serverMessages,
}: {
  localOptimistic: Message[]
  optimisticSortAnchorsByMessageId: Record<string, OptimisticSortAnchor>
  previousLayoutById: Map<string, MessageLayout>
  serverMessages: Message[]
}) => {
  const serverIdentityTokens = new Set<string>()
  for (const message of serverMessages) {
    for (const token of getMessageIdentityTokens(message)) {
      serverIdentityTokens.add(token)
    }
  }

  const pendingMessages: Message[] = []
  for (const message of localOptimistic) {
    if (!message) continue

    const hasServerMatch = getMessageIdentityTokens(message).some((token) =>
      serverIdentityTokens.has(token),
    )
    if (!hasServerMatch) {
      pendingMessages.push(message)
    }
  }

  const combinedMessages = [...pendingMessages, ...serverMessages]

  combinedMessages.sort((left, right) => {
    const leftIsLocalOptimistic = isLocalOptimisticMessage(left)
    const rightIsLocalOptimistic = isLocalOptimisticMessage(right)
    const leftAnchorIdentityKey = getSortAnchorIdentityKey(left)
    const rightAnchorIdentityKey = getSortAnchorIdentityKey(right)
    const leftAnchor = leftAnchorIdentityKey
      ? optimisticSortAnchorsByMessageId[leftAnchorIdentityKey]
      : undefined
    const rightAnchor = rightAnchorIdentityKey
      ? optimisticSortAnchorsByMessageId[rightAnchorIdentityKey]
      : undefined
    const leftEffectiveSortMs =
      leftAnchor?.frontierCreatedAtMs ?? getMessageCreatedAtMs(left.createdAt)
    const rightEffectiveSortMs =
      rightAnchor?.frontierCreatedAtMs ?? getMessageCreatedAtMs(right.createdAt)
    const effectiveDelta = rightEffectiveSortMs - leftEffectiveSortMs

    if (effectiveDelta !== 0) {
      return effectiveDelta
    }

    if (leftAnchor && !rightAnchor) {
      return isMessageAfterOptimisticFrontier(right, leftAnchor) ? 1 : -1
    }

    if (!leftAnchor && rightAnchor) {
      return isMessageAfterOptimisticFrontier(left, rightAnchor) ? -1 : 1
    }

    if (leftAnchor && rightAnchor) {
      const frontierIdDelta = compareIdsDesc(
        leftAnchor.frontierMessageId,
        rightAnchor.frontierMessageId,
      )
      if (frontierIdDelta !== 0) {
        return frontierIdDelta
      }

      if (leftAnchor.sequence !== rightAnchor.sequence) {
        return rightAnchor.sequence - leftAnchor.sequence
      }
    }

    if (leftIsLocalOptimistic !== rightIsLocalOptimistic) {
      return leftIsLocalOptimistic ? 1 : -1
    }

    return compareMessageIdsDesc(left, right)
  })

  const dedupedMessages = mergeMessageCollectionByIdentity(
    combinedMessages.filter((message) => Boolean(getMessageIdentityKey(message))),
  )

  const FIVE_MINS = 5 * 60 * 1000
  const nextLayoutById = new Map<string, MessageLayout>()
  const nextMessageById = new Map<string, Message>()
  const nextIndexById = new Map<string, number>()

  for (let index = 0; index < dedupedMessages.length; index += 1) {
    const item = dedupedMessages[index]
    if (!item) continue

    const previousMessage = dedupedMessages[index + 1]
    const nextMessage = dedupedMessages[index - 1]

    const itemTime = getMessageCreatedAtMs(item.createdAt)
    const itemDay = getMessageDayStartMs(item.createdAt)
    const prevTime = previousMessage ? getMessageCreatedAtMs(previousMessage.createdAt) : 0
    const prevDay = previousMessage ? getMessageDayStartMs(previousMessage.createdAt) : 0
    const nextTime = nextMessage ? getMessageCreatedAtMs(nextMessage.createdAt) : 0
    const nextDay = nextMessage ? getMessageDayStartMs(nextMessage.createdAt) : 0

    const showDateSeparator = !previousMessage || itemDay !== prevDay
    const isNextDay = !!nextMessage && itemDay !== nextDay

    const nextLayout = getStableLayout(previousLayoutById.get(item.id), {
      showDateSeparator,
      separatorLabel: showDateSeparator ? buildSeparatorLabel(itemDay) : '',
      isGroupedTop:
        previousMessage?.senderId === item.senderId &&
        itemTime - prevTime < FIVE_MINS &&
        !showDateSeparator,
      isGroupedBottom:
        nextMessage?.senderId === item.senderId && nextTime - itemTime < FIVE_MINS && !isNextDay,
      showAvatar: nextMessage?.senderId !== item.senderId || isNextDay,
      timeLabel: getMessageTimeLabel(item.createdAt),
    })

    nextLayoutById.set(item.id, nextLayout)
    const itemIdentityTokens = getMessageIdentityTokens(item)
    for (const token of itemIdentityTokens) {
      nextMessageById.set(token, item)
      nextIndexById.set(token, index)
    }
  }

  return {
    orderedMessages: dedupedMessages,
    layoutById: nextLayoutById,
    messageById: nextMessageById,
    indexById: nextIndexById,
  }
}
