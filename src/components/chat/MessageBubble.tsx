import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import * as Haptics from 'expo-haptics'
import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { queryKeys } from '../../constants/queryKeys'
import { cn } from '../../lib/cn'
import { useChatStore } from '../../stores/chatStore'

import { MessageContextMenu, type BubbleAnchor } from './MessageContextMenu'

import type {
  ChatParticipant,
  Conversation,
  Message,
  ReplyPreviewData,
} from '../../types/conversation.types'

// Valid emojis for reactions (matching backend)
export const VALID_EMOJIS = ['👍', '❤️', '😂', '😢', '😮', '😡', '👏', '🎉']

const RECALLED_PREVIEW_MAP: Record<string, string> = {
  'Message recalled': 'Tin nhắn đã thu hồi',
  'message recalled': 'Tin nhắn đã thu hồi',
}

interface MessageBubbleProps {
  message: Message
  isOwn: boolean
  isGroupedTop?: boolean
  isGroupedBottom?: boolean
  showAvatar?: boolean
  onReactionPress?: (emoji: string) => void
  onReply?: () => void
  onRecall?: () => void
  conversationId?: string
  isExpanded?: boolean
  onToggleDetails?: () => void
  onPressReplyPreview?: () => void
}

const MessageBubbleComponent = function MessageBubble({
  message,
  isOwn,
  isGroupedTop,
  isGroupedBottom,
  showAvatar,
  onReactionPress,
  onReply,
  onRecall,
  conversationId,
  isExpanded,
  onToggleDetails,
  onPressReplyPreview,
}: MessageBubbleProps) {
  const queryClient = useQueryClient()
  const { isMessageSeen } = useChatStore()
  const progress = useSharedValue(0)
  const [menuVisible, setMenuVisible] = useState(false)
  const [anchor, setAnchor] = useState<BubbleAnchor | null>(null)
  const bubbleRef = useRef<View>(null)

  const senderInfo = useMemo(() => {
    if (message.sender) return message.sender

    const cachedData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)
    const allConversations = Array.isArray(cachedData)
      ? cachedData
      : (cachedData as { pages?: Conversation[][] })?.pages?.flat() || []

    const conversation = allConversations.find((c: Conversation) => c.id === message.conversationId)
    if (conversation?.participants) {
      return conversation.participants.find((p: ChatParticipant) => p.id === message.senderId)
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

  const isFailed = message.status === 'FAILED'
  const isSending = (message.id || message._id || '').startsWith('temp-') && !isFailed
  const hasReadReceipt = Array.isArray(message.readBy) && message.readBy.length > 0

  const getStatusText = () => {
    if (isFailed) return 'Failed'
    if (isSending) return 'Sending...'
    const isSeen =
      message.status === 'READ' ||
      hasReadReceipt ||
      isMessageSeen(conversationId || message.conversationId, message.id)
    if (isSeen) return 'Read'
    if (!isSending) return 'Delivered'
    return 'Sent'
  }

  useEffect(() => {
    progress.value = withTiming(isExpanded ? 1 : 0, { duration: 250 })
  }, [isExpanded, progress])

  const toggleDetails = () => {
    if (onToggleDetails) onToggleDetails()
  }

  const isImage = message.type === 'image'
  const isRecalled = message.isRecalled === true || message.is_recalled === true

  const handleLongPress = () => {
    if (isRecalled) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
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
  const reactionsMap = message.reactions || {}

  const reactionSummary = useMemo(() => {
    const summary: Record<string, number> = {}
    Object.values(reactionsMap).forEach((reaction: { emoji: string }) => {
      if (reaction?.emoji) {
        summary[reaction.emoji] = (summary[reaction.emoji] || 0) + 1
      }
    })
    return summary
  }, [reactionsMap])

  const hasReactions = Object.keys(reactionSummary).length > 0

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
                <View className="w-7 h-7 rounded-full bg-surface-card items-center justify-center">
                  <Text className="text-text-primary text-[10px] font-bold">{fallbackInitial}</Text>
                </View>
              ))}
          </View>
        )}

        <View className={cn('max-w-[75%]', isOwn ? 'items-end' : 'items-start')}>
          {message.replyPreview && (
            <Pressable
              onPress={onPressReplyPreview}
              className={cn(
                'flex-row items-stretch mb-1 rounded-[10px] overflow-hidden',
                isOwn ? 'self-end' : 'self-start',
              )}
              style={{ maxWidth: '100%' }}
            >
              <View className={cn('w-[3px]', isOwn ? 'bg-white/50' : 'bg-brand')} />

              <View
                className={cn('px-2.5 py-1.5', isOwn ? 'bg-brand-dark/30' : 'bg-surface-card')}
                style={{ flexShrink: 1, minWidth: 0 }}
              >
                <Text
                  numberOfLines={1}
                  className={cn(
                    'text-[11px] font-semibold mb-0.5',
                    isOwn ? 'text-white/85' : 'text-brand',
                  )}
                >
                  {typeof message.replyPreview === 'string'
                    ? 'Trả lời'
                    : (message.replyPreview as ReplyPreviewData).senderName}
                </Text>

                <Text
                  numberOfLines={1}
                  className={cn('text-[12px]', isOwn ? 'text-white/60' : 'text-text-muted')}
                >
                  {(() => {
                    const content =
                      typeof message.replyPreview === 'string'
                        ? message.replyPreview
                        : (message.replyPreview as ReplyPreviewData).content
                    return RECALLED_PREVIEW_MAP[content] ?? content
                  })()}
                </Text>
              </View>
            </Pressable>
          )}

          <Pressable
            ref={bubbleRef}
            collapsable={false}
            onPress={toggleDetails}
            onLongPress={isRecalled ? undefined : handleLongPress}
            delayLongPress={isRecalled ? undefined : 250}
            className={cn(
              !isImage && 'px-3.5 py-2.5',
              !isImage && (isOwn ? 'bg-bubble-out' : 'bg-bubble-in'),
              'rounded-2xl overflow-hidden',
              isOwn && isGroupedTop && 'rounded-tr-[4px]',
              isOwn && isGroupedBottom && 'rounded-br-[4px]',
              !isOwn && isGroupedTop && 'rounded-tl-[4px]',
              !isOwn && isGroupedBottom && 'rounded-bl-[4px]',
            )}
          >
            {isRecalled ? (
              <Text
                className={cn(
                  'font-sans text-base italic leading-[22px]',
                  isOwn ? 'text-white/60' : 'text-text-muted',
                )}
              >
                Tin nhắn đã thu hồi
              </Text>
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

          {hasReactions && (
            <View
              className={cn(
                'flex-row flex-wrap gap-1 mt-1',
                isOwn ? 'justify-end' : 'justify-start',
              )}
            >
              {Object.entries(reactionSummary).map(([emoji, count]) => (
                <Pressable
                  key={emoji}
                  onPress={() => onReactionPress?.(emoji)}
                  className={cn(
                    'flex-row items-center px-1.5 py-0.5 rounded-full',
                    isOwn ? 'bg-brand-dark/20' : 'bg-surface-card',
                  )}
                >
                  <Text className="text-xs">{emoji}</Text>
                  <Text
                    className={cn(
                      'text-xs ml-0.5',
                      isOwn ? 'text-text-secondary' : 'text-text-muted',
                    )}
                  >
                    {count}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <Animated.View style={[animatedStyle, { overflow: 'hidden' }]}>
            <View className={cn('flex-row items-center', isOwn ? 'justify-end' : 'justify-start')}>
              <Text className="text-[11px] text-text-muted px-1">
                {timeString}
                {isOwn && ` • ${getStatusText()}`}
              </Text>
              {isOwn &&
                (message.status === 'READ' ||
                  hasReadReceipt ||
                  isMessageSeen(conversationId || message.conversationId, message.id)) &&
                !isSending && (
                  <MaterialIcons
                    name="done-all"
                    size={12}
                    color="#FF6B2C"
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
        onReply={onReply}
        onRecall={onRecall}
        conversationId={conversationId || message.conversationId}
      />
    </>
  )
}

export const MessageBubble = memo(MessageBubbleComponent, (prevProps, nextProps) => {
  const prevPreviewContent =
    typeof prevProps.message.replyPreview === 'string'
      ? prevProps.message.replyPreview
      : (prevProps.message.replyPreview as ReplyPreviewData)?.content

  const nextPreviewContent =
    typeof nextProps.message.replyPreview === 'string'
      ? nextProps.message.replyPreview
      : (nextProps.message.replyPreview as ReplyPreviewData)?.content

  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.status === nextProps.message.status &&
    prevProps.message.readBy === nextProps.message.readBy &&
    prevProps.message.reactions === nextProps.message.reactions &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.message.isRecalled === nextProps.message.isRecalled &&
    prevProps.message.is_recalled === nextProps.message.is_recalled &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevPreviewContent === nextPreviewContent
  )
})
