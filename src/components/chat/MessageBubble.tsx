import { MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import * as VideoThumbnails from 'expo-video-thumbnails'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native'
import {
  Gesture,
  GestureDetector,
  ScrollView as GestureHandlerScrollView,
} from 'react-native-gesture-handler'
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
import {
  buildChatReelMediaFromReel,
  getSharedReelRouteId,
  isSharedReelMessage,
  serializeChatReelRouteContext,
} from '../../lib/chatReels'
import { cn } from '../../lib/cn'
import {
  getPreferredReelReplyPreviewContent,
  RECALLED_PREVIEW_TEXT,
  isReplyPreviewRecalled,
  normalizeReplyPreview,
  normalizeReplyPreviewContent,
} from '../../lib/replyPreview'
import { useAuthStore } from '../../stores/authStore'
import { ReelVideo } from '../reels/ReelVideo'

import { ChatReelCard, getChatReelCardHeight } from './ChatReelCard'
import { MessageBubbleContent } from './MessageBubbleContent'

import type { ChatMediaViewerOpenPayload } from './ChatMediaViewer'
import type { BubbleAnchor } from './MessageContextMenu'
import type {
  ChatParticipant,
  Message,
  ReactionMap,
  ReplyPreviewData,
} from '../../types/conversation.types'
import type { ReelFeedListItem } from '../../types/reel.types'

// Valid emojis for reactions (matching backend)
export const VALID_EMOJIS = ['👍', '❤️', '😂', '😢', '😮', '😡', '👏', '🎉']

const REPLY_PREVIEW_FALLBACK_LABELS: Record<ReplyPreviewData['type'], string> = {
  text: 'Message',
  image: 'Photo',
  video: 'Video',
  file: 'Attachment',
  call: 'Call',
  reel: 'Reel',
}

const REPLY_PREVIEW_ICONS: Record<
  ReplyPreviewData['type'],
  'format-quote' | 'photo' | 'videocam' | 'attach-file' | 'call' | 'movie-filter'
> = {
  text: 'format-quote',
  image: 'photo',
  video: 'videocam',
  file: 'attach-file',
  call: 'call',
  reel: 'movie-filter',
}

const URI_LIKE_PATTERN = /^(https?:\/\/|file:\/\/|content:\/\/|data:|blob:)/i
const VIDEO_FILE_URI_PATTERN = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i
const SWIPE_REPLY_ACTIVATION_DISTANCE = 6
const SWIPE_REPLY_TRIGGER_DISTANCE = 64
const SWIPE_REPLY_MIN_FLING_DISTANCE = 28
const SWIPE_REPLY_PROJECTION_TIME = 0.055
const SWIPE_REPLY_RESISTANCE_RANGE = 18
const TIMESTAMP_REVEAL_MAX_OFFSET = 64

const getSwipeReplyDisplayDistance = (distance: number) => {
  'worklet'

  const clampedDistance = Math.max(0, distance)
  if (clampedDistance <= SWIPE_REPLY_TRIGGER_DISTANCE) {
    return clampedDistance
  }

  const overshoot = clampedDistance - SWIPE_REPLY_TRIGGER_DISTANCE

  return (
    SWIPE_REPLY_TRIGGER_DISTANCE +
    SWIPE_REPLY_RESISTANCE_RANGE * (1 - Math.exp(-overshoot / SWIPE_REPLY_RESISTANCE_RANGE))
  )
}
const MAX_SUGGESTED_QUERIES = 3
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

  if (
    !replyTo ||
    (replyTo.type !== 'image' && replyTo.type !== 'video' && replyTo.type !== 'reel')
  ) {
    return null
  }

  if (replyTo.type === 'video') {
    return getResolvedMediaPosterUri(replyTo.media) ?? null
  }

  if (replyTo.type === 'reel') {
    return replyTo.media?.thumbnailUrl ?? null
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
    const inferredType =
      replyTo?.type === 'image' || replyTo?.type === 'video' || replyTo?.type === 'reel'
        ? replyTo.type
        : 'text'
    const normalizedContent = normalizeReplyPreviewContent(normalizedReplyPreview)
    const contentLabel =
      inferredType === 'reel'
        ? getPreferredReelReplyPreviewContent({
            content: normalizedReplyPreview,
            reelTitle: replyTo?.media?.reelTitle,
          })
        : inferredType === 'text'
          ? normalizedContent || RECALLED_PREVIEW_TEXT
          : URI_LIKE_PATTERN.test(normalizedContent) || !normalizedContent
            ? REPLY_PREVIEW_FALLBACK_LABELS[inferredType]
            : normalizedContent
    const senderLabel =
      currentUserId && replyTo?.senderId === currentUserId
        ? 'You'
        : replyTo?.sender?.email?.split('@')[0] || 'Original message'

    return {
      senderLabel,
      contentLabel,
      iconName: REPLY_PREVIEW_ICONS[inferredType],
      ...getReplyPreviewMediaSize(normalizedReplyPreview, replyTo),
      thumbnailUri: getReplyPreviewThumbnailUri(normalizedReplyPreview, replyTo),
      type: inferredType,
    }
  }

  const normalizedContent = normalizeReplyPreviewContent(normalizedReplyPreview.content)
  const isUriLikeContent = URI_LIKE_PATTERN.test(normalizedContent)
  const reelContent =
    normalizedReplyPreview.type === 'reel'
      ? getPreferredReelReplyPreviewContent({
          content: normalizedReplyPreview.content,
          reelTitle: replyTo?.media?.reelTitle,
        })
      : null

  const contentLabel =
    normalizedReplyPreview.type === 'reel'
      ? reelContent || REPLY_PREVIEW_FALLBACK_LABELS.reel
      : normalizedReplyPreview.type === 'text'
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

const areStringArraysEqual = (left?: string[], right?: string[]) => {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return !left && !right
  }

  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

const areRecommendedReelsEqual = (left?: ReelFeedListItem[], right?: ReelFeedListItem[]) => {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return !left && !right
  }

  if (left.length !== right.length) {
    return false
  }

  return left.every((reel, index) => {
    const other = right[index]

    return (
      reel.id === other?.id &&
      reel.title === other?.title &&
      reel.thumbnailUrl === other?.thumbnailUrl &&
      reel.localThumbnailUri === other?.localThumbnailUri &&
      reel.author?.id === other?.author?.id &&
      reel.author?.username === other?.author?.username &&
      reel.author?.displayName === other?.author?.displayName &&
      reel.author?.avatarUrl === other?.author?.avatarUrl
    )
  })
}

const areMessageMetadataEqual = (left?: Message['metadata'], right?: Message['metadata']) => {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return !left && !right
  }

  return (
    left.kind === right.kind &&
    areRecommendedReelsEqual(left.recommendedReels, right.recommendedReels) &&
    areStringArraysEqual(left.suggestedQueries, right.suggestedQueries)
  )
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
    left.reelId === right.reelId &&
    left.reelOwnerId === right.reelOwnerId &&
    left.reelOwnerUsername === right.reelOwnerUsername &&
    left.reelOwnerAvatarUrl === right.reelOwnerAvatarUrl &&
    left.reelTitle === right.reelTitle &&
    left.reelDescription === right.reelDescription &&
    areStringArraysEqual(left.reelTags, right.reelTags) &&
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
  isContextMenuActive?: boolean
  onPressReplyPreview?: () => void
  onSendSuggestedQuery?: (query: string) => void
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
  isContextMenuActive = false,
  onPressReplyPreview,
  onSendSuggestedQuery,
  onOpenContextMenu,
  onOpenMedia,
}: MessageBubbleProps) {
  const CONTEXT_MENU_LONG_PRESS_DELAY_MS = 140
  const MEDIA_CONTEXT_MENU_LONG_PRESS_DELAY_MS = 180
  const router = useRouter()
  const { width: screenWidth } = useWindowDimensions()
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)
  const resolvedConversationId = conversationId || message.conversationId
  const highlightProgress = useSharedValue(0)
  const swipeOffsetX = useSharedValue(0)
  const swipeReplyArmed = useSharedValue(false)
  const pressScale = useSharedValue(1)
  // const swipeProgress = useSharedValue(0)
  const bubbleRef = useRef<View>(null)
  const cachedAnchorRef = useRef<BubbleAnchor | null>(null)
  const pressInSequenceRef = useRef(0)
  const cachedAnchorSequenceRef = useRef(0)
  const isContextMenuActiveRef = useRef(isContextMenuActive)
  isContextMenuActiveRef.current = isContextMenuActive

  const senderInfo = senderInfoProp ?? message.sender ?? null
  const [generatedReplyThumbnailUri, setGeneratedReplyThumbnailUri] = useState<string | null>(null)
  const primaryMetaVisible = Boolean(primaryStatusLabel || readReceiptParticipants[0])
  const primaryMetaProgress = useSharedValue(primaryMetaVisible ? 1 : 0)

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

  const isReel = isSharedReelMessage(message)
  const isRecalled = message.isRecalled === true || message.is_recalled === true
  const isMedia = message.type === 'image' || message.type === 'video'
  const shouldRenderMediaBubble = isMedia && !isRecalled
  const recommendationMetadata =
    !isRecalled && message.metadata?.kind === 'velora_ai_reel_recommendations'
      ? message.metadata
      : undefined
  const isRecommendationMessage = Boolean(recommendationMetadata)
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
    if (isContextMenuActiveRef.current) {
      return
    }

    pressInSequenceRef.current += 1
    const nextSequence = pressInSequenceRef.current
    cachedAnchorRef.current = null
    cachedAnchorSequenceRef.current = 0

    // Keep the bubble at a stable scale while a horizontal pan is still possible.
    // The context-menu active state owns the deliberate scale animation instead.
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      if (pressInSequenceRef.current !== nextSequence) {
        return
      }

      cachedAnchorRef.current = { x, y, width, height }
      cachedAnchorSequenceRef.current = nextSequence
    })
  }, [])

  const handlePressOut = useCallback(() => {
    if (isContextMenuActiveRef.current) {
      return
    }

    pressScale.value = withSpring(1, {
      mass: 0.35,
      stiffness: 360,
      damping: 20,
      overshootClamping: false,
    })
  }, [pressScale])

  useEffect(() => {
    if (highlightProgress.value !== 0) {
      highlightProgress.value = 0
    }
    if (swipeOffsetX.value !== 0) {
      swipeOffsetX.value = 0
    }
    swipeReplyArmed.value = false
  }, [highlightProgress, message.id, swipeOffsetX, swipeReplyArmed])

  useEffect(() => {
    cachedAnchorRef.current = null
    cachedAnchorSequenceRef.current = 0
    pressInSequenceRef.current = 0
  }, [message.id])

  useEffect(() => {
    if (isContextMenuActive) {
      pressScale.value = withSpring(1.03, {
        mass: 0.3,
        stiffness: 380,
        damping: 10,
        overshootClamping: false,
      })
    } else {
      pressScale.value = withSpring(1, {
        mass: 0.4,
        stiffness: 260,
        damping: 18,
        overshootClamping: false,
      })
    }
  }, [isContextMenuActive, pressScale])

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

  const triggerSwipeReplyHaptic = useCallback(() => {
    void Haptics.selectionAsync()
  }, [])

  const handleSwipeReply = useCallback(() => {
    if (isRecalled) return
    onReply?.()
  }, [isRecalled, onReply])

  const contentRevealStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: timestampRevealOffset?.value ?? 0 }],
  }))

  const stackSwipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: isRecommendationMessage ? 0 : swipeOffsetX.value }],
  }))

  const bubbleWrapStyle = useAnimatedStyle(() => {
    const highlightScale = interpolate(highlightProgress.value, [0, 1], [1, 1.048])
    const highlightTranslateY = interpolate(highlightProgress.value, [0, 1], [0, -2])
    const combinedScale = pressScale.value * highlightScale

    return {
      transform: [
        { translateX: isRecommendationMessage ? swipeOffsetX.value : 0 },
        { scale: combinedScale },
        { translateY: highlightTranslateY },
      ],
      zIndex: highlightProgress.value > 0 ? 2 : 0,
    }
  })

  const bubbleVisibilityStyle = useAnimatedStyle(() => ({
    opacity: 1,
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
    const armedScale = swipeReplyArmed.value ? 0.08 : 0

    return {
      opacity: interpolate(progress, [0, 0.22, 1], [0, 0.5, 1]),
      transform: [
        { scale: interpolate(progress, [0, 1], [0.78, 1]) + armedScale },
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
      (replyPreviewMeta.type !== 'image' &&
        replyPreviewMeta.type !== 'video' &&
        replyPreviewMeta.type !== 'reel')
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
  const resolvedReelRouteId = getSharedReelRouteId(message)
  const reelCardWidth = Math.max(196, Math.min(Math.floor(screenWidth * 0.58), 238))
  const recommendationCardWidth = Math.max(124, Math.min(Math.floor(screenWidth * 0.34), 144))
  const recommendationCardHeight = getChatReelCardHeight(recommendationCardWidth, 'compact')
  const recommendedReels = useMemo(
    () => recommendationMetadata?.recommendedReels ?? [],
    [recommendationMetadata?.recommendedReels],
  )
  const serializedRecommendedReels = useMemo(
    () => serializeChatReelRouteContext(recommendedReels),
    [recommendedReels],
  )
  const recommendedReelMessages = useMemo<Message[]>(
    () =>
      recommendedReels.map((reel, index) => ({
        id: `${message.id}:recommended-reel:${reel.id}:${index}`,
        conversationId: resolvedConversationId,
        senderId: message.senderId,
        sender: message.sender,
        content: reel.title?.trim() || 'Velora reel',
        media: buildChatReelMediaFromReel(reel),
        type: 'reel',
        status: 'SENT',
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      })),
    [
      message.createdAt,
      message.id,
      message.sender,
      message.senderId,
      message.updatedAt,
      recommendedReels,
      resolvedConversationId,
    ],
  )
  const recommendationRailWidth = useMemo(
    () => Math.max(recommendationCardWidth, Math.floor(screenWidth * 0.78)),
    [recommendationCardWidth, screenWidth],
  )
  const suggestedQueries = useMemo(() => {
    const uniqueQueries = new Set<string>()

    return (recommendationMetadata?.suggestedQueries ?? [])
      .reduce<string[]>((items, query) => {
        const normalizedQuery = query.trim()
        if (!normalizedQuery) {
          return items
        }

        const identity = normalizedQuery.toLowerCase()
        if (uniqueQueries.has(identity)) {
          return items
        }

        uniqueQueries.add(identity)
        items.push(normalizedQuery)
        return items
      }, [])
      .slice(0, MAX_SUGGESTED_QUERIES)
  }, [recommendationMetadata?.suggestedQueries])
  const openReelRoute = useCallback(
    (reelId: string, routeContext?: string | null) => {
      if (!reelId) {
        return
      }

      router.push({
        pathname: '/reels/[id]',
        params: {
          conversationId: resolvedConversationId,
          id: reelId,
          returnTo: 'conversation',
          source: 'chat',
          ...(routeContext ? { contextReels: routeContext } : {}),
        },
      })
    },
    [resolvedConversationId, router],
  )
  const handleOpenReel = useCallback(() => {
    if (!resolvedReelRouteId) {
      return
    }

    openReelRoute(resolvedReelRouteId)
  }, [openReelRoute, resolvedReelRouteId])
  const handleSendSuggestion = useCallback(
    (query: string) => {
      const normalizedQuery = query.trim()
      if (!normalizedQuery) {
        return
      }

      onSendSuggestedQuery?.(normalizedQuery)
    },
    [onSendSuggestedQuery],
  )
  const hasRecommendedReels = recommendedReels.length > 0
  const hasSuggestedQueries = !hasRecommendedReels && suggestedQueries.length > 0
  const hasRecommendationContent = hasRecommendedReels || hasSuggestedQueries
  const handleOpenRecommendedReel = useCallback(
    (reelId: string) => {
      openReelRoute(reelId, serializedRecommendedReels)
    },
    [openReelRoute, serializedRecommendedReels],
  )
  const recommendationRailGesture = useMemo(() => {
    const gesture = Gesture.Native()

    if (timestampRevealGesture) {
      gesture.blocksExternalGesture(timestampRevealGesture)
    }

    return gesture
  }, [timestampRevealGesture])
  const hasReactions = Object.keys(reactionSummary).length > 0
  const bubbleClassName = useMemo(
    () =>
      cn(
        !shouldRenderMediaBubble && !isReel && 'px-4 py-3',
        !shouldRenderMediaBubble && !isReel && (isOwn ? 'bg-bubble-out' : 'bg-bubble-in'),
        isReel && 'bg-transparent p-0',
        'overflow-hidden rounded-[18px]',
        isOwn && isGroupedTop && 'rounded-tr-[4px]',
        isOwn && isGroupedBottom && 'rounded-br-[4px]',
        !isOwn && isGroupedTop && 'rounded-tl-[4px]',
        !isOwn && isGroupedBottom && 'rounded-bl-[4px]',
      ),
    [isGroupedBottom, isGroupedTop, isOwn, isReel, shouldRenderMediaBubble],
  )
  const isSwipeReplyEnabled = !isRecalled && Boolean(onReply)

  const { bubbleSwipeGesture, stackSwipeGesture } = useMemo(() => {
    const createSwipeGesture = (enabled: boolean) => {
      const gesture = Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX(
          isOwn
            ? [-SWIPE_REPLY_ACTIVATION_DISTANCE, 9999]
            : [-9999, SWIPE_REPLY_ACTIVATION_DISTANCE],
        )
        .failOffsetY([-12, 12])
        .maxPointers(1)
        .onBegin(() => {
          'worklet'
          swipeReplyArmed.value = false
          pressScale.value = 1
        })
        .onUpdate((event) => {
          'worklet'
          const directionalTranslation = event.translationX * swipeDirection
          const dragDistance = Math.max(0, directionalTranslation - SWIPE_REPLY_ACTIVATION_DISTANCE)
          const displayDistance = getSwipeReplyDisplayDistance(dragDistance)
          const nextIsArmed = dragDistance >= SWIPE_REPLY_TRIGGER_DISTANCE

          if (nextIsArmed !== swipeReplyArmed.value) {
            swipeReplyArmed.value = nextIsArmed

            if (nextIsArmed) {
              scheduleOnRN(triggerSwipeReplyHaptic)
            }
          }

          swipeOffsetX.value = swipeDirection * displayDistance
        })
        .onEnd((event) => {
          'worklet'
          const directionalTranslation = event.translationX * swipeDirection
          const directionalVelocity = Math.max(0, event.velocityX * swipeDirection)
          const dragDistance = Math.max(0, directionalTranslation - SWIPE_REPLY_ACTIVATION_DISTANCE)
          const projectedDistance = dragDistance + directionalVelocity * SWIPE_REPLY_PROJECTION_TIME
          const shouldReply =
            dragDistance >= SWIPE_REPLY_TRIGGER_DISTANCE ||
            (dragDistance >= SWIPE_REPLY_MIN_FLING_DISTANCE &&
              projectedDistance >= SWIPE_REPLY_TRIGGER_DISTANCE)

          if (shouldReply) {
            if (!swipeReplyArmed.value) {
              scheduleOnRN(triggerSwipeReplyHaptic)
            }
            scheduleOnRN(handleSwipeReply)
          }
        })
        .onFinalize(() => {
          'worklet'
          swipeReplyArmed.value = false
          swipeOffsetX.value = withSpring(0, {
            mass: 0.55,
            damping: 25,
            stiffness: 320,
            overshootClamping: true,
          })
        })

      if (timestampRevealGesture && isOwn) {
        gesture.blocksExternalGesture(timestampRevealGesture)
      }

      return gesture
    }

    return {
      stackSwipeGesture: createSwipeGesture(isSwipeReplyEnabled && !isRecommendationMessage),
      bubbleSwipeGesture: createSwipeGesture(isSwipeReplyEnabled && isRecommendationMessage),
    }
  }, [
    handleSwipeReply,
    isRecommendationMessage,
    isOwn,
    isSwipeReplyEnabled,
    pressScale,
    swipeDirection,
    swipeOffsetX,
    swipeReplyArmed,
    timestampRevealGesture,
    triggerSwipeReplyHaptic,
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

            <GestureDetector gesture={stackSwipeGesture}>
              <Animated.View
                style={stackSwipeStyle}
                className={cn('max-w-[78%]', isOwn ? 'items-end' : 'items-start')}
              >
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
                      ) : replyPreviewMeta.type === 'reel' ? (
                        <View className="flex-row items-center">
                          {resolvedReplyPreviewThumbnailUri ? (
                            <View
                              style={{
                                width: 38,
                                height: 52,
                                borderRadius: 12,
                                overflow: 'hidden',
                                backgroundColor: '#111111',
                                marginRight: 10,
                              }}
                            >
                              <Image
                                source={{ uri: resolvedReplyPreviewThumbnailUri }}
                                resizeMode="cover"
                                style={{ width: 38, height: 52 }}
                              />
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
                                  backgroundColor: 'rgba(0,0,0,0.18)',
                                }}
                              >
                                <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
                              </View>
                            </View>
                          ) : (
                            <View
                              style={{
                                width: 38,
                                height: 52,
                                borderRadius: 12,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: '#111111',
                                marginRight: 10,
                                overflow: 'hidden',
                              }}
                            >
                              <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
                            </View>
                          )}

                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                fontSize: 12,
                                fontWeight: '700',
                                color: '#161616',
                                marginBottom: 2,
                              }}
                              numberOfLines={1}
                            >
                              {replyPreviewMeta.senderLabel}
                            </Text>
                            <Text
                              style={{ fontSize: 13, color: '#777777', lineHeight: 17 }}
                              numberOfLines={1}
                            >
                              {replyPreviewMeta.contentLabel}
                            </Text>
                          </View>
                        </View>
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
                          (replyPreviewMeta.type === 'image' ||
                            replyPreviewMeta.type === 'video') ? (
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

                <GestureDetector gesture={bubbleSwipeGesture}>
                  <View className="flex-row items-center">
                    <View ref={bubbleRef} collapsable={false} className="relative">
                      <Animated.View
                        style={[bubbleWrapStyle, bubbleVisibilityStyle, { flexShrink: 0 }]}
                      >
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

                          <Pressable
                            {...(isReel && !isRecalled && resolvedReelRouteId
                              ? {
                                  onPress: handleOpenReel,
                                }
                              : null)}
                            {...(!isRecalled
                              ? {
                                  onPressIn: handlePressIn,
                                  onPressOut: handlePressOut,
                                  onLongPress: handleLongPress,
                                  delayLongPress: CONTEXT_MENU_LONG_PRESS_DELAY_MS,
                                }
                              : null)}
                            className={bubbleClassName}
                          >
                            {isReel && !isRecalled ? (
                              <ChatReelCard
                                message={message}
                                variant="default"
                                width={reelCardWidth}
                                {...(resolvedReelRouteId ? { onPress: handleOpenReel } : {})}
                              />
                            ) : (
                              <MessageBubbleContent
                                message={message}
                                isOwn={isOwn}
                                variant="full"
                                handlers={{
                                  delayLongPress: MEDIA_CONTEXT_MENU_LONG_PRESS_DELAY_MS,
                                  onLongPress: handleLongPress,
                                  onPressIn: handlePressIn,
                                  onPressOut: handlePressOut,
                                  ...(onOpenMedia ? { onOpenMedia } : {}),
                                }}
                              />
                            )}
                          </Pressable>
                        </View>
                      </Animated.View>
                    </View>
                  </View>
                </GestureDetector>

                {hasRecommendationContent ? (
                  <View className={cn('mt-2', isOwn ? 'items-end' : 'items-start')}>
                    {hasRecommendedReels ? (
                      <GestureDetector gesture={recommendationRailGesture}>
                        <View
                          style={{
                            width: recommendationRailWidth,
                            height: recommendationCardHeight,
                          }}
                        >
                          <GestureHandlerScrollView
                            horizontal
                            bounces
                            directionalLockEnabled
                            nestedScrollEnabled
                            showsHorizontalScrollIndicator={false}
                            style={{
                              width: recommendationRailWidth,
                              height: recommendationCardHeight,
                            }}
                            contentContainerStyle={{
                              paddingRight: 4,
                              alignItems: 'flex-start',
                            }}
                          >
                            {recommendedReelMessages.map((recommendedMessage, index) => (
                              <View
                                key={recommendedMessage.id}
                                style={{
                                  marginRight:
                                    index === recommendedReelMessages.length - 1 ? 0 : 10,
                                }}
                              >
                                <ChatReelCard
                                  message={recommendedMessage}
                                  onPress={() =>
                                    handleOpenRecommendedReel(
                                      recommendedMessage.media?.reelId ?? recommendedMessage.id,
                                    )
                                  }
                                  variant="compact"
                                  width={recommendationCardWidth}
                                />
                              </View>
                            ))}
                          </GestureHandlerScrollView>
                        </View>
                      </GestureDetector>
                    ) : null}

                    {hasSuggestedQueries ? (
                      <View
                        className={cn(
                          'flex-row flex-wrap gap-2',
                          hasRecommendedReels ? 'mt-2' : undefined,
                          isOwn ? 'justify-end' : 'justify-start',
                        )}
                        style={{ maxWidth: recommendationRailWidth }}
                      >
                        {suggestedQueries.map((query) => (
                          <Pressable
                            key={`${message.id}:suggested-query:${query}`}
                            disabled={!onSendSuggestedQuery}
                            onPress={() => handleSendSuggestion(query)}
                            className="rounded-full border border-border-light bg-surface-card px-3 py-2"
                          >
                            <Text className="text-[12px] font-medium text-text-primary">
                              {query}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}

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
              </Animated.View>
            </GestureDetector>
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
    areMessageMetadataEqual(prevProps.message.metadata, nextProps.message.metadata) &&
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
    prevProps.isContextMenuActive === nextProps.isContextMenuActive &&
    prevProps.onSendSuggestedQuery === nextProps.onSendSuggestedQuery &&
    prevProps.onOpenMedia === nextProps.onOpenMedia &&
    isReplyEqual
  )
})
