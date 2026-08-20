import type { BottomSheetModal } from '@gorhom/bottom-sheet'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Text, View } from 'react-native'

import { getMessageBubbleRecyclingKey } from '../../lib/messageBubbleRecycling'

import {
  MessageBubble as MemoizedMessageBubble,
  type MessageBubbleContextMenuPayload,
} from './MessageBubbleImpl'
import { ReactionDetailsSheet } from './ReactionDetailsSheet'

export { VALID_EMOJIS } from './MessageBubbleImpl'
export type { MessageBubbleContextMenuPayload }

type MessageBubbleProps = React.ComponentProps<typeof MemoizedMessageBubble>

const MAX_VISIBLE_REACTION_EMOJIS = 3

const getParticipantDisplayName = (participant: MessageBubbleProps['senderInfo']) => {
  if (!participant) return null

  return (
    ('name' in participant && typeof participant.name === 'string' && participant.name.trim()) ||
    ('fullName' in participant &&
      typeof participant.fullName === 'string' &&
      participant.fullName.trim()) ||
    ('email' in participant && typeof participant.email === 'string' && participant.email.split('@')[0]) ||
    null
  )
}

const getGroupActivityLabel = (props: MessageBubbleProps) => {
  const activity = props.message.metadata?.groupActivity
  if (!activity) return props.message.content

  const actor = activity.actorName?.trim() || getParticipantDisplayName(props.senderInfo) || 'A member'
  const target = activity.targetName?.trim() || 'a member'

  switch (activity.type) {
    case 'GROUP_CREATED':
      return `${actor} created the group`
    case 'MEMBER_ADDED':
      return `${actor} added ${target}`
    case 'MEMBER_LEFT':
      return `${actor} left the group`
    case 'MEMBER_REMOVED':
      return `${actor} removed ${target}`
    case 'MEMBER_PROMOTED':
      return `${actor} made ${target} an admin`
    case 'MEMBER_DEMOTED':
      return `${actor} removed ${target} as admin`
    case 'OWNERSHIP_TRANSFERRED':
      return `${actor} transferred ownership to ${target}`
    case 'GROUP_RENAMED':
      return activity.nextValue?.trim()
        ? `${actor} renamed the group to ${activity.nextValue.trim()}`
        : `${actor} renamed the group`
    case 'GROUP_PICTURE_CHANGED':
      return activity.nextValue
        ? `${actor} changed the group photo`
        : `${actor} removed the group photo`
    default:
      return props.message.content
  }
}

const getReactionDisplayMessage = (message: MessageBubbleProps['message']) => {
  const reactionEntries = Object.entries(message.reactions ?? {}).filter(
    ([, reaction]) => Boolean(reaction?.emoji),
  )

  if (reactionEntries.length === 0) return message

  const counts = new Map<string, { count: number; latestAt: number }>()

  for (const [, reaction] of reactionEntries) {
    const timestamp = Date.parse(reaction.createdAt)
    const current = counts.get(reaction.emoji)

    counts.set(reaction.emoji, {
      count: (current?.count ?? 0) + 1,
      latestAt: Math.max(current?.latestAt ?? 0, Number.isFinite(timestamp) ? timestamp : 0),
    })
  }

  const groupedEmoji = Array.from(counts.entries())
    .map(([emoji, summary]) => ({ emoji, ...summary }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.latestAt - left.latestAt ||
        left.emoji.localeCompare(right.emoji),
    )
    .slice(0, MAX_VISIBLE_REACTION_EMOJIS)
    .map(({ emoji }) => emoji)
    .join(' ')

  const groupedReactions = Object.fromEntries(
    reactionEntries.map(([userId, reaction]) => [
      userId,
      {
        ...reaction,
        emoji: groupedEmoji,
      },
    ]),
  )

  return {
    ...message,
    reactions: groupedReactions,
  }
}

export function MessageBubble(props: MessageBubbleProps) {
  const reactionDetailsSheetRef = useRef<BottomSheetModal>(null)
  const [isReactionDetailsOpen, setIsReactionDetailsOpen] = useState(false)
  const reactionSignature = useMemo(
    () =>
      Object.entries(props.message.reactions ?? {})
        .sort(([leftUserId], [rightUserId]) => leftUserId.localeCompare(rightUserId))
        .map(([userId, reaction]) => `${userId}:${reaction.emoji}:${reaction.createdAt}`)
        .join('|'),
    [props.message.reactions],
  )
  const reactionDisplayMessage = useMemo(
    () => getReactionDisplayMessage(props.message),
    [props.message],
  )

  const handleReactionPress = useCallback(
    (emoji: string) => {
      props.onReactionPress?.(emoji)
      setIsReactionDetailsOpen(true)
    },
    [props.onReactionPress],
  )

  const handleOpenContextMenu = useCallback(
    (payload: MessageBubbleContextMenuPayload) => {
      props.onOpenContextMenu?.({
        ...payload,
        message: props.message,
      })
    },
    [props.message, props.onOpenContextMenu],
  )

  const handleReactionDetailsDismiss = useCallback(() => {
    setIsReactionDetailsOpen(false)
  }, [])

  if (props.message.metadata?.kind === 'group_system_activity') {
    return (
      <View className="items-center px-8 py-2.5">
        <View className="max-w-[88%] rounded-full bg-surface-input px-3.5 py-2">
          <Text className="text-center text-xs2 leading-4 text-text-muted">
            {getGroupActivityLabel(props)}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <>
      <MemoizedMessageBubble
        key={getMessageBubbleRecyclingKey(props.message.metadata?.citations)}
        {...props}
        message={reactionDisplayMessage}
        onReactionPress={handleReactionPress}
        onOpenContextMenu={props.onOpenContextMenu ? handleOpenContextMenu : undefined}
      />
      {isReactionDetailsOpen ? (
        <ReactionDetailsSheet
          sheetRef={reactionDetailsSheetRef}
          messageId={props.message.id}
          reactionSignature={reactionSignature}
          onDismiss={handleReactionDetailsDismiss}
        />
      ) : null}
    </>
  )
}
