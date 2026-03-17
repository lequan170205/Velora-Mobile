import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import React, { useMemo, useRef, useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { queryKeys } from '../../constants/queryKeys'
import { cn } from '../../lib/cn'
import { useAddReaction } from '../../hooks/useReactions'
import { useUnsendMessage } from '../../hooks/useUnsend'
import type { Message } from '../../types/conversation.types'
import { MessageContextMenu, type BubbleAnchor } from './MessageContextMenu'

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
  const [menuVisible, setMenuVisible] = useState(false)
  const [anchor, setAnchor] = useState<BubbleAnchor | null>(null)
  const bubbleRef = useRef<View>(null)

  const { mutate: addReaction } = useAddReaction()
  const { mutate: unsendMessage } = useUnsendMessage()

  const handleReaction = (emoji: string) => {
    addReaction({
      messageId: message.id,
      conversationId: message.conversationId,
      emoji,
    })
  }

  const handleUnsend = () => {
    unsendMessage({
      messageId: message.id,
      conversationId: message.conversationId,
    })
  }

  const senderInfo = useMemo(() => {
    if (message.sender) return message.sender

    const cachedData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)
    const allConversations = Array.isArray(cachedData)
      ? cachedData
      : (cachedData as { pages?: any[] })?.pages?.flat() || []

    const conversation = allConversations.find((c: any) => c.id === message.conversationId)
    if (conversation?.participants) {
      return conversation.participants.find((p: any) => p.id === message.senderId)
    }
    return null
  }, [message.sender, message.conversationId, message.senderId, queryClient])

  let timeString = ''
  if (message.createdAt) {
    try {
      const date = new Date(message.createdAt)
      if (!isNaN(date.getTime())) timeString = format(date, 'h:mm a')
    } catch {
      timeString = ''
    }
  }

  const isSending = message.id.startsWith('temp-')

  const getStatusText = () => {
    if (isSending) return 'Sending...'
    if (message.status === 'READ') return 'Read'
    if (message.status === 'DELIVERED') return 'Delivered'
    return 'Sent'
  }

  const toggleDetails = () => {
    progress.value = withTiming(progress.value === 0 ? 1 : 0, { duration: 250 })
  }

  const handleLongPress = () => {
    if (isDeleted) return
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height })
      setMenuVisible(true)
    })
  }

  const animatedStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 1], [0, 20]),
    opacity: progress.value,
    marginTop: interpolate(progress.value, [0, 1], [0, 4]),
  }))

  const picture = senderInfo?.picture
  const fallbackInitial =
    senderInfo?.name?.charAt(0).toUpperCase() || senderInfo?.email?.charAt(0).toUpperCase() || '?'

  const isImage = message.type === 'image'
  const isDeleted = message.isDeleted === true

  // Group reactions by emoji and count
  const reactions = message.reactions || []
  const reactionCounts = reactions.reduce((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const reactionEmojis = Object.entries(reactionCounts).map(([emoji, count]) => ({
    emoji,
    count,
  }))

  return (
    <>
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
            ref={bubbleRef}
            collapsable={false}
            onPress={toggleDetails}
            onLongPress={handleLongPress}
            delayLongPress={250}
            className={cn(
              !isImage && 'px-3.5 py-2.5',
              !isImage && (isOwn ? 'bg-bubble-out' : 'bg-bubble-in'),
              'rounded-2xl overflow-hidden',
              isOwn && isGroupedTop && 'rounded-tr-[4px]',
              isOwn && isGroupedBottom && 'rounded-br-[4px]',
              !isOwn && isGroupedTop && 'rounded-tl-[4px]',
              !isOwn && isGroupedBottom && 'rounded-bl-[4px]',
              isDeleted && 'opacity-60',
            )}
          >
            {isDeleted ? (
              <Text className="font-sans text-base italic text-text-muted">This message was unsent</Text>
            ) : isImage ? (
              <View className="relative">
                <Image
                  source={{ uri: message.content }}
                  className="w-48 h-64 bg-surface-card rounded-2xl"
                  resizeMode="cover"
                />
                {isSending && (
                  <View className="absolute inset-0 bg-black/30 items-center justify-center rounded-2xl">
                    <MaterialIcons
                      name="cloud-upload"
                      size={32}
                      color="#ffffff"
                      style={{ opacity: 0.8 }}
                    />
                  </View>
                )}
              </View>
            ) : (
              <Text
                className={cn(
                  'font-sans text-base leading-[22px]',
                  isOwn ? 'text-white' : 'text-text-primary',
                )}
              >
                {message.content}
              </Text>
            )}
          </Pressable>

          {/* Reactions display */}
          {reactionEmojis.length > 0 && (
            <View className={cn('flex-row mt-1', isOwn ? 'justify-end' : 'justify-start')}>
              <View className="flex-row items-center bg-surface-card px-2 py-0.5 rounded-full">
                {reactionEmojis.map((item) => (
                  <Text key={item.emoji} className="text-sm mr-1">
                    {item.emoji}
                  </Text>
                ))}
              </View>
            </View>
          )}

          <Animated.View style={[animatedStyle, { overflow: 'hidden' }]}>
            <View className={cn('flex-row items-center', isOwn ? 'justify-end' : 'justify-start')}>
              <Text className="text-[11px] text-text-muted px-1">
                {timeString}
                {isOwn && ` • ${getStatusText()}`}
              </Text>
              {isOwn && message.status === 'READ' && !isSending && (
                <MaterialIcons
                  name="done-all"
                  size={12}
                  color="#0A7CFF"
                  style={{ marginLeft: 2 }}
                />
              )}
            </View>
          </Animated.View>
        </View>
      </View>

      <MessageContextMenu
        visible={menuVisible}
        message={message}
        isOwn={isOwn}
        anchor={anchor}
        onClose={() => setMenuVisible(false)}
        onReply={() => {
          // TODO: set reply state
        }}
        onReaction={handleReaction}
        onUnsend={handleUnsend}
      />
    </>
  )
}
