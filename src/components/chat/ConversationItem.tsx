import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import React, { memo } from 'react'
import { Image, Text, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

import { prefetchMessages } from '../../hooks/useMessages'
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
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const onlineUsers = useChatStore((state) => state.onlineUsers)
  const isTyping = useChatStore((state) => {
    const typers = state.typingUsers[conversation.id] || []
    return typers.some((typerId) => typerId !== user?.id)
  })

  let displayName = 'Unknown'
  let avatarUrl: string | undefined = undefined
  let otherUserId: string | undefined = undefined

  if (!conversation.isGroup) {
    const otherUser = conversation.participants?.find((participant) => participant.id !== user?.id)

    if (otherUser) {
      displayName = otherUser.name || otherUser.email || 'Unknown'
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
  const isUnread = (conversation.unreadCount || 0) > 0
  const displayLastMessage =
    LASTMSG_MAP[conversation.lastMessage ?? ''] ?? (conversation.lastMessage || 'No messages yet')

  return (
    <SafeTouchableOpacity
      className="border-b border-border-light px-5 py-3.5"
      onPress={() => router.push(`/conversation/${conversation.id}`)}
      onPressIn={() => {
        void prefetchMessages(queryClient, conversation.id)
      }}
      activeOpacity={0.75}
    >
      <View className="flex-row items-start">
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

        <View className="ml-3 flex-1">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 flex-row items-center">
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
              {!conversation.isGroup && isOnline ? (
                <View className="ml-1.5 h-1.5 w-1.5 rounded-full bg-brand" />
              ) : null}
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
