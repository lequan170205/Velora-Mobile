import React, { memo, useCallback } from 'react'
import { Image, View } from 'react-native'
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated'

import { useConversationNavigation } from '../../hooks/useConversationNavigation'
import { formatConversationPreviewAge } from '../../lib/conversationPreviewTime'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import { AppText } from '../base/AppText'
import { SafeTouchableOpacity } from '../common/SafeTouchableOpacity'

import type { Conversation } from '../../types/conversation.types'

const ConversationTypingIndicator = memo(function ConversationTypingIndicator() {
  return (
    <AppText className="text-base2 font-semibold" style={{ color: '#C2410C' }}>
      Typing…
    </AppText>
  )
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

  const SECTION_ENTERING = FadeInDown.springify()
    .damping(18)
    .stiffness(170)
    .reduceMotion(ReduceMotion.System)
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
        className={
          isUnread
            ? 'mx-4 mb-1 overflow-hidden rounded-[19px] border border-[#FFD9C4] bg-[#FFF8F3] px-3.5 py-3'
            : 'mx-4 mb-1 overflow-hidden rounded-[19px] border border-transparent bg-white px-3.5 py-3'
        }
        onPress={() => openConversation(conversation.id)}
        onPressIn={() => {
          prefetchConversation(conversation.id)
        }}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={accessibilitySummary}
        accessibilityHint="Opens conversation"
      >
        <View className="flex-row items-center">
          <View className="relative">
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                className="h-[52px] w-[52px] rounded-[18px] bg-surface-input"
                resizeMode="cover"
              />
            ) : (
              <View className="h-[52px] w-[52px] items-center justify-center rounded-[18px] bg-brand-soft">
                <AppText
                  className="font-heading text-lg font-semibold"
                  style={{ color: '#C2410C' }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </AppText>
              </View>
            )}

            {!conversation.isGroup && isOnline ? (
              <View className="absolute bottom-[-1px] right-[-1px] h-4 w-4 rounded-full border-[3px] border-white bg-status-online" />
            ) : null}
          </View>

          <View className="ml-3 min-w-0 flex-1">
            <View className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 flex-1">
                <AppText
                  className={
                    isUnread
                      ? 'text-md font-bold text-text-primary'
                      : 'text-md font-semibold text-text-primary'
                  }
                  numberOfLines={1}
                >
                  {displayName}
                </AppText>
              </View>

              <AppText
                className="text-sm2 font-semibold"
                style={{ color: isUnread ? '#C2410C' : '#6F6C6A' }}
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
                        ? 'text-base2 font-medium text-text-secondary'
                        : 'text-base2 text-text-secondary'
                    }
                    numberOfLines={1}
                  >
                    {displayLastMessage}
                  </AppText>
                )}
              </View>

              {isUnread ? (
                <View
                  className="ml-3 min-h-5 min-w-5 items-center justify-center rounded-full px-1.5"
                  style={{ backgroundColor: '#C2410C' }}
                >
                  <AppText className="text-[10px] font-bold leading-[14px] text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </AppText>
                </View>
              ) : null}
            </View>
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
