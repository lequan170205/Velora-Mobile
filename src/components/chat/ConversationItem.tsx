import React, { memo, useCallback } from 'react'
import { View } from 'react-native'
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated'

import { useConversationNavigation } from '../../hooks/useConversationNavigation'
import { formatConversationPreviewAge } from '../../lib/conversationPreviewTime'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import { AppText } from '../base/AppText'
import { SafeTouchableOpacity } from '../common/SafeTouchableOpacity'

import { ChatAvatar } from './ChatAvatar'

import type { Conversation } from '../../types/conversation.types'

const SECTION_ENTERING = FadeInDown.springify()
  .damping(18)
  .stiffness(170)
  .reduceMotion(ReduceMotion.System)

const ConversationTypingIndicator = memo(function ConversationTypingIndicator() {
  return <AppText className="text-sm2 font-semibold text-brand">Typing…</AppText>
})

const ConversationItemComponent = function ConversationItem({
  conversation,
  relativeTimeTick,
}: {
  conversation: Conversation
  relativeTimeTick: number
}) {
  const { openConversation, prefetchConversation } = useConversationNavigation()
  const { user } = useAuthStore()
  const onlineUsers = useChatStore((state) => state.onlineUsers)
  const userId = user?.id
  const isTyping = useChatStore(
    useCallback(
      (state) => {
        const typers = state.typingUsers[conversation.id] || []
        return typers.some((typerId) => typerId !== userId)
      },
      [conversation.id, userId],
    ),
  )

  let displayName = 'Unknown'
  let avatarUrl: string | undefined = undefined
  let otherUserId: string | undefined = undefined

  if (!conversation.isGroup) {
    const otherUser = conversation.participants?.find((participant) => participant.id !== user?.id)

    if (otherUser) {
      displayName = otherUser.name || otherUser.fullName || otherUser.email || 'Unknown'
      otherUserId = otherUser.id
    }

    if (otherUser?.picture) {
      avatarUrl = otherUser.picture
    }
  } else {
    displayName = conversation.name || 'Group Chat'

    if (conversation.picture) {
      avatarUrl = conversation.picture
    }
  }

  const timeString = conversation.lastMessageAt
    ? formatConversationPreviewAge(conversation.lastMessageAt, relativeTimeTick)
    : ''

  const isOnline = otherUserId ? onlineUsers.has(otherUserId) : false
  const unreadCount = conversation.unreadCount || 0
  const isUnread = unreadCount > 0

  const displayLastMessage =
    LASTMSG_MAP[conversation.lastMessage ?? ''] ?? (conversation.lastMessage || 'No messages yet')

  const accessibilitySummary = [
    displayName,
    isOnline ? 'Online' : null,
    isTyping ? 'Typing' : displayLastMessage,
    isUnread ? `${unreadCount} unread ${unreadCount === 1 ? 'message' : 'messages'}` : null,
    timeString,
  ]
    .filter(Boolean)
    .join('. ')

  return (
    <Animated.View entering={SECTION_ENTERING}>
      <SafeTouchableOpacity
        className="mx-2 flex-row items-center rounded-[20px] px-3 py-2.5"
        onPress={() => openConversation(conversation.id)}
        onPressIn={() => {
          prefetchConversation(conversation.id)
        }}
        activeOpacity={0.65}
        accessibilityRole="button"
        accessibilityLabel={accessibilitySummary}
        accessibilityHint="Opens conversation"
      >
        <ChatAvatar
          name={displayName}
          picture={avatarUrl}
          size={52}
          isOnline={!conversation.isGroup && isOnline}
          showGroupBadge={conversation.isGroup}
        />

        <View className="ml-3 min-w-0 flex-1">
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <AppText
                className={
                  isUnread
                    ? 'text-md font-bold text-text-primary'
                    : 'text-md font-medium text-text-primary'
                }
                numberOfLines={1}
              >
                {displayName}
              </AppText>
            </View>

            <AppText
              className={
                isUnread ? 'text-xs2 font-semibold text-brand' : 'text-xs2 text-text-muted'
              }
            >
              {timeString}
            </AppText>
          </View>

          <View className="mt-1 flex-row items-center">
            <View className="min-w-0 flex-1">
              {isTyping ? (
                <ConversationTypingIndicator />
              ) : (
                <AppText
                  className={
                    isUnread
                      ? 'text-sm2 font-medium text-text-primary'
                      : 'text-sm2 text-text-secondary'
                  }
                  numberOfLines={1}
                >
                  {displayLastMessage}
                </AppText>
              )}
            </View>

            {isUnread ? (
              <View className="ml-3 min-h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5">
                <AppText className="text-xs2 font-bold leading-4 text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>
      </SafeTouchableOpacity>
    </Animated.View>
  )
}

const LASTMSG_MAP: Record<string, string> = {
  '🚫 Message recalled': 'Tin nhắn đã thu hồi',
}

export const ConversationItem = memo(ConversationItemComponent, (prevProps, nextProps) => {
  return (
    prevProps.conversation.id === nextProps.conversation.id &&
    prevProps.relativeTimeTick === nextProps.relativeTimeTick &&
    prevProps.conversation.name === nextProps.conversation.name &&
    prevProps.conversation.picture === nextProps.conversation.picture &&
    prevProps.conversation.participants === nextProps.conversation.participants &&
    prevProps.conversation.isGroup === nextProps.conversation.isGroup &&
    prevProps.conversation.lastMessage === nextProps.conversation.lastMessage &&
    prevProps.conversation.lastMessageAt === nextProps.conversation.lastMessageAt &&
    prevProps.conversation.unreadCount === nextProps.conversation.unreadCount
  )
})
