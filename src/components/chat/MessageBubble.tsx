import type { BottomSheetModal } from '@gorhom/bottom-sheet'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Text, View } from 'react-native'

import { getMessageBubbleRecyclingKey } from '../../lib/messageBubbleRecycling'

import { MessageBubble as MemoizedMessageBubble } from './MessageBubbleImpl'
import { ReactionDetailsSheet } from './ReactionDetailsSheet'

export { VALID_EMOJIS } from './MessageBubbleImpl'
export type { MessageBubbleContextMenuPayload } from './MessageBubbleImpl'

type MessageBubbleProps = React.ComponentProps<typeof MemoizedMessageBubble>

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

export function MessageBubble(props: MessageBubbleProps) {
  const reactionDetailsSheetRef = useRef<BottomSheetModal>(null)
  const [activeReactionEmoji, setActiveReactionEmoji] = useState<string | null>(null)
  const reactionSignature = useMemo(
    () =>
      Object.entries(props.message.reactions ?? {})
        .sort(([leftUserId], [rightUserId]) => leftUserId.localeCompare(rightUserId))
        .map(([userId, reaction]) => `${userId}:${reaction.emoji}:${reaction.createdAt}`)
        .join('|'),
    [props.message.reactions],
  )

  const handleReactionPress = useCallback(
    (emoji: string) => {
      props.onReactionPress?.(emoji)
      setActiveReactionEmoji(emoji)
      requestAnimationFrame(() => reactionDetailsSheetRef.current?.present())
    },
    [props.onReactionPress],
  )

  const handleReactionDetailsDismiss = useCallback(() => {
    setActiveReactionEmoji(null)
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
        onReactionPress={handleReactionPress}
      />
      {activeReactionEmoji ? (
        <ReactionDetailsSheet
          sheetRef={reactionDetailsSheetRef}
          messageId={props.message.id}
          initialEmoji={activeReactionEmoji}
          reactionSignature={reactionSignature}
          onDismiss={handleReactionDetailsDismiss}
        />
      ) : null}
    </>
  )
}
