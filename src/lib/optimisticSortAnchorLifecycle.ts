import type { Message } from '../types/conversation.types'

export interface OptimisticSortAnchorLike {
  batchId?: string
  frontierCreatedAtMs: number
  frontierMessageId: string | null
  sequence: number
}

const getMessageAnchorIdentityKey = (message: Message) => {
  return message.clientMessageId ?? message.id ?? message._id ?? null
}

const isFailedOptimisticMessage = (message: Message) => {
  return String(message.status ?? '').toUpperCase() === 'FAILED'
}

const compareAnchorPosition = (left: OptimisticSortAnchorLike, right: OptimisticSortAnchorLike) => {
  if (left.frontierCreatedAtMs !== right.frontierCreatedAtMs) {
    return left.frontierCreatedAtMs - right.frontierCreatedAtMs
  }

  const frontierIdDelta = (left.frontierMessageId ?? '').localeCompare(
    right.frontierMessageId ?? '',
  )
  if (frontierIdDelta !== 0) {
    return frontierIdDelta
  }

  return left.sequence - right.sequence
}

const getOwnedAnchors = <TAnchor extends OptimisticSortAnchorLike>(
  messages: Message[],
  anchorsByIdentity: Record<string, TAnchor>,
) => {
  return messages.flatMap((message) => {
    const identityKey = getMessageAnchorIdentityKey(message)
    if (!identityKey) {
      return []
    }

    const anchor = anchorsByIdentity[identityKey]
    return anchor ? [{ anchor, message }] : []
  })
}

export const settleTextOptimisticSortAnchors = <TAnchor extends OptimisticSortAnchorLike>(
  messages: Message[],
  anchorsByIdentity: Record<string, TAnchor>,
) => {
  const ownedAnchors = getOwnedAnchors(messages, anchorsByIdentity)

  if (ownedAnchors.some(({ message }) => !isFailedOptimisticMessage(message))) {
    return anchorsByIdentity
  }

  const failedAnchors = ownedAnchors
    .filter(({ message }) => isFailedOptimisticMessage(message))
    .map(({ anchor }) => anchor)

  if (failedAnchors.length === 0) {
    return Object.keys(anchorsByIdentity).length > 0 ? {} : anchorsByIdentity
  }

  const newestFailedAnchor = failedAnchors.reduce((newest, candidate) =>
    compareAnchorPosition(candidate, newest) > 0 ? candidate : newest,
  )

  let changed = false
  const nextAnchors: Record<string, TAnchor> = {}

  Object.entries(anchorsByIdentity).forEach(([identityKey, anchor]) => {
    if (compareAnchorPosition(anchor, newestFailedAnchor) <= 0) {
      nextAnchors[identityKey] = anchor
      return
    }

    changed = true
  })

  return changed ? nextAnchors : anchorsByIdentity
}

export const removeOptimisticSortAnchorsWithTextLease = <TAnchor extends OptimisticSortAnchorLike>(
  messages: Message[],
  anchorsByIdentity: Record<string, TAnchor>,
  identityKeys: string[],
) => {
  if (
    identityKeys.length === 0 ||
    !identityKeys.some((identityKey) => Boolean(anchorsByIdentity[identityKey]))
  ) {
    return anchorsByIdentity
  }

  return settleTextOptimisticSortAnchors(messages, anchorsByIdentity)
}

export const pruneSettledTextOptimisticSortAnchors = <TAnchor extends OptimisticSortAnchorLike>(
  optimisticMessages: Record<string, Message[]>,
  optimisticSortAnchors: Record<string, Record<string, TAnchor>>,
) => {
  let changed = false
  const nextByConversation: Record<string, Record<string, TAnchor>> = {}

  Object.entries(optimisticSortAnchors).forEach(([conversationId, anchorsByIdentity]) => {
    const nextAnchors = settleTextOptimisticSortAnchors(
      optimisticMessages[conversationId] ?? [],
      anchorsByIdentity,
    )

    if (nextAnchors !== anchorsByIdentity) {
      changed = true
    }

    if (Object.keys(nextAnchors).length > 0) {
      nextByConversation[conversationId] = nextAnchors
    } else if (Object.keys(anchorsByIdentity).length > 0) {
      changed = true
    }
  })

  return changed ? nextByConversation : optimisticSortAnchors
}
