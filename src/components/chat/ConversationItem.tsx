import React, { memo, useCallback } from 'react'
import { Image, Text, View } from 'react-native'
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

import { useConversationNavigation } from '../../hooks/useConversationNavigation'
import { formatConversationPreviewAge } from '../../lib/conversationPreviewTime'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import { SafeTouchableOpacity } from '../common/SafeTouchableOpacity'

import type { Conversation } from '../../types/conversation.types'

const TypingDot = ({ delay }: { delay: number }) => {
  const opacity = useSharedValue(0.35)

  React.useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(withTiming(1, { duration: 260 }), withTiming(0.35, { duration: 260 })),
        -1,
        false,
      ),
    )
  }, [delay, opacity])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }))

  return <Animated.View className="h-1.5 w-1.5 rounded-full bg-brand" style={animatedStyle} />
}

const ConversationTypingIndicator = memo(function ConversationTypingIndicator() {
  return (
    <View className="flex-row items-center gap-1">
      <TypingDot delay={0} />
      <TypingDot delay={130} />
      <TypingDot delay={260} />
    </View>
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

  const SECTION_ENTERING = FadeInDown.springify().damping(18).stiffness(170)
  const timeString = conversation.lastMessageAt
    ? formatConversationPreviewAge(conversation.lastMessageAt, relativeTimeTick)
    : ''

  const isOnline = otherUserId ? onlineUsers.has(otherUserId) : false
  const unreadCount = conversation.unreadCount || 0
  const isUnread = unreadCount > 0

  const displayLastMessage =
    unreadCount >= 2
      ? `${unreadCount} new messages`
      : (LASTMSG_MAP[conversation.lastMessage ?? ''] ??
        (conversation.lastMessage || 'No messages yet'))

  return (
    <Animated.View entering={SECTION_ENTERING}>
      <SafeTouchableOpacity
        className="border-b border-border-light px-5 py-3.5"
        onPress={() => openConversation(conversation.id)}
        onPressIn={() => {
          prefetchConversation(conversation.id)
        }}
        activeOpacity={0.75}
      >
        <View className="flex-row items-start">
          <View className="relative">
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                className="h-12 w-12 rounded-full bg-surface-input"
                resizeMode="cover"
              />
            ) : (
              <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-input">
                <Text className="text-base font-medium text-text-primary">
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            {!conversation.isGroup && isOnline ? (
              <View className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-bg-primary bg-status-online" />
            ) : null}
          </View>

          <View className="ml-3 flex-1">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Text
                  className={
                    isUnread
                      ? 'text-md font-semibold text-text-primary'
                      : 'text-md font-medium text-text-primary'
                  }
                  numberOfLines={1}
                >
                  {displayName}
                </Text>
              </View>

              <Text
                className={
                  isUnread ? 'text-sm2 font-medium text-text-secondary' : 'text-sm2 text-text-muted'
                }
              >
                {timeString}
              </Text>
            </View>

            <View className="mt-1 min-h-[18px] justify-center">
              {isTyping ? (
                <ConversationTypingIndicator />
              ) : (
                <Text
                  className={
                    isUnread ? 'text-sm2 font-medium text-text-primary' : 'text-sm2 text-text-muted'
                  }
                  numberOfLines={1}
                >
                  {displayLastMessage}
                </Text>
              )}
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
