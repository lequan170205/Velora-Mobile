import { format, isToday, isYesterday, differenceInDays } from 'date-fns'
import { useRouter } from 'expo-router'
import React, { memo } from 'react'
import { Image, Text, View } from 'react-native'

import { cn } from '../../lib/cn'
import { useAuthStore } from '../../stores/authStore'
import { SafeTouchableOpacity } from '../common/SafeTouchableOpacity'

import type { Conversation } from '../../types/conversation.types'

const ConversationItemComponent = function ConversationItem({
  conversation,
}: {
  conversation: Conversation
}) {
  const router = useRouter()
  const { user } = useAuthStore()

  let displayName = 'Unknown'
  let avatarUrl: string | undefined = undefined

  if (!conversation.isGroup) {
    const otherUser = conversation.participants?.find((p) => p.id !== user?.id)
    if (otherUser) {
      displayName = otherUser.name || otherUser.email || 'Unknown'
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

  let timeString = ''
  if (conversation.lastMessageAt) {
    try {
      const date = new Date(conversation.lastMessageAt)
      if (!isNaN(date.getTime())) {
        if (isToday(date)) {
          timeString = format(date, 'h:mm a')
        } else if (isYesterday(date)) {
          timeString = 'Yesterday'
        } else if (differenceInDays(new Date(), date) < 7) {
          timeString = format(date, 'EEEE')
        } else {
          timeString = format(date, 'MM/dd/yy')
        }
      }
    } catch {
      timeString = ''
    }
  }

  const isUnread = false
  const displayLastMessage =
    LASTMSG_MAP[conversation.lastMessage ?? ''] ?? (conversation.lastMessage || 'No messages yet')

  return (
    <SafeTouchableOpacity
      className="flex-row items-center px-5 py-3.5"
      onPress={() => router.push(`/conversation/${conversation.id}`)}
      activeOpacity={0.6}
    >
      {/* Avatar */}
      <View className="mr-3.5">
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            className="w-12 h-12 rounded-full bg-surface-card"
            resizeMode="cover"
          />
        ) : (
          <View className="w-12 h-12 rounded-full bg-surface-card items-center justify-center">
            <Text className="text-text-primary font-semibold text-lg">
              {displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View className="flex-1 justify-center">
        {/* Top row: name + time */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1 mr-2">
            <Text
              className={cn(
                'text-md',
                isUnread ? 'font-bold text-text-primary' : 'font-semibold text-text-primary',
              )}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            {isUnread && <View className="w-2 h-2 rounded-full bg-brand ml-1.5" />}
          </View>
          <Text
            className={cn(
              'text-xs2',
              isUnread ? 'text-brand font-semibold' : 'text-text-muted font-medium',
            )}
          >
            {timeString}
          </Text>
        </View>

        {/* Bottom row: last message */}
        <View className="flex-row items-start justify-between mt-1">
          <Text
            className={cn(
              'flex-1 text-sm2 leading-5 mr-4',
              isUnread ? 'text-text-primary font-semibold' : 'text-text-secondary',
            )}
            numberOfLines={1}
          >
            {displayLastMessage}
          </Text>
        </View>
      </View>
    </SafeTouchableOpacity>
  )
}

// Backend sends English strings — map to Vietnamese display text
const LASTMSG_MAP: Record<string, string> = {
  '🚫 Message recalled': '🚫 Tin nhắn đã thu hồi',
}

// Memoize to prevent unnecessary re-renders
export const ConversationItem = memo(ConversationItemComponent, (prevProps, nextProps) => {
  return (
    prevProps.conversation.id === nextProps.conversation.id &&
    prevProps.conversation.lastMessage === nextProps.conversation.lastMessage &&
    prevProps.conversation.lastMessageAt === nextProps.conversation.lastMessageAt
  )
})
