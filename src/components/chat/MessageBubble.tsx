import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import React, { useMemo } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { queryKeys } from '../../constants/queryKeys'
import { cn } from '../../lib/cn'
import type { Message } from '../../types/conversation.types'

interface MessageBubbleProps {
  message: Message
  isOwn: boolean
  isGroupedTop?: boolean
  isGroupedBottom?: boolean
  showAvatar?: boolean
}

export function MessageBubble({
  message,
  isOwn,
  isGroupedTop,
  isGroupedBottom,
  showAvatar,
}: MessageBubbleProps) {
  const queryClient = useQueryClient()
  const progress = useSharedValue(0)

  const senderInfo = useMemo(() => {
    if (message.sender) return message.sender

    const cachedData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)
    const allConversations = Array.isArray(cachedData)
      ? cachedData
      : (cachedData as { pages?: any[] })?.pages?.flat() || []

    const conversation = allConversations.find((c: any) => c.id === message.conversationId)

    if (conversation && conversation.participants) {
      return conversation.participants.find((p: any) => p.id === message.senderId)
    }

    return null
  }, [message.sender, message.conversationId, message.senderId, queryClient])

  let timeString = ''
  if (message.createdAt) {
    try {
      const date = new Date(message.createdAt)
      if (!isNaN(date.getTime())) {
        timeString = format(date, 'h:mm a')
      }
    } catch {
      timeString = ''
    }
  }

  const getStatusText = () => {
    if (message.status === 'READ') return 'Read'
    return 'Sent'
  }

  const toggleDetails = () => {
    progress.value = withTiming(progress.value === 0 ? 1 : 0, { duration: 250 })
  }

  const animatedStyle = useAnimatedStyle(() => {
    return {
      height: interpolate(progress.value, [0, 1], [0, 20]),
      opacity: progress.value,
      marginTop: interpolate(progress.value, [0, 1], [0, 4]),
    }
  })

  const picture = senderInfo?.picture
  const fallbackInitial =
    senderInfo?.name?.charAt(0).toUpperCase() || senderInfo?.email?.charAt(0).toUpperCase() || '?'

  return (
    <View
      className={cn(
        'w-full px-4 flex-row items-end',
        isOwn ? 'justify-end' : 'justify-start',
        isGroupedBottom ? 'mb-[2px]' : 'mb-3',
      )}
    >
      {!isOwn && (
        <View className="w-7 mr-2 items-center justify-end pb-0.5">
          {showAvatar &&
            (picture ? (
              <Image source={{ uri: picture }} className="w-7 h-7 rounded-full" />
            ) : (
              <View className="w-7 h-7 rounded-full bg-surface-focus items-center justify-center">
                <Text className="text-text-primary text-[10px] font-bold">{fallbackInitial}</Text>
              </View>
            ))}
        </View>
      )}

      <View className={cn('max-w-[75%]', isOwn ? 'items-end' : 'items-start')}>
        <Pressable
          onPress={toggleDetails}
          className={cn(
            'px-3.5 py-2.5',
            isOwn ? 'bg-bubble-out' : 'bg-bubble-in',
            'rounded-2xl',
            isOwn && isGroupedTop && 'rounded-tr-[4px]',
            isOwn && isGroupedBottom && 'rounded-br-[4px]',
            !isOwn && isGroupedTop && 'rounded-tl-[4px]',
            !isOwn && isGroupedBottom && 'rounded-bl-[4px]',
          )}
        >
          <Text
            className={cn(
              'font-sans text-base leading-[22px]',
              isOwn ? 'text-white' : 'text-text-primary',
            )}
          >
            {message.content}
          </Text>
        </Pressable>

        <Animated.View style={[animatedStyle, { overflow: 'hidden' }]}>
          <View className={cn('flex-row items-center', isOwn ? 'justify-end' : 'justify-start')}>
            <Text className="text-[11px] text-text-muted px-1">
              {timeString}
              {isOwn && ` • ${getStatusText()}`}
            </Text>
            {isOwn && message.status === 'READ' && (
              <MaterialIcons name="done-all" size={12} color="#0A7CFF" style={{ marginLeft: 2 }} />
            )}
          </View>
        </Animated.View>
      </View>
    </View>
  )
}
