import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
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

import type { Message } from '../../types/conversation.types'

// Valid emojis for reactions (matching backend)
export const VALID_EMOJIS = ['👍', '❤️', '😂', '😢', '😮', '😡', '👏', '🎉']

// Backend sends English strings — map to Vietnamese display text
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

  const isSending = (message.id || message._id || '').startsWith('temp-')

  const getStatusText = () => {
    if (isSending) return 'Sending...'
    // Kiểm tra cả status từ message và từ Zustand store
    const isSeen =
      message.status === 'READ' ||
      isMessageSeen(conversationId || message.conversationId, message.id)
    if (isSeen) return 'Read'
    if (message.status === 'DELIVERED') return 'Delivered'
    return 'Sent'
  }

  useEffect(() => {
    progress.value = withTiming(isExpanded ? 1 : 0, { duration: 250 })
  }, [isExpanded])

  const toggleDetails = () => {
    // Gọi hàm từ parent truyền xuống thay vì tự set state
    if (onToggleDetails) onToggleDetails()
  }

  const handleLongPress = () => {
    // measureInWindow returns coords in the root window frame — exactly what
    // we need since the Modal also renders at the window level.
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
  // Handle both camelCase and snake_case
  const isRecalled = message.isRecalled === true || message.is_recalled === true

  // Handle reactions as object/map (new backend structure)
  const reactionsMap = message.reactions || {}

  // Build reaction summary for display
  const reactionSummary = useMemo(() => {
    const summary: Record<string, number> = {}
    Object.values(reactionsMap).forEach((reaction: any) => {
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
                <View className="w-7 h-7 rounded-full bg-surface-focus items-center justify-center">
                  <Text className="text-text-primary text-[10px] font-bold">{fallbackInitial}</Text>
                </View>
              ))}
          </View>
        )}

        <View className={cn('max-w-[75%]', isOwn ? 'items-end' : 'items-start')}>
          {/* Reply Preview - handle both string and JSON object */}
          {message.replyPreview && (
            <Pressable
              onPress={onPressReplyPreview}
              className={cn(
                'flex-row items-stretch mb-1 rounded-[10px] overflow-hidden',
                isOwn ? 'self-end' : 'self-start',
              )}
              style={{ maxWidth: '100%' }}
            >
              {/* Thanh accent dọc */}
              <View className={cn('w-[3px]', isOwn ? 'bg-white/50' : 'bg-blue-500')} />

              {/* Nội dung */}
              <View
                className={cn(
                  'px-2.5 py-1.5',
                  isOwn ? 'bg-black/20' : 'bg-black/5 border-[0.5px] border-black/10',
                )}
                style={{ flexShrink: 1, minWidth: 0 }}
              >
                <Text
                  numberOfLines={1}
                  className={cn(
                    'text-[11px] font-semibold mb-0.5',
                    isOwn ? 'text-white/85' : 'text-blue-600',
                  )}
                >
                  {typeof message.replyPreview === 'string'
                    ? 'Trả lời'
                    : (message.replyPreview as any).senderName}
                </Text>

                <Text
                  numberOfLines={1}
                  className={cn('text-[12px]', isOwn ? 'text-white/60' : 'text-text-muted')}
                >
                  {(() => {
                    const content =
                      typeof message.replyPreview === 'string'
                        ? message.replyPreview
                        : (message.replyPreview as any).content
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

          {/* Reactions display */}
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
                    isOwn ? 'bg-black/20' : 'bg-surface-focus',
                  )}
                >
                  <Text className="text-xs">{emoji}</Text>
                  <Text
                    className={cn('text-xs ml-0.5', isOwn ? 'text-white/70' : 'text-text-muted')}
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
                  isMessageSeen(conversationId || message.conversationId, message.id)) &&
                !isSending && (
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
        onReply={onReply || (() => {})}
        onRecall={onRecall || (() => {})}
        conversationId={conversationId || message.conversationId}
      />
    </>
  )
}

// Memoize to prevent unnecessary re-renders
export const MessageBubble = memo(MessageBubbleComponent, (prevProps, nextProps) => {
  const prevPreviewContent =
    typeof prevProps.message.replyPreview === 'string'
      ? prevProps.message.replyPreview
      : (prevProps.message.replyPreview as any)?.content

  const nextPreviewContent =
    typeof nextProps.message.replyPreview === 'string'
      ? nextProps.message.replyPreview
      : (nextProps.message.replyPreview as any)?.content

  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.status === nextProps.message.status &&
    prevProps.message.reactions === nextProps.message.reactions &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.message.isRecalled === nextProps.message.isRecalled &&
    prevProps.message.is_recalled === nextProps.message.is_recalled &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevPreviewContent === nextPreviewContent
  )
})
