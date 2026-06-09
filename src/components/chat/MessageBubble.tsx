import { MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import * as VideoThumbnails from 'expo-video-thumbnails'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import {
  calculateChatMediaDisplaySize,
  getResolvedMediaPosterUri,
  getResolvedMediaUri,
} from '../../lib/chatMedia'
import { cn } from '../../lib/cn'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import { ReelVideo } from '../reels/ReelVideo'

import { ChatMediaBubble } from './ChatMediaBubble'

import type { ChatMediaViewerOpenPayload } from './ChatMediaViewer'
import type { BubbleAnchor } from './MessageContextMenu'
import type {
  ChatParticipant,
  Message,
  ReactionMap,
  ReplyPreviewData,
} from '../../types/conversation.types'

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
const VIDEO_FILE_URI_PATTERN = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i
const SWIPE_REPLY_TRIGGER_DISTANCE = 72
const TIMESTAMP_REVEAL_MAX_OFFSET = 64
const generatedReplyVideoThumbnailCache = new Map<string, string | null>()

const getReplyPreviewThumbnailUri = (replyPreview?: Message['replyPreview'], replyTo?: Message) => {
  if (typeof replyPreview !== 'string' && replyPreview?.thumbnailUri?.trim()) {
    const thumbnailUri = replyPreview.thumbnailUri.trim()
    if (replyPreview.type === 'video' && VIDEO_FILE_URI_PATTERN.test(thumbnailUri)) {
      return null
    }

    return thumbnailUri
  }

  if (!replyTo || (replyTo.type !== 'image' && replyTo.type !== 'video')) {
    return null
  }

  if (replyTo.type === 'video') {
    return getResolvedMediaPosterUri(replyTo.media) ?? null
  }

  return getResolvedMediaUri(replyTo.media) ?? null
}

const getReplyPreviewMediaSize = (replyPreview?: Message['replyPreview'], replyTo?: Message) => {
  if (typeof replyPreview !== 'string') {
    const mediaWidth = replyPreview?.mediaWidth
    const mediaHeight = replyPreview?.mediaHeight

    if (mediaWidth || mediaHeight) {
      return {
        mediaWidth: mediaWidth ?? null,
        mediaHeight: mediaHeight ?? null,
      }
    }
  }

  return {
    mediaWidth: replyTo?.media?.width ?? replyTo?.media?.displayWidth ?? null,
    mediaHeight: replyTo?.media?.height ?? replyTo?.media?.displayHeight ?? null,
  }
}

const getReplyPreviewMeta = ({
  currentUserId,
  replyPreview,
  replyTo,
}: {
  currentUserId: string | null
  replyPreview: string | ReplyPreviewData | undefined
  replyTo: Message | undefined
}) => {
  if (!replyPreview) return null

  if (typeof replyPreview === 'string') {
    return {
      senderLabel: 'Original message',
      contentLabel: RECALLED_PREVIEW_MAP[replyPreview] ?? replyPreview,
      iconName: REPLY_PREVIEW_ICONS.text,
      mediaWidth: null,
      mediaHeight: null,
      thumbnailUri: null,
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

  const resolvedSenderId = replyPreview.senderId ?? replyTo?.senderId
  const senderLabel =
    currentUserId && resolvedSenderId === currentUserId
      ? 'You'
      : (replyPreview.senderName?.trim() ?? '') || 'Original message'

  return {
    senderLabel,
    contentLabel,
    iconName: REPLY_PREVIEW_ICONS[replyPreview.type],
    ...getReplyPreviewMediaSize(replyPreview, replyTo),
    thumbnailUri: getReplyPreviewThumbnailUri(replyPreview, replyTo),
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

const areReadReceiptsEqual = (left?: Message['readBy'], right?: Message['readBy']) => {
  if (left === right) return true
  if (!left || !right) return !left && !right
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftReceipt = left[index]
    const rightReceipt = right[index]

    if (leftReceipt?.userId !== rightReceipt?.userId || leftReceipt?.at !== rightReceipt?.at) {
      return false
    }
  }

  return true
}

const areReactionsEqual = (left?: ReactionMap, right?: ReactionMap) => {
  if (left === right) return true
  if (!left || !right) return !left && !right

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)

  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  for (const key of leftKeys) {
    const leftReaction = left[key]
    const rightReaction = right[key]

    if (
      !rightReaction ||
      leftReaction?.emoji !== rightReaction.emoji ||
      leftReaction?.createdAt !== rightReaction.createdAt
    ) {
      return false
    }
  }

  return true
}

const areSenderInfosEqual = (
  left?: ChatParticipant | Message['sender'] | null,
  right?: ChatParticipant | Message['sender'] | null,
) => {
  if (left === right) return true
  if (!left || !right) return !left && !right

  return (
    left.email === right.email &&
    left.picture === right.picture &&
    ('name' in left ? left.name : undefined) === ('name' in right ? right.name : undefined)
  )
}

const areMediaEqual = (left?: Message['media'], right?: Message['media']) => {
  if (left === right) return true
  if (!left || !right) return !left && !right

  return (
    left.fileKey === right.fileKey &&
    left.fileUrl === right.fileUrl &&
    left.thumbnailKey === right.thumbnailKey &&
    left.thumbnailUrl === right.thumbnailUrl &&
    left.mimeType === right.mimeType &&
    left.width === right.width &&
    left.height === right.height &&
    left.durationMs === right.durationMs &&
    left.status === right.status &&
    left.failureReason === right.failureReason &&
    left.localFileUri === right.localFileUri &&
    left.localPosterUri === right.localPosterUri &&
    left.displayWidth === right.displayWidth &&
    left.displayHeight === right.displayHeight &&
    left.uploadStage === right.uploadStage
  )
}

const areReplyTargetsEqual = (
  left?: Message['replyTo'] | null,
  right?: Message['replyTo'] | null,
) => {
  if (left === right) return true
  if (!left || !right) return !left && !right

  return left.id === right.id && left.type === right.type && areMediaEqual(left.media, right.media)
}

interface MessageBubbleProps {
  message: Message
  repliedMessage?: Message | null
  timeLabel?: string
  timestampRevealGesture: ReturnType<typeof Gesture.Pan> | undefined
  timestampRevealOffset?: SharedValue<number>
  timestampRevealProgress?: SharedValue<number>
  isOwn: boolean
  isGroupedTop?: boolean
  isGroupedBottom?: boolean
  showAvatar?: boolean
  senderInfo?: ChatParticipant | Message['sender'] | null
  onReactionPress?: (emoji: string) => void
  onReply?: () => void
  conversationId?: string
  highlightToken?: number
  isExpanded?: boolean
  isContextMenuActive?: boolean
  onToggleDetails?: () => void
  onPressReplyPreview?: () => void
  onOpenContextMenu?: (payload: MessageBubbleContextMenuPayload) => void
  onOpenMedia?: (payload: ChatMediaViewerOpenPayload) => void
}

export interface MessageBubbleContextMenuPayload {
  message: Message
  anchor: BubbleAnchor
  isOwn: boolean
  isGroupedTop: boolean
  isGroupedBottom: boolean
  conversationId: string
}

const MessageBubbleComponent = function MessageBubble({
  message,
  repliedMessage,
  timeLabel = '',
  timestampRevealGesture,
  timestampRevealOffset,
  timestampRevealProgress,
  isOwn,
  isGroupedTop,
  isGroupedBottom,
  showAvatar,
  senderInfo: senderInfoProp,
  onReactionPress,
  onReply,
  conversationId,
  highlightToken = 0,
  isExpanded,
  isContextMenuActive = false,
  onToggleDetails,
  onPressReplyPreview,
  onOpenContextMenu,
  onOpenMedia,
}: MessageBubbleProps) {
  const { width: screenWidth } = useWindowDimensions()
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)
  const resolvedConversationId = conversationId || message.conversationId
  const isMarkedSeen = useChatStore(
    useCallback(
      (state) => {
        if (!resolvedConversationId || !message.id) {
          return false
        }

        return state.seenMessages[resolvedConversationId]?.has(message.id) ?? false
      },
      [message.id, resolvedConversationId],
    ),
  )
  const progress = useSharedValue(0)
  const highlightProgress = useSharedValue(0)
  const swipeOffsetX = useSharedValue(0)
  const menuOpeningProgress = useSharedValue(0)
  // const swipeProgress = useSharedValue(0)
  const bubbleRef = useRef<View>(null)
  const isExpandedRef = useRef(isExpanded)

  const senderInfo = senderInfoProp ?? message.sender ?? null
  isExpandedRef.current = isExpanded
  const [generatedReplyThumbnailUri, setGeneratedReplyThumbnailUri] = useState<string | null>(null)

  const isFailed = message.status === 'FAILED'
  const isPending = message.status === 'PENDING'
  const isSending =
    isPending || ((message.id || message._id || '').startsWith('temp-') && !isFailed)
  const hasReadReceipt = Array.isArray(message.readBy) && message.readBy.length > 0
  const isSeen = message.status === 'READ' || hasReadReceipt || isMarkedSeen

  const getStatusText = () => {
    if (isFailed) return 'Failed'
    if (isPending) return 'Sending...'
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

  const isMedia = message.type === 'image' || message.type === 'video'
  const isRecalled = message.isRecalled === true || message.is_recalled === true
  const swipeDirection = isOwn ? -1 : 1

  const measureAnchor = useCallback((onMeasured: (nextAnchor: BubbleAnchor) => void) => {
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      onMeasured({ x, y, width, height })
    })
  }, [])

  useEffect(() => {
    const nextProgress = isExpandedRef.current ? 1 : 0

    if (progress.value !== nextProgress) {
      progress.value = nextProgress
    }
    if (highlightProgress.value !== 0) {
      highlightProgress.value = 0
    }
    if (swipeOffsetX.value !== 0) {
      swipeOffsetX.value = 0
    }
    if (menuOpeningProgress.value !== 0) {
      menuOpeningProgress.value = 0
    }
  }, [highlightProgress, menuOpeningProgress, message.id, progress, swipeOffsetX])

  useEffect(() => {
    const nextValue = isContextMenuActive ? 1 : 0

    if (menuOpeningProgress.value === nextValue) {
      return
    }

    menuOpeningProgress.value = withTiming(nextValue, {
      duration: isContextMenuActive ? 220 : 180,
    })
  }, [isContextMenuActive, menuOpeningProgress])

  const handleLongPress = () => {
    if (isRecalled || !onOpenContextMenu) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    measureAnchor((nextAnchor) => {
      onOpenContextMenu({
        message,
        anchor: nextAnchor,
        isOwn,
        isGroupedTop: Boolean(isGroupedTop),
        isGroupedBottom: Boolean(isGroupedBottom),
        conversationId: resolvedConversationId,
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

  const contentRevealStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: timestampRevealOffset?.value ?? 0 }],
  }))

  const bubbleWrapStyle = useAnimatedStyle(() => {
    const menuScale = interpolate(menuOpeningProgress.value, [0, 1], [1, 1.015])
    const menuTranslateY = interpolate(menuOpeningProgress.value, [0, 1], [0, -1])

    const highlightScale = interpolate(highlightProgress.value, [0, 1], [1, 1.048])
    const highlightTranslateY = interpolate(highlightProgress.value, [0, 1], [0, -2])

    return {
      transform: [
        { translateX: swipeOffsetX.value },
        { scale: Math.max(menuScale, highlightScale) },
        { translateY: menuTranslateY + highlightTranslateY },
      ],
      zIndex: highlightProgress.value > 0 || menuOpeningProgress.value > 0 ? 2 : 0,
    }
  })

  const timestampColumnStyle = useAnimatedStyle(() => {
    const revealProgress = timestampRevealProgress?.value ?? 0

    return {
      opacity: revealProgress,
      transform: [
        {
          translateX: interpolate(revealProgress, [0, 1], [8, 0]),
        },
      ],
      width: TIMESTAMP_REVEAL_MAX_OFFSET,
    }
  })

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

  const resolvedReplyTarget = repliedMessage ?? message.replyTo
  const replyPreviewMeta = useMemo(
    () =>
      getReplyPreviewMeta({
        currentUserId,
        replyPreview: message.replyPreview,
        replyTo: resolvedReplyTarget,
      }),
    [currentUserId, message.replyPreview, resolvedReplyTarget],
  )
  const repliedVideoUri =
    resolvedReplyTarget?.type === 'video' ? getResolvedMediaUri(resolvedReplyTarget.media) : null

  useEffect(() => {
    if (
      replyPreviewMeta?.type !== 'video' ||
      replyPreviewMeta.thumbnailUri ||
      !repliedVideoUri ||
      !URI_LIKE_PATTERN.test(repliedVideoUri)
    ) {
      setGeneratedReplyThumbnailUri(null)
      return
    }

    const cachedThumbnailUri = generatedReplyVideoThumbnailCache.get(repliedVideoUri)
    if (cachedThumbnailUri !== undefined) {
      setGeneratedReplyThumbnailUri(cachedThumbnailUri)
      return
    }

    let cancelled = false

    void VideoThumbnails.getThumbnailAsync(repliedVideoUri, {
      quality: 0.55,
      time: 1000,
    })
      .then((result) => {
        if (cancelled) {
          return
        }

        generatedReplyVideoThumbnailCache.set(repliedVideoUri, result.uri)
        setGeneratedReplyThumbnailUri(result.uri)
      })
      .catch(() => {
        if (cancelled) {
          return
        }

        generatedReplyVideoThumbnailCache.set(repliedVideoUri, null)
        setGeneratedReplyThumbnailUri(null)
      })

    return () => {
      cancelled = true
    }
  }, [repliedVideoUri, replyPreviewMeta?.thumbnailUri, replyPreviewMeta?.type])

  const resolvedReplyPreviewThumbnailUri =
    replyPreviewMeta?.thumbnailUri ?? generatedReplyThumbnailUri
  const replyPreviewMediaSize = useMemo(() => {
    if (!replyPreviewMeta) {
      return null
    }

    const hasRenderableVideoFallback = replyPreviewMeta.type === 'video' && Boolean(repliedVideoUri)

    if (
      (!resolvedReplyPreviewThumbnailUri && !hasRenderableVideoFallback) ||
      (replyPreviewMeta.type !== 'image' && replyPreviewMeta.type !== 'video')
    ) {
      return null
    }

    const maxWidth = Math.max(156, Math.min(Math.floor(screenWidth * 0.48), 220))

    return calculateChatMediaDisplaySize({
      height: replyPreviewMeta.mediaHeight,
      maxWidth,
      width: replyPreviewMeta.mediaWidth,
    })
  }, [replyPreviewMeta, repliedVideoUri, resolvedReplyPreviewThumbnailUri, screenWidth])
  const senderDisplayName = useMemo(
    () => getSenderDisplayName({ isOwn, senderInfo }),
    [isOwn, senderInfo],
  )
  const hasReactions = Object.keys(reactionSummary).length > 0
  const bubbleClassName = useMemo(
    () =>
      cn(
        !isMedia && 'px-4 py-3',
        !isMedia && (isOwn ? 'bg-bubble-out' : 'bg-bubble-in'),
        'overflow-hidden rounded-[18px]',
        isOwn && isGroupedTop && 'rounded-tr-[4px]',
        isOwn && isGroupedBottom && 'rounded-br-[4px]',
        !isOwn && isGroupedTop && 'rounded-tl-[4px]',
        !isOwn && isGroupedBottom && 'rounded-bl-[4px]',
      ),
    [isGroupedBottom, isGroupedTop, isMedia, isOwn],
  )
  const isSwipeReplyEnabled = !isRecalled && Boolean(onReply)

  const swipeGesture = useMemo(() => {
    const gesture = Gesture.Pan()
      .enabled(isSwipeReplyEnabled)
      .activeOffsetX(isOwn ? [-10, 9999] : [-9999, 10])
      .failOffsetY([-5, 5])
      .maxPointers(1)
      .onUpdate((event) => {
        'worklet'
        let translation = event.translationX * swipeDirection

        if (translation > 0) {
          if (translation > SWIPE_REPLY_TRIGGER_DISTANCE) {
            const extraPull = translation - SWIPE_REPLY_TRIGGER_DISTANCE
            translation = SWIPE_REPLY_TRIGGER_DISTANCE + extraPull * 0.25
          }
          swipeOffsetX.value = swipeDirection * translation
        }
      })
      .onEnd((event) => {
        'worklet'
        const translation = event.translationX * swipeDirection

        if (translation >= SWIPE_REPLY_TRIGGER_DISTANCE) {
          scheduleOnRN(handleSwipeReply)
        }

        swipeOffsetX.value = withSpring(0, {
          mass: 1.2,
          damping: 26,
          stiffness: 280,
          overshootClamping: false,
        })
      })

    if (timestampRevealGesture && isOwn) {
      gesture.blocksExternalGesture(timestampRevealGesture)
    }

    return gesture
  }, [
    handleSwipeReply,
    isOwn,
    isSwipeReplyEnabled,
    swipeDirection,
    swipeOffsetX,
    timestampRevealGesture,
  ])

  return (
    <View className={cn('w-full px-4', isGroupedBottom ? 'mb-[2px]' : 'mb-3')}>
      <View className="flex-1 relative">
        <Animated.View
          style={contentRevealStyle}
          className={cn('flex-row items-end', isOwn ? 'justify-end' : 'justify-start')}
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
                  className={cn(
                    'max-w-full overflow-hidden rounded-[22px] bg-surface-input',
                    replyPreviewMeta.type === 'text' ? 'px-4 py-3' : 'p-2',
                  )}
                >
                  {replyPreviewMeta.type === 'text' ? (
                    <Text
                      className="text-[15px] leading-[24px] text-text-secondary"
                      numberOfLines={3}
                    >
                      {replyPreviewMeta.contentLabel}
                    </Text>
                  ) : (
                    <View>
                      {((resolvedReplyPreviewThumbnailUri &&
                        (replyPreviewMeta.type === 'image' || replyPreviewMeta.type === 'video')) ||
                        (replyPreviewMeta.type === 'video' && repliedVideoUri)) &&
                      replyPreviewMediaSize ? (
                        <View
                          style={{
                            width: replyPreviewMediaSize.displayWidth,
                            height: replyPreviewMediaSize.displayHeight,
                            borderRadius: 16,
                            overflow: 'hidden',
                            backgroundColor:
                              replyPreviewMeta.type === 'video' ? '#111111' : '#EFEFEF',
                            alignSelf: 'flex-start',
                          }}
                        >
                          {replyPreviewMeta.type === 'video' && repliedVideoUri ? (
                            <ReelVideo
                              contentFit="contain"
                              loop={false}
                              muted
                              nativeControls={false}
                              shouldPlay={false}
                              style={{
                                width: replyPreviewMediaSize.displayWidth,
                                height: replyPreviewMediaSize.displayHeight,
                              }}
                              uri={repliedVideoUri}
                              {...(resolvedReplyPreviewThumbnailUri
                                ? { posterUri: resolvedReplyPreviewThumbnailUri }
                                : {})}
                            />
                          ) : resolvedReplyPreviewThumbnailUri ? (
                            <Image
                              source={{ uri: resolvedReplyPreviewThumbnailUri }}
                              style={{
                                width: replyPreviewMediaSize.displayWidth,
                                height: replyPreviewMediaSize.displayHeight,
                              }}
                              resizeMode="contain"
                            />
                          ) : null}
                          {replyPreviewMeta.type === 'video' ? (
                            <View
                              pointerEvents="none"
                              style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                top: 0,
                                bottom: 0,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <View
                                style={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: 22,
                                  backgroundColor: 'rgba(12,12,13,0.58)',
                                  borderWidth: 1,
                                  borderColor: 'rgba(255,255,255,0.16)',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <MaterialIcons name="play-arrow" size={24} color="#FFFFFF" />
                              </View>
                            </View>
                          ) : null}
                        </View>
                      ) : (
                        <View className="flex-row items-center px-2 py-1">
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

                      {(resolvedReplyPreviewThumbnailUri ||
                        (replyPreviewMeta.type === 'video' && repliedVideoUri)) &&
                      (replyPreviewMeta.type === 'image' || replyPreviewMeta.type === 'video') ? (
                        <Text
                          className="px-1 pt-2 text-[13px] leading-[18px] text-text-secondary"
                          numberOfLines={1}
                        >
                          {replyPreviewMeta.contentLabel}
                        </Text>
                      ) : null}
                    </View>
                  )}
                </Pressable>
              </View>
            ) : null}

            <GestureDetector gesture={swipeGesture}>
              <View className="flex-row items-center">
                <Animated.View style={[bubbleWrapStyle, { flexShrink: 0 }]}>
                  <View ref={bubbleRef} collapsable={false} className="relative">
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

                    <Pressable
                      onPress={isMedia ? undefined : toggleDetails}
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
                      ) : isMedia ? (
                        <ChatMediaBubble
                          delayLongPress={180}
                          message={message}
                          onLongPress={handleLongPress}
                          {...(onOpenMedia ? { onOpenMedia } : {})}
                        />
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
                </Animated.View>
              </View>
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
                    {timeLabel}
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
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[timestampColumnStyle, { position: 'absolute', right: 0, top: 0, bottom: 0 }]}
          className="items-end justify-center"
        >
          <Text className="text-[11px] text-text-muted" numberOfLines={1}>
            {timeLabel}
          </Text>
        </Animated.View>
      </View>
    </View>
  )
}

export const MessageBubble = memo(MessageBubbleComponent, (prevProps, nextProps) => {
  const prevReply = prevProps.message.replyPreview as ReplyPreviewData | string | undefined
  const nextReply = nextProps.message.replyPreview as ReplyPreviewData | string | undefined

  const isReplyEqual =
    typeof prevReply === 'string' || typeof nextReply === 'string'
      ? prevReply === nextReply
      : prevReply?.content === nextReply?.content &&
        prevReply?.mediaWidth === nextReply?.mediaWidth &&
        prevReply?.mediaHeight === nextReply?.mediaHeight &&
        prevReply?.thumbnailUri === nextReply?.thumbnailUri &&
        prevReply?.type === nextReply?.type &&
        prevReply?.senderId === nextReply?.senderId &&
        prevReply?.senderName === nextReply?.senderName

  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.type === nextProps.message.type &&
    areMediaEqual(prevProps.message.media, nextProps.message.media) &&
    prevProps.message.senderId === nextProps.message.senderId &&
    prevProps.message.status === nextProps.message.status &&
    areReadReceiptsEqual(prevProps.message.readBy, nextProps.message.readBy) &&
    areReactionsEqual(prevProps.message.reactions, nextProps.message.reactions) &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.showAvatar === nextProps.showAvatar &&
    areSenderInfosEqual(prevProps.senderInfo, nextProps.senderInfo) &&
    prevProps.timeLabel === nextProps.timeLabel &&
    prevProps.isGroupedTop === nextProps.isGroupedTop &&
    prevProps.isGroupedBottom === nextProps.isGroupedBottom &&
    prevProps.highlightToken === nextProps.highlightToken &&
    prevProps.message.isRecalled === nextProps.message.isRecalled &&
    prevProps.message.is_recalled === nextProps.message.is_recalled &&
    areReplyTargetsEqual(prevProps.message.replyTo, nextProps.message.replyTo) &&
    areReplyTargetsEqual(prevProps.repliedMessage, nextProps.repliedMessage) &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.isContextMenuActive === nextProps.isContextMenuActive &&
    prevProps.onOpenMedia === nextProps.onOpenMedia &&
    isReplyEqual
  )
})
