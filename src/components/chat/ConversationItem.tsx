import { format } from 'date-fns'
import { useRouter } from 'expo-router'
import React, { memo } from 'react'
import { Image, Text, View } from 'react-native'

import { cn } from '../../lib/cn'
import { useAuthStore } from '../../stores/authStore'
import type { Conversation } from '../../types/conversation.types'
import { SafeTouchableOpacity } from '../common/SafeTouchableOpacity'

const ConversationItemComponent = function ConversationItem({ conversation }: { conversation: Conversation }) {
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
        timeString = format(date, 'h:mm a')
      }
    } catch {
      timeString = ''
    }
  }

  const isUnread = false

  return (
    <SafeTouchableOpacity
      className="flex-row items-center px-5 py-4 border-b border-surface-card"
      onPress={() => router.push(`/conversation/${conversation.id}`)}
      activeOpacity={0.6}
    >
      {/* Avatar */}
      <View className="mr-4">
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            className="w-14 h-14 rounded-avatar bg-surface-card"
            resizeMode="cover"
          />
        ) : (
          <View className="w-14 h-14 rounded-avatar bg-surface-focus items-center justify-center">
            <Text className="text-text-primary font-semibold text-xl">
              {displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View className="flex-1 justify-center">
        {/* Top row: name + time */}
        <View className="flex-row items-center justify-between">
          <Text
            className={cn(
              'flex-1 text-md mr-2',
              isUnread ? 'font-bold text-text-primary' : 'font-semibold text-text-primary',
            )}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          <Text
            className={cn(
              'text-xs2',
              isUnread ? 'text-brand font-semibold' : 'text-text-muted font-medium',
            )}
          >
            {timeString}
          </Text>
        </View>

        {/* Bottom row: last message + unread badge */}
        <View className="flex-row items-start justify-between mt-1.5">
          <Text
            className={cn(
              'flex-1 text-sm2 leading-5 mr-4',
              isUnread ? 'text-text-primary font-semibold' : 'text-text-secondary',
            )}
            numberOfLines={2}
          >
            {conversation.lastMessage || 'No messages yet'}
          </Text>

          {isUnread && <View className="w-2.5 h-2.5 rounded-full bg-brand mt-1" />}
        </View>
      </View>
    </SafeTouchableOpacity>
  )
}

// Memoize to prevent unnecessary re-renders
export const ConversationItem = memo(ConversationItemComponent, (prevProps, nextProps) => {
  return (
    prevProps.conversation.id === nextProps.conversation.id &&
    prevProps.conversation.lastMessage === nextProps.conversation.lastMessage &&
    prevProps.conversation.lastMessageAt === nextProps.conversation.lastMessageAt
  )
})
