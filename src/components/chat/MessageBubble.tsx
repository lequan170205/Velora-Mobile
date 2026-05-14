import { MaterialIcons } from '@expo/vector-icons'
import { format } from 'date-fns'
import * as Haptics from 'expo-haptics'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Text, View, Pressable } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated'

import { cn } from '../../lib/cn'
import { useChatStore } from '../../stores/chatStore'

import { MessageContextMenu, type BubbleAnchor } from './MessageContextMenu'

import type { ChatParticipant, Message, ReplyPreviewData } from '../../types/conversation.types'

// Valid emojis for reactions (matching backend)
export const VALID_EMOJIS = ['👍', '❤️', '😂', '😢', '😮', '😡', '👏', '🎉']

const RECALLED_PREVIEW_MAP: Record<string, string> = {
  'Message recalled': 'Tin nhắn đã thu hồi',
  'message recalled': 'Tin nhắn đã thu hồi',
}

const REPLY_PREVIEW_FALLBACK_LABELS: Record<ReplyPreviewData['type'], string> = {
  text: 'Message',
  image: 'Photo',
  video: 'Video',
  file: 'Attachment',
  call: 'Call',
}

const REPLY_PREVIEW_ICONS: Record<
  ReplyPreviewData['type'],
  'format-quote' | 'photo' | 'videocam' | 'attach-file' | 'call'
> = {
  text: 'format-quote',
  image: 'photo',
  video: 'videocam',
  file: 'attach-file',
  call: 'call',
}

const URI_LIKE_PATTERN = /^(https?:\/\/|file:\/\/|content:\/\/|data:|blob:)/i
const SWIPE_REPLY_TRIGGER_DISTANCE = 72
const SWIPE_REPLY_MAX_DISTANCE = 92

const getReplyPreviewMeta = (replyPreview?: string | ReplyPreviewData) => {
  if (!replyPreview) return null

  if (typeof replyPreview === 'string') {
    return {
      senderLabel: 'Original message',
      contentLabel: RECALLED_PREVIEW_MAP[replyPreview] ?? replyPreview,
      iconName: REPLY_PREVIEW_ICONS.text,
      type: 'text' as const,
    }
  }

  const normalizedContent = RECALLED_PREVIEW_MAP[replyPreview.content] ?? replyPreview.content
  const isUriLikeContent = URI_LIKE_PATTERN.test(normalizedContent)

  const contentLabel =
    replyPreview.type === 'text'
      ? normalizedContent || REPLY_PREVIEW_FALLBACK_LABELS.text
      : isUriLikeContent || !normalizedContent
        ? REPLY_PREVIEW_FALLBACK_LABELS[replyPreview.type]
        : normalizedContent

  return {
    senderLabel: replyPreview.senderName?.trim() || 'Original message',
    contentLabel,
    iconName: REPLY_PREVIEW_ICONS[replyPreview.type],
    type: replyPreview.type,
  }
}

const getSenderDisplayName = ({
  isOwn,
  senderInfo,
}: {
  isOwn: boolean
  senderInfo: ChatParticipant | Message['sender'] | null
}) => {
  if (isOwn) return 'You'
  const namedSender =
    senderInfo && 'name' in senderInfo && typeof senderInfo.name === 'string'
      ? senderInfo.name.trim()
      : ''
  return namedSender || senderInfo?.email?.split('@')[0] || 'Someone'
}

interface MessageBubbleProps {
  message: Message
  isOwn: boolean
  isGroupedTop?: boolean
  isGroupedBottom?: boolean
  showAvatar?: boolean
  senderInfo?: ChatParticipant | Message['sender'] | null
  onReactionPress?: (emoji: string) => void
  onReply?: () => void
  onRecall?: () => void
  conversationId?: string
  highlightToken?: number
  isExpanded?: boolean
  onToggleDetails?: () => void
  onPressReplyPreview?: () => void
  onContextMenuClose?: () => void
  onRequestKeyboardPreservation?: () => boolean
}

const MessageBubbleComponent = function MessageBubble({
  message,
  isOwn,
  isGroupedTop,
  isGroupedBottom,
  showAvatar,
  senderInfo: senderInfoProp,
  onReactionPress,
  onReply,
  onRecall,
  conversationId,
  highlightToken = 0,
  isExpanded,
  onToggleDetails,
  onPressReplyPreview,
  onContextMenuClose,
  onRequestKeyboardPreservation,
}: MessageBubbleProps) {
  const isMessageSeen = useChatStore((state) => state.isMessageSeen)
  const progress = useSharedValue(0)
  const highlightProgress = useSharedValue(0)
  const swipeOffsetX = useSharedValue(0)
  const menuOpeningProgress = useSharedValue(0)
  // const swipeProgress = useSharedValue(0)
  const [menuVisible, setMenuVisible] = useState(false)
  const [anchor, setAnchor] = useState<BubbleAnchor | null>(null)
  const bubbleRef = useRef<View>(null)

  const senderInfo = senderInfoProp ?? message.sender ?? null

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
  const resolvedConversationId = conversationId || message.conversationId
  const isSeen =
    message.status === 'READ' || hasReadReceipt || isMessageSeen(resolvedConversationId, message.id)

  const getStatusText = () => {
    if (isFailed) return 'Failed'
    if (isSending) return 'Sending...'
    if (isSeen) return 'Read'
    if (!isSending) return 'Delivered'
    return 'Sent'
  }

  useEffect(() => {
    progress.value = withTiming(isExpanded ? 1 : 0, { duration: 250 })
  }, [isExpanded, progress])

  useEffect(() => {
    if (!highlightToken) return

    highlightProgress.value = 0
    highlightProgress.value = withSequence(
      withTiming(1, { duration: 180 }),
      withDelay(140, withTiming(0, { duration: 260 })),
    )
  }, [highlightProgress, highlightToken])

  const toggleDetails = () => {
    if (onToggleDetails) onToggleDetails()
  }

  const isImage = message.type === 'image'
  const isRecalled = message.isRecalled === true || message.is_recalled === true
  const swipeDirection = isOwn ? -1 : 1

  const openContextMenu = useCallback((nextAnchor?: BubbleAnchor) => {
    if (nextAnchor) {
      setAnchor(nextAnchor)
      setMenuVisible(true)
      return
    }

    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height })
      setMenuVisible(true)
    })
  }, [])
  const queueContextMenuOpen = useCallback(
    (nextAnchor?: BubbleAnchor) => {
      if (nextAnchor) {
        openContextMenu(nextAnchor)
        return
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          openContextMenu(nextAnchor)
        })
      })
    },
    [openContextMenu],
  )

  const measureAnchor = useCallback((onMeasured: (nextAnchor: BubbleAnchor) => void) => {
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      onMeasured({ x, y, width, height })
    })
  }, [])

  const handleContextMenuClose = useCallback(() => {
    setMenuVisible(false)
    menuOpeningProgress.value = withTiming(0, { duration: 200 })
    onContextMenuClose?.()
  }, [onContextMenuClose, menuOpeningProgress])

  const cachedAnchorRef = useRef<BubbleAnchor | null>(null)

  const handlePressIn = useCallback(() => {
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      cachedAnchorRef.current = { x, y, width, height }
    })
  }, [])

  const handleLongPress = () => {
    if (isRecalled) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    measureAnchor((nextAnchor) => {
      queueContextMenuOpen(nextAnchor)

      requestAnimationFrame(() => {
        onRequestKeyboardPreservation?.()
      })
    })
  }

  const handleSwipeReply = useCallback(() => {
    if (isRecalled) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    requestAnimationFrame(() => {
      onReply?.()
    })
  }, [isRecalled, onReply])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [-8, 0]) }],
  }))

  const bubbleHighlightWrapStyle = useAnimatedStyle(() => {
    const menuScale = interpolate(menuOpeningProgress.value, [0, 1], [1, 1.05])
    const menuTranslateY = interpolate(menuOpeningProgress.value, [0, 1], [0, -4])

    const highlightScale = interpolate(highlightProgress.value, [0, 1], [1, 1.048])
    const highlightTranslateY = interpolate(highlightProgress.value, [0, 1], [0, -2])

    return {
      transform: [
        { scale: Math.max(menuScale, highlightScale) },
        { translateY: menuTranslateY + highlightTranslateY },
      ],
      zIndex: highlightProgress.value > 0 || menuOpeningProgress.value > 0 ? 2 : 0,
    }
  })

  const swipeBubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeOffsetX.value }],
  }))

  const swipeIndicatorStyle = useAnimatedStyle(() => {
    const currentTranslation = Math.abs(swipeOffsetX.value)
    const progress = Math.min(currentTranslation / SWIPE_REPLY_TRIGGER_DISTANCE, 1)

    return {
      opacity: interpolate(progress, [0, 0.3, 1], [0, 0.45, 1]),
      transform: [
        { scale: interpolate(progress, [0, 1], [0.8, 1]) },
        { translateX: interpolate(progress, [0, 1], [swipeDirection * -8, 0]) },
      ],
    }
  })

  const picture = senderInfo?.picture
  const senderName = senderInfo && 'name' in senderInfo ? senderInfo.name : undefined
  const fallbackInitial =
    senderName?.charAt(0).toUpperCase() || senderInfo?.email?.charAt(0).toUpperCase() || '?'

  const reactionSummary = useMemo(() => {
    const summary: Record<string, number> = {}
    Object.values(message.reactions || {}).forEach((reaction: { emoji: string }) => {
      if (reaction?.emoji) {
        summary[reaction.emoji] = (summary[reaction.emoji] || 0) + 1
      }
    })
    return summary
  }, [message.reactions])

  const replyPreviewMeta = useMemo(
    () => getReplyPreviewMeta(message.replyPreview),
    [message.replyPreview],
  )
  const senderDisplayName = useMemo(
    () => getSenderDisplayName({ isOwn, senderInfo }),
    [isOwn, senderInfo],
  )
  const hasReactions = Object.keys(reactionSummary).length > 0
  const bubbleCornerClassName = cn(
    'rounded-[18px]',
    isOwn && isGroupedTop && 'rounded-tr-[4px]',
    isOwn && isGroupedBottom && 'rounded-br-[4px]',
    !isOwn && isGroupedTop && 'rounded-tl-[4px]',
    !isOwn && isGroupedBottom && 'rounded-bl-[4px]',
  )
  const bubbleClassName = cn(
    !isImage && 'px-4 py-3',
    !isImage && (isOwn ? 'bg-bubble-out' : 'bg-bubble-in'),
    'overflow-hidden',
    bubbleCornerClassName,
  )

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isRecalled && Boolean(onReply))
        .activeOffsetX([-10, 10])
        .failOffsetY([-5, 5])
        .maxPointers(1)
        .onUpdate((event) => {
          'worklet'
          const translation = event.translationX * swipeDirection

          if (translation > 0) {
            swipeOffsetX.value = swipeDirection * Math.min(translation, SWIPE_REPLY_MAX_DISTANCE)
          }
        })
        .onEnd((event) => {
          'worklet'
          const translation = event.translationX * swipeDirection

          if (translation >= SWIPE_REPLY_TRIGGER_DISTANCE) {
            runOnJS(handleSwipeReply)()
          }

          swipeOffsetX.value = withSpring(0, {
            mass: 0.8,
            damping: 18,
            stiffness: 220,
            overshootClamping: false,
          })
        }),
    [handleSwipeReply, isRecalled, onReply, swipeDirection, swipeOffsetX],
  )

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
          <View className="w-8 mr-2.5 items-center justify-end pb-0.5">
            {showAvatar &&
              (picture ? (
                <Image source={{ uri: picture }} className="w-8 h-8 rounded-full" />
              ) : (
                <View className="w-8 h-8 rounded-full bg-surface-muted items-center justify-center">
                  <Text className="text-text-primary text-[10px] font-medium">
                    {fallbackInitial}
                  </Text>
                </View>
              ))}
          </View>
        )}

        <View className={cn('max-w-[78%]', isOwn ? 'items-end' : 'items-start')}>
          {replyPreviewMeta ? (
            <View className={cn('mb-1 mt-2', isOwn ? 'items-end' : 'items-start')}>
              <View className="mb-1 flex-row items-center px-1">
                <MaterialIcons name="reply" size={15} color="#A6A6A6" />
                <Text className="ml-1.5 text-[12px] font-medium text-text-muted">
                  {senderDisplayName} replied to {replyPreviewMeta.senderLabel}
                </Text>
              </View>

              <Pressable
                onPress={onPressReplyPreview ?? null}
                disabled={!onPressReplyPreview}
                className="max-w-full rounded-[22px] bg-surface-input px-4 py-3"
              >
                {replyPreviewMeta.type === 'text' ? (
                  <Text
                    className="text-[15px] leading-[24px] text-text-secondary"
                    numberOfLines={3}
                  >
                    {replyPreviewMeta.contentLabel}
                  </Text>
                ) : (
                  <View className="flex-row items-center">
                    <MaterialIcons
                      name={replyPreviewMeta.iconName}
                      size={16}
                      color="#8A8A8A"
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      className="flex-1 text-[14px] leading-[21px] text-text-secondary"
                      numberOfLines={2}
                    >
                      {replyPreviewMeta.contentLabel}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
          ) : null}

          <GestureDetector gesture={swipeGesture}>
            <Animated.View style={[bubbleHighlightWrapStyle, swipeBubbleStyle]}>
              <View className="relative">
                <Animated.View
                  pointerEvents="none"
                  className={cn(
                    'absolute top-1/2 -mt-[18px] h-9 w-9 items-center justify-center rounded-full border border-border-light bg-surface-card',
                    isOwn ? '-left-11' : '-right-11',
                  )}
                  style={swipeIndicatorStyle}
                >
                  <MaterialIcons name="reply" size={16} color="#FF6B2C" />
                </Animated.View>

                <View ref={bubbleRef} collapsable={false}>
                  <Pressable
                    onPress={toggleDetails}
                    onPressIn={handlePressIn}
                    {...(!isRecalled
                      ? {
                          onLongPress: handleLongPress,
                          delayLongPress: 180,
                        }
                      : null)}
                    className={bubbleClassName}
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
                          className="w-48 h-64 rounded-[18px] bg-surface-card"
                          resizeMode="cover"
                        />
                        {isSending && (
                          <View className="absolute inset-0 items-center justify-center rounded-[18px] bg-black/30">
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
                </View>
              </View>
            </Animated.View>
          </GestureDetector>

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
                  className={cn('flex-row items-center rounded-full px-2 py-1 bg-surface-input')}
                >
                  <Text className="text-xs">{emoji}</Text>
                  <Text className={cn('text-xs ml-0.5 text-text-muted')}>{count}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <View
            style={{
              height: isExpanded ? 20 : 0,
              marginTop: isExpanded ? 4 : 0,
              overflow: 'hidden',
            }}
          >
            <Animated.View style={animatedStyle}>
              <View
                className={cn('flex-row items-center', isOwn ? 'justify-end' : 'justify-start')}
              >
                <Text className="px-1 text-[11px] text-text-muted">
                  {timeString}
                  {isOwn && ` • ${getStatusText()}`}
                </Text>
                {isOwn && isSeen && !isSending && (
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
      </View>

      <MessageContextMenu
        visible={menuVisible}
        message={message}
        isOwn={isOwn}
        isGroupedTop={isGroupedTop ?? false}
        isGroupedBottom={isGroupedBottom ?? false}
        anchor={anchor}
        onClose={handleContextMenuClose}
        onReply={onReply}
        onRecall={onRecall}
        conversationId={resolvedConversationId}
      />
    </>
  )
}

export const MessageBubble = memo(MessageBubbleComponent, (prevProps, nextProps) => {
  const prevPreview = getReplyPreviewMeta(prevProps.message.replyPreview)
  const nextPreview = getReplyPreviewMeta(nextProps.message.replyPreview)

  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.status === nextProps.message.status &&
    prevProps.message.readBy === nextProps.message.readBy &&
    prevProps.message.reactions === nextProps.message.reactions &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.showAvatar === nextProps.showAvatar &&
    prevProps.isGroupedTop === nextProps.isGroupedTop &&
    prevProps.isGroupedBottom === nextProps.isGroupedBottom &&
    prevProps.highlightToken === nextProps.highlightToken &&
    prevProps.message.isRecalled === nextProps.message.isRecalled &&
    prevProps.message.is_recalled === nextProps.message.is_recalled &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevPreview?.senderLabel === nextPreview?.senderLabel &&
    prevPreview?.contentLabel === nextPreview?.contentLabel &&
    prevPreview?.type === nextPreview?.type
  )
})
