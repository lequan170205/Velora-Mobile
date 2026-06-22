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
import {
  RECALLED_PREVIEW_TEXT,
  isReplyPreviewRecalled,
  normalizeReplyPreview,
  normalizeReplyPreviewContent,
} from '../../lib/replyPreview'
import { useAuthStore } from '../../stores/authStore'
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
  if (isReplyPreviewRecalled({ replyPreview, replyTo })) {
    return null
  }

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
  if (isReplyPreviewRecalled({ replyPreview, replyTo })) {
    return {
      mediaWidth: null,
      mediaHeight: null,
    }
  }

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

  const normalizedReplyPreview = normalizeReplyPreview(replyPreview)
  if (!normalizedReplyPreview) return null

  if (typeof normalizedReplyPreview === 'string') {
    return {
      senderLabel: 'Original message',
      contentLabel: normalizeReplyPreviewContent(normalizedReplyPreview) || RECALLED_PREVIEW_TEXT,
      iconName: REPLY_PREVIEW_ICONS.text,
      mediaWidth: null,
      mediaHeight: null,
      thumbnailUri: null,
      type: 'text' as const,
    }
  }

  const normalizedContent = normalizeReplyPreviewContent(normalizedReplyPreview.content)
  const isUriLikeContent = URI_LIKE_PATTERN.test(normalizedContent)

  const contentLabel =
    normalizedReplyPreview.type === 'text'
      ? normalizedContent || REPLY_PREVIEW_FALLBACK_LABELS.text
      : isUriLikeContent || !normalizedContent
        ? REPLY_PREVIEW_FALLBACK_LABELS[normalizedReplyPreview.type]
        : normalizedContent

  const resolvedSenderId = normalizedReplyPreview.senderId ?? replyTo?.senderId
  const senderLabel =
    currentUserId && resolvedSenderId === currentUserId
      ? 'You'
      : (normalizedReplyPreview.senderName?.trim() ?? '') || 'Original message'

  return {
    senderLabel,
    contentLabel,
    iconName: REPLY_PREVIEW_ICONS[normalizedReplyPreview.type],
    ...getReplyPreviewMediaSize(normalizedReplyPreview, replyTo),
    thumbnailUri: getReplyPreviewThumbnailUri(normalizedReplyPreview, replyTo),
    type: normalizedReplyPreview.type,
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
  primaryStatusLabel: string | null
  readReceiptParticipants: ChatParticipant[]
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
  primaryStatusLabel,
  readReceiptParticipants,
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
  const CONTEXT_MENU_LONG_PRESS_DELAY_MS = 140
  const MEDIA_CONTEXT_MENU_LONG_PRESS_DELAY_MS = 180
  const { width: screenWidth } = useWindowDimensions()
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)
  const resolvedConversationId = conversationId || message.conversationId
  const progress = useSharedValue(0)
  const highlightProgress = useSharedValue(0)
  const swipeOffsetX = useSharedValue(0)
  const contextMenuOpacityProgress = useSharedValue(isContextMenuActive ? 0 : 1)
  // const swipeProgress = useSharedValue(0)
  const bubbleRef = useRef<View>(null)
  const cachedAnchorRef = useRef<BubbleAnchor | null>(null)
  const pressInSequenceRef = useRef(0)
  const cachedAnchorSequenceRef = useRef(0)
  const isExpandedRef = useRef(isExpanded)

  const senderInfo = senderInfoProp ?? message.sender ?? null
  isExpandedRef.current = isExpanded
  const [generatedReplyThumbnailUri, setGeneratedReplyThumbnailUri] = useState<string | null>(null)
  const primaryMetaVisible = Boolean(primaryStatusLabel || readReceiptParticipants[0])
  const primaryMetaProgress = useSharedValue(primaryMetaVisible ? 1 : 0)

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

  useEffect(() => {
    primaryMetaProgress.value = withTiming(primaryMetaVisible ? 1 : 0, {
      duration: primaryMetaVisible ? 180 : 140,
    })
  }, [primaryMetaProgress, primaryMetaVisible])

  const toggleDetails = () => {
    if (onToggleDetails) onToggleDetails()
  }

  const isRecalled = message.isRecalled === true || message.is_recalled === true
  const isMedia = message.type === 'image' || message.type === 'video'
  const shouldRenderMediaBubble = isMedia && !isRecalled
  const swipeDirection = isOwn ? -1 : 1

  const measureAnchor = useCallback((onMeasured: (nextAnchor: BubbleAnchor) => void) => {
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      const nextAnchor = { x, y, width, height }
      cachedAnchorRef.current = nextAnchor
      cachedAnchorSequenceRef.current = pressInSequenceRef.current
      onMeasured(nextAnchor)
    })
  }, [])

  const handlePressIn = useCallback(() => {
    pressInSequenceRef.current += 1
    const nextSequence = pressInSequenceRef.current
    cachedAnchorRef.current = null
    cachedAnchorSequenceRef.current = 0

    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      if (pressInSequenceRef.current !== nextSequence) {
        return
      }

      cachedAnchorRef.current = { x, y, width, height }
      cachedAnchorSequenceRef.current = nextSequence
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
  }, [highlightProgress, message.id, progress, swipeOffsetX])

  useEffect(() => {
    cachedAnchorRef.current = null
    cachedAnchorSequenceRef.current = 0
    pressInSequenceRef.current = 0
  }, [message.id])

  useEffect(() => {
    contextMenuOpacityProgress.value = withTiming(isContextMenuActive ? 0 : 1, {
      duration: isContextMenuActive ? 50 : 120,
    })
  }, [contextMenuOpacityProgress, isContextMenuActive])

  const handleLongPress = () => {
    if (isRecalled || !onOpenContextMenu) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    if (cachedAnchorRef.current && cachedAnchorSequenceRef.current === pressInSequenceRef.current) {
      onOpenContextMenu({
        message,
        anchor: cachedAnchorRef.current,
        isOwn,
        isGroupedTop: Boolean(isGroupedTop),
        isGroupedBottom: Boolean(isGroupedBottom),
        conversationId: resolvedConversationId,
      })
      return
    }

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
    const highlightScale = interpolate(highlightProgress.value, [0, 1], [1, 1.048])
    const highlightTranslateY = interpolate(highlightProgress.value, [0, 1], [0, -2])

    return {
      transform: [
        { translateX: swipeOffsetX.value },
        { scale: highlightScale },
        { translateY: highlightTranslateY },
      ],
      zIndex: highlightProgress.value > 0 ? 2 : 0,
    }
  })

  const bubbleVisibilityStyle = useAnimatedStyle(() => ({
    opacity: contextMenuOpacityProgress.value,
  }))

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

  const primaryMetaRowStyle = useAnimatedStyle(() => ({
    height: interpolate(primaryMetaProgress.value, [0, 1], [0, 24]),
    marginTop: interpolate(primaryMetaProgress.value, [0, 1], [0, 4]),
    opacity: primaryMetaProgress.value,
    overflow: 'hidden',
    transform: [{ translateY: interpolate(primaryMetaProgress.value, [0, 1], [-2, 0]) }],
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
  const primaryReceiptParticipant = readReceiptParticipants[0] ?? null
  const primaryReceiptInitial =
    primaryReceiptParticipant?.name?.charAt(0).toUpperCase() ||
    primaryReceiptParticipant?.email?.charAt(0).toUpperCase() ||
    '?'

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
  const isResolvedReplyPreviewRecalled = useMemo(
    () =>
      isReplyPreviewRecalled({ replyPreview: message.replyPreview, replyTo: resolvedReplyTarget }),
    [message.replyPreview, resolvedReplyTarget],
  )
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
    !isResolvedReplyPreviewRecalled && resolvedReplyTarget?.type === 'video'
      ? getResolvedMediaUri(resolvedReplyTarget.media)
      : null

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
        !shouldRenderMediaBubble && 'px-4 py-3',
        !shouldRenderMediaBubble && (isOwn ? 'bg-bubble-out' : 'bg-bubble-in'),
        'overflow-hidden rounded-[18px]',
        isOwn && isGroupedTop && 'rounded-tr-[4px]',
        isOwn && isGroupedBottom && 'rounded-br-[4px]',
        !isOwn && isGroupedTop && 'rounded-tl-[4px]',
        !isOwn && isGroupedBottom && 'rounded-bl-[4px]',
      ),
    [isGroupedBottom, isGroupedTop, isOwn, shouldRenderMediaBubble],
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
        <Animated.View style={contentRevealStyle} className="flex-col w-full">
          <View className={cn('flex-row items-end', isOwn ? 'justify-end' : 'justify-start')}>
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
                          (replyPreviewMeta.type === 'image' ||
                            replyPreviewMeta.type === 'video')) ||
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
                  <Animated.View
                    style={[bubbleWrapStyle, bubbleVisibilityStyle, { flexShrink: 0 }]}
                  >
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
                        onPress={shouldRenderMediaBubble ? undefined : toggleDetails}
                        {...(!isRecalled
                          ? {
                              onPressIn: handlePressIn,
                              onLongPress: handleLongPress,
                              delayLongPress: CONTEXT_MENU_LONG_PRESS_DELAY_MS,
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
                        ) : shouldRenderMediaBubble ? (
                          <ChatMediaBubble
                            delayLongPress={MEDIA_CONTEXT_MENU_LONG_PRESS_DELAY_MS}
                            message={message}
                            onLongPress={handleLongPress}
                            onPressIn={handlePressIn}
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
                      className={cn(
                        'flex-row items-center rounded-full px-2 py-1 bg-surface-input',
                      )}
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
                    <Text className="px-1 text-[11px] text-text-muted">{timeLabel}</Text>
                  </View>
                </Animated.View>
              </View>
            </View>
          </View>

          <Animated.View style={primaryMetaRowStyle} className="w-full">
            {primaryStatusLabel || primaryReceiptParticipant ? (
              <View className="flex-row justify-end items-center gap-1 px-1">
                {primaryReceiptParticipant ? (
                  primaryReceiptParticipant.picture ? (
                    <Image
                      source={{ uri: primaryReceiptParticipant.picture }}
                      className="h-4 w-4 rounded-full"
                    />
                  ) : (
                    <View className="h-4 w-4 items-center justify-center rounded-full bg-surface-muted">
                      <Text className="text-[8px] font-medium text-text-primary">
                        {primaryReceiptInitial}
                      </Text>
                    </View>
                  )
                ) : primaryStatusLabel ? (
                  <Text className="text-[11px] text-text-muted">{primaryStatusLabel}</Text>
                ) : null}
              </View>
            ) : null}
          </Animated.View>
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
    prevProps.primaryStatusLabel === nextProps.primaryStatusLabel &&
    prevProps.readReceiptParticipants === nextProps.readReceiptParticipants &&
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
