import { MaterialIcons } from '@expo/vector-icons'
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list'
import { useQueryClient } from '@tanstack/react-query'
import { BlurView } from 'expo-blur'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import {
  KeyboardController,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller'
import Animated, {
  FadeIn,
  FadeOut,
  type SharedValue,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  type ChatMediaGalleryItem,
  type ChatMediaViewerOpenPayload,
} from '../../src/components/chat/ChatMediaViewer'
import {
  MessageBubble,
  type MessageBubbleContextMenuPayload,
} from '../../src/components/chat/MessageBubble'
import { MessageContextMenu } from '../../src/components/chat/MessageContextMenu'
import { MessageInput, type MessageInputHandle } from '../../src/components/chat/MessageInput'
import { queryKeys } from '../../src/constants/queryKeys'
import { useAnchoredMessages } from '../../src/hooks/useAnchoredMessages'
import { useChatMediaUploads } from '../../src/hooks/useChatMediaUploads'
import { useRecallMessage } from '../../src/hooks/useMessageActions'
import { trimMessagesCache, useMessages, useSendMessage } from '../../src/hooks/useMessages'
import {
  getMediaUploadStage,
  getResolvedMediaPosterUri,
  getResolvedMediaUri,
  isRemoteMediaUri,
} from '../../src/lib/chatMedia'
import { saveChatMediaToLibrary } from '../../src/lib/chatMediaSave'
import { getMessageIdentityKey } from '../../src/lib/messageIdentity'
import {
  buildMessageListState,
  DEFAULT_MESSAGE_LAYOUT,
  sortMessagesCanonicalNewestFirst,
  type MessageLayout,
} from '../../src/lib/messageListState'
import { formatLastSeenLabel } from '../../src/lib/presence'
import { useChatMediaViewer } from '../../src/providers/ChatMediaViewerProvider'
import { useSocket } from '../../src/providers/SocketProvider'
import { useAuthStore } from '../../src/stores/authStore'
import { useChatStore } from '../../src/stores/chatStore'
import { useChatVideoPlaybackStore } from '../../src/stores/chatVideoPlaybackStore'
import { useMessageListUiStore } from '../../src/stores/messageListUiStore'

import type { ChatParticipant, Conversation, Message } from '../../src/types/conversation.types'
import type { ImagePickerAsset } from 'expo-image-picker'

type ActiveContextMenuState = MessageBubbleContextMenuPayload

const EMPTY_MESSAGES: Message[] = []
const EMPTY_TYPERS: string[] = []
const EMPTY_READ_RECEIPT_PARTICIPANTS: ChatParticipant[] = []
const renderableOptimisticMessagesCache = new WeakMap<Message[], Message[]>()
const ANCHOR_MEDIA_VIEWER_WINDOW_RADIUS = 4
const TIMESTAMP_REVEAL_MAX_OFFSET = 64
const isPersistedServerMessageId = (messageId?: string | null) =>
  Boolean(messageId && !messageId.startsWith('temp-'))
const getOrderDebugSample = (messages: Message[], replyTargetId?: string | null) => {
  return messages.slice(0, 5).map((message, index) => ({
    index,
    id: message.id,
    createdAt: message.createdAt,
    clientMessageId: message.clientMessageId ?? null,
    isReplyTarget: (replyTargetId ? message.id === replyTargetId : false) || false,
  }))
}

const getRenderableOptimisticMessages = (messages?: Message[]) => {
  if (!messages?.length) {
    return EMPTY_MESSAGES
  }

  const cachedMessages = renderableOptimisticMessagesCache.get(messages)
  if (cachedMessages) {
    return cachedMessages
  }

  const hasConfirmedMessages = messages.some(
    (message) => message.status !== 'FAILED' && !message.id.startsWith('temp-'),
  )
  const nextMessages = hasConfirmedMessages
    ? messages.filter((message) => message.status === 'FAILED' || message.id.startsWith('temp-'))
    : messages

  renderableOptimisticMessagesCache.set(messages, nextMessages)
  return nextMessages
}

const backfillReplyPreviewSenderId = (message: Message, replyTo?: Message | null) => {
  if (
    !message.replyPreview ||
    typeof message.replyPreview === 'string' ||
    message.replyPreview.senderId ||
    !replyTo?.senderId
  ) {
    return message
  }

  return {
    ...message,
    replyPreview: {
      ...message.replyPreview,
      senderId: replyTo.senderId,
    },
  }
}

const LoadingBubble = ({
  align = 'left',
  widthClassName,
}: {
  align?: 'left' | 'right'
  widthClassName: string
}) => {
  const isRight = align === 'right'

  return (
    <View className={isRight ? 'items-end px-4 py-1.5' : 'flex-row items-end px-4 py-1.5'}>
      {!isRight ? <View className="mr-2.5 h-8 w-8 rounded-full bg-surface-input" /> : null}

      <View
        className={`h-11 rounded-[18px] bg-surface-input ${widthClassName} ${isRight ? '' : ''}`}
      />
    </View>
  )
}

const MessageListLoadingState = () => {
  return (
    <View className="pb-5 pt-4">
      <LoadingBubble widthClassName="w-[58%]" />
      <LoadingBubble align="right" widthClassName="w-[44%]" />
      <LoadingBubble widthClassName="w-[66%]" />
      <LoadingBubble align="right" widthClassName="w-[52%]" />
    </View>
  )
}

const Dot = ({ delay }: { delay: number }) => {
  const translateY = useSharedValue(0)

  useEffect(() => {
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(withTiming(-4, { duration: 300 }), withTiming(0, { duration: 300 })),
        -1,
        true,
      ),
    )
  }, [delay, translateY])

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))

  return <Animated.View style={style} className="w-1 h-1 bg-text-muted rounded-full mx-[1px]" />
}

const TypingIndicator = ({ displayName }: { displayName: string }) => {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(120)}
      className="mb-3 ml-4 mt-1 self-start"
    >
      <View className="flex-row items-end">
        <Text className="mr-1 text-xs2 text-text-muted">{displayName} is typing</Text>
        <View className="flex-row items-end pb-[2px]">
          <Dot delay={0} />
          <Dot delay={150} />
          <Dot delay={300} />
        </View>
      </View>
    </Animated.View>
  )
}

interface MessageRowProps {
  message: Message
  repliedMessage?: Message | null
  layout: MessageLayout
  isOwn: boolean
  primaryStatusLabel: string | null
  readReceiptParticipants: ChatParticipant[]
  timestampRevealGesture?: ReturnType<typeof Gesture.Pan>
  timestampRevealOffset: SharedValue<number>
  timestampRevealProgress: SharedValue<number>
  senderInfo?: ChatParticipant | Message['sender'] | null
  conversationId: string
  onToggleDetails: (messageId: string) => void
  onPressReplyPreview: (replyToId?: string) => void
  onReply: (message: Message) => void
  onOpenContextMenu: (payload: MessageBubbleContextMenuPayload) => void
  onOpenMedia: (payload: ChatMediaViewerOpenPayload) => void
}

const MessageRow = memo(
  function MessageRow({
    message,
    repliedMessage,
    layout,
    isOwn,
    primaryStatusLabel,
    readReceiptParticipants,
    timestampRevealGesture,
    timestampRevealOffset,
    timestampRevealProgress,
    senderInfo,
    conversationId,
    onToggleDetails,
    onPressReplyPreview,
    onReply,
    onOpenContextMenu,
    onOpenMedia,
  }: MessageRowProps) {
    const isExpanded = useMessageListUiStore(
      useCallback(
        (state) => state.conversations[conversationId]?.expandedMessageId === message.id,
        [conversationId, message.id],
      ),
    )
    const highlightToken = useMessageListUiStore(
      useCallback(
        (state) => state.conversations[conversationId]?.highlightTokens[message.id] ?? 0,
        [conversationId, message.id],
      ),
    )

    const handleToggleDetails = useCallback(() => {
      onToggleDetails(message.id)
    }, [message.id, onToggleDetails])

    const handleReply = useCallback(() => {
      onReply(message)
    }, [message, onReply])

    const handlePressReplyPreview = useCallback(() => {
      onPressReplyPreview(message.replyToId ?? message.reply_to_id)
    }, [message.replyToId, message.reply_to_id, onPressReplyPreview])

    return (
      <View>
        {layout.showDateSeparator ? (
          <View className="my-4 items-center">
            <Text className="text-xs2 text-text-muted">{layout.separatorLabel}</Text>
          </View>
        ) : null}
        <MessageBubble
          message={message}
          repliedMessage={repliedMessage ?? null}
          timeLabel={layout.timeLabel}
          primaryStatusLabel={primaryStatusLabel}
          readReceiptParticipants={readReceiptParticipants}
          timestampRevealGesture={timestampRevealGesture}
          timestampRevealOffset={timestampRevealOffset}
          timestampRevealProgress={timestampRevealProgress}
          isOwn={isOwn}
          showAvatar={layout.showAvatar}
          senderInfo={senderInfo ?? null}
          isGroupedTop={layout.isGroupedTop}
          isGroupedBottom={layout.isGroupedBottom}
          highlightToken={highlightToken}
          isExpanded={isExpanded}
          isContextMenuActive={false}
          onToggleDetails={handleToggleDetails}
          onPressReplyPreview={handlePressReplyPreview}
          onReply={handleReply}
          onOpenContextMenu={onOpenContextMenu}
          onOpenMedia={onOpenMedia}
          conversationId={conversationId}
        />
      </View>
    )
  },
  (prevProps, nextProps) =>
    prevProps.message === nextProps.message &&
    prevProps.repliedMessage === nextProps.repliedMessage &&
    prevProps.layout === nextProps.layout &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.primaryStatusLabel === nextProps.primaryStatusLabel &&
    prevProps.readReceiptParticipants === nextProps.readReceiptParticipants &&
    prevProps.timestampRevealGesture === nextProps.timestampRevealGesture &&
    prevProps.timestampRevealOffset === nextProps.timestampRevealOffset &&
    prevProps.timestampRevealProgress === nextProps.timestampRevealProgress &&
    prevProps.senderInfo === nextProps.senderInfo &&
    prevProps.conversationId === nextProps.conversationId &&
    prevProps.onToggleDetails === nextProps.onToggleDetails &&
    prevProps.onPressReplyPreview === nextProps.onPressReplyPreview &&
    prevProps.onReply === nextProps.onReply &&
    prevProps.onOpenContextMenu === nextProps.onOpenContextMenu &&
    prevProps.onOpenMedia === nextProps.onOpenMedia,
)

type TimelineMode = 'latest' | 'anchor'
type PendingOwnSendBottomScrollMode = 'none' | 'animated' | 'already-scrolled'

const getPrimaryStatusLabel = ({
  hasPlacedReadReceipt,
  message,
}: {
  hasPlacedReadReceipt: boolean
  message: Message
}) => {
  const normalizedStatus = String(message.status ?? '').toUpperCase()
  const isTempOptimistic =
    normalizedStatus !== 'FAILED' &&
    (Boolean(message.id?.startsWith('temp-')) || Boolean(message._id?.startsWith('temp-')))

  if (normalizedStatus === 'FAILED') return 'Failed'
  if (normalizedStatus === 'PENDING' || isTempOptimistic) return 'Sending...'
  if (normalizedStatus === 'READ') {
    return hasPlacedReadReceipt ? null : 'Delivered'
  }
  if (normalizedStatus === 'SENT') return 'Sent'
  if (normalizedStatus === 'DELIVERED') return 'Delivered'

  return null
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const conversationId = id as string
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuthStore()
  const localOptimistic = useChatStore(
    useCallback(
      (state) => getRenderableOptimisticMessages(state.optimisticMessages[conversationId]),
      [conversationId],
    ),
  )
  const activeTypers = useChatStore(
    useCallback((state) => state.typingUsers[conversationId] ?? EMPTY_TYPERS, [conversationId]),
  )
  const replyToMessage = useChatStore((state) => state.replyToMessage)
  const setReplyToMessage = useChatStore((state) => state.setReplyToMessage)
  const confirmMessage = useChatStore((state) => state.confirmMessage)
  const dequeueOfflineMessage = useChatStore((state) => state.dequeueOfflineMessage)
  const onlineUsers = useChatStore((state) => state.onlineUsers)
  const lastSeenByUserId = useChatStore((state) => state.lastSeenByUserId)
  const queuedMessageCount = useChatStore(
    useCallback(
      (state) =>
        state.offlineQueue.filter((message) => message.conversationId === conversationId).length,
      [conversationId],
    ),
  )
  const queryClient = useQueryClient()
  const cachedData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)
  const allConversations: Conversation[] = Array.isArray(cachedData)
    ? (cachedData as Conversation[])
    : (cachedData as { pages?: Conversation[][] })?.pages?.flat() || []
  const currentConversation = allConversations.find((c: Conversation) => c?.id === conversationId)

  const { socket, isConnected, requestPresence } = useSocket()

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMessages(conversationId)
  const {
    activeAnchorTargetId,
    anchorData,
    clearAnchor,
    isResolvingAnchor,
    loadAnchorNewer,
    loadAnchorOlder,
    resolveAnchorTarget,
  } = useAnchoredMessages({
    conversation: currentConversation ?? null,
    conversationId,
  })
  const { mutate: sendMessage } = useSendMessage(conversationId)
  const { enqueueMediaAssets } = useChatMediaUploads(conversationId)
  const { mutate: recallMessage } = useRecallMessage(conversationId)
  const toggleExpandedMessage = useMessageListUiStore((state) => state.toggleExpandedMessage)
  const bumpHighlightToken = useMessageListUiStore((state) => state.bumpHighlightToken)
  const resetConversationUi = useMessageListUiStore((state) => state.resetConversationUi)
  const clearConversationInlinePlayback = useChatVideoPlaybackStore(
    (state) => state.clearConversation,
  )
  const { closeViewer: closeMediaViewer, openViewer: openMediaViewer } = useChatMediaViewer()
  const [activeContextMenu, setActiveContextMenu] = useState<ActiveContextMenuState | null>(null)
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('latest')

  const listRef = useRef<FlashListRef<Message>>(null)
  const layoutByIdRef = useRef<Map<string, MessageLayout>>(new Map())
  const indexByIdRef = useRef<Map<string, number>>(new Map())
  const messageInputRef = useRef<MessageInputHandle>(null)
  const pendingOwnSendBottomScrollRef = useRef<PendingOwnSendBottomScrollMode>('none')
  const isScrollButtonVisible = useSharedValue(false)
  const isNearBottomRef = useRef(true)
  const timestampRevealOffset = useSharedValue(0)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [messageViewportHeight, setMessageViewportHeight] = useState(0)
  const preservedKeyboardOffset = useSharedValue(0)

  const { height: keyboardHeight } = useReanimatedKeyboardAnimation()
  const timestampRevealProgress = useDerivedValue(() =>
    Math.min(Math.abs(timestampRevealOffset.value) / TIMESTAMP_REVEAL_MAX_OFFSET, 1),
  )

  const keyboardWrapperStyle = useAnimatedStyle(() => {
    const liveKeyboardOffset = Math.abs(keyboardHeight.value)
    const frozenOffset = preservedKeyboardOffset.value

    return {
      transform: [{ translateY: -Math.max(liveKeyboardOffset, frozenOffset) }],
    }
  })

  const listSpacerStyle = useAnimatedStyle(() => {
    const ACTIVE_PADDING = 8
    const bottomInset = Math.max(insets.bottom, 8)

    const dynamicPadding = interpolate(
      Math.abs(keyboardHeight.value),
      [0, 40],
      [bottomInset, ACTIVE_PADDING],
      Extrapolation.CLAMP,
    )

    return { height: dynamicPadding + 50 }
  })
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = Math.max(0, event.nativeEvent.contentOffset.y)
      const nextIsNearBottom = offsetY <= 50

      if (nextIsNearBottom !== isNearBottomRef.current) {
        isNearBottomRef.current = nextIsNearBottom
        setIsNearBottom((current) => (current === nextIsNearBottom ? current : nextIsNearBottom))
      }

      const shouldShowScrollButton = offsetY > 200
      if (shouldShowScrollButton !== isScrollButtonVisible.value) {
        isScrollButtonVisible.value = shouldShowScrollButton
      }
    },
    [isScrollButtonVisible],
  )

  const maybeLoadAnchorNewerAtBottom = useCallback(() => {
    if (!anchorBottomLoadArmedRef.current) {
      return
    }

    anchorBottomLoadArmedRef.current = false

    if (
      timelineMode !== 'anchor' ||
      pendingAnchorScrollTargetIdRef.current ||
      !isNearBottomRef.current ||
      !anchorData?.hasNewer ||
      anchorData.isFetchingNewer
    ) {
      return
    }

    void loadAnchorNewer('bottom')
  }, [anchorData?.hasNewer, anchorData?.isFetchingNewer, loadAnchorNewer, timelineMode])

  const handleScrollBeginDrag = useCallback(() => {
    if (timelineMode === 'anchor') {
      anchorBottomLoadArmedRef.current = true
    }
  }, [timelineMode])

  const handleScrollEndDrag = useCallback(() => {
    maybeLoadAnchorNewerAtBottom()
  }, [maybeLoadAnchorNewerAtBottom])

  const handleMomentumScrollEnd = useCallback(() => {
    maybeLoadAnchorNewerAtBottom()
  }, [maybeLoadAnchorNewerAtBottom])

  const scrollButtonStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(isScrollButtonVisible.value ? 1 : 0, { duration: 200 }),
      transform: [{ scale: withTiming(isScrollButtonVisible.value ? 1 : 0.8, { duration: 200 }) }],
    }
  })
  const timestampRevealGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-14, 9999])
        .failOffsetY([-8, 8])
        .maxPointers(1)
        .onUpdate((event) => {
          'worklet'
          const clampedOffset = Math.max(
            -TIMESTAMP_REVEAL_MAX_OFFSET,
            Math.min(0, event.translationX),
          )
          timestampRevealOffset.value = clampedOffset
        })
        .onEnd(() => {
          'worklet'
          timestampRevealOffset.value = withSpring(0, {
            mass: 0.9,
            damping: 18,
            stiffness: 220,
          })
        })
        .onFinalize(() => {
          'worklet'
          timestampRevealOffset.value = withSpring(0, {
            mass: 0.9,
            damping: 18,
            stiffness: 220,
          })
        }),
    [timestampRevealOffset],
  )
  const typingTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const replyHighlightTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const replyJumpSettleTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const isComposerFocusedRef = useRef(false)
  const shouldRestoreComposerFocusRef = useRef(false)
  const pendingAnchorScrollTargetIdRef = useRef<string | null>(null)
  const pendingReturnToLatestRef = useRef(false)
  const anchorBottomLoadArmedRef = useRef(false)

  const serverMessages = useMemo(() => {
    return (data?.pages.flat() as Message[]) || EMPTY_MESSAGES
  }, [data])
  const activeServerMessages = useMemo(
    () =>
      sortMessagesCanonicalNewestFirst(
        timelineMode === 'anchor' ? (anchorData?.messages ?? EMPTY_MESSAGES) : serverMessages,
      ),
    [anchorData?.messages, serverMessages, timelineMode],
  )

  const [transitionDone, setTransitionDone] = useState(false)
  const [presenceTick, setPresenceTick] = useState(() => Date.now())

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setTransitionDone(true)
    })
    return () => handle.cancel()
  }, [])

  const { orderedMessages, layoutById, messageById, indexById } = useMemo(
    () =>
      buildMessageListState({
        localOptimistic: timelineMode === 'latest' ? localOptimistic : EMPTY_MESSAGES,
        previousLayoutById: layoutByIdRef.current,
        serverMessages: activeServerMessages,
      }),
    [activeServerMessages, localOptimistic, timelineMode],
  )

  layoutByIdRef.current = layoutById
  indexByIdRef.current = indexById

  useEffect(() => {
    if (!__DEV__) {
      return
    }

    const replyTargetId = pendingAnchorScrollTargetIdRef.current ?? activeAnchorTargetId ?? null
    const latestSourceSample = getOrderDebugSample(
      sortMessagesCanonicalNewestFirst(serverMessages),
      replyTargetId,
    )
    const anchorSourceSample = getOrderDebugSample(
      sortMessagesCanonicalNewestFirst(anchorData?.messages ?? EMPTY_MESSAGES),
      replyTargetId,
    )
    const flashListSample = getOrderDebugSample(orderedMessages, replyTargetId)

    // eslint-disable-next-line no-console
    console.log('[ReplyJumpOrder]', {
      anchorTargetId: activeAnchorTargetId,
      mode: timelineMode,
      anchorSourceSample,
      latestSourceSample,
      flashListSample,
    })
  }, [activeAnchorTargetId, anchorData?.messages, orderedMessages, serverMessages, timelineMode])

  const mediaGalleryItems = useMemo<ChatMediaGalleryItem[]>(() => {
    return [...orderedMessages].reverse().flatMap((message) => {
      if (
        (message.type !== 'image' && message.type !== 'video') ||
        message.isRecalled === true ||
        message.is_recalled === true
      ) {
        return []
      }

      const uri = getResolvedMediaUri(message.media)
      if (!uri) {
        return []
      }

      const mediaStage = getMediaUploadStage(message.media)
      const posterUri = getResolvedMediaPosterUri(message.media)
      return [
        {
          id: getMessageIdentityKey(message) ?? message.id,
          canSave:
            (mediaStage === null || mediaStage === 'ready') &&
            message.status !== 'PENDING' &&
            isRemoteMediaUri(uri),
          message,
          type: message.type,
          uri,
          ...(posterUri ? { posterUri } : {}),
        },
      ]
    })
  }, [orderedMessages])

  useEffect(() => {
    if (serverMessages.length === 0 || localOptimistic.length === 0) return

    const timeoutId = setTimeout(() => {
      const optimisticIds = new Set(localOptimistic.map((message) => message.id))

      const messagesToConfirm: Message[] = []

      serverMessages.forEach((message) => {
        if (message.clientMessageId && optimisticIds.has(message.clientMessageId)) {
          messagesToConfirm.push(message)
        }
      })

      if (messagesToConfirm.length > 0) {
        messagesToConfirm.forEach((msg) => {
          if (!msg.clientMessageId) {
            return
          }

          confirmMessage(msg.clientMessageId, msg)
          dequeueOfflineMessage(msg.clientMessageId)
        })
      }
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [confirmMessage, dequeueOfflineMessage, localOptimistic, serverMessages])

  const newestMessage = orderedMessages[0]
  const newestMessageId = newestMessage?.id
  const newestSenderId = newestMessage?.senderId
  const prevNewestMessageId = useRef(newestMessageId)

  useEffect(() => {
    isNearBottomRef.current = true
    setIsNearBottom(true)
    isScrollButtonVisible.value = false
  }, [conversationId, isScrollButtonVisible])

  const isOtherUserTyping = activeTypers.some((typerId) => typerId !== user?.id)
  const shouldShowTypingIndicator = isOtherUserTyping && isNearBottom
  const isInitialMessagesLoading =
    (timelineMode === 'latest' ? isLoading : isResolvingAnchor) && orderedMessages.length === 0
  const getReplyScrollViewPosition = useCallback(() => {
    const DEFAULT_VIEW_POSITION = 0.72
    const state = KeyboardController.state()
    const activeKeyboardHeight = Math.abs(state.height || 0)

    if (!isComposerFocusedRef.current || activeKeyboardHeight <= 0 || messageViewportHeight <= 0) {
      return DEFAULT_VIEW_POSITION
    }

    const visibleViewportRatio = Math.max(
      0.58,
      Math.min(1, (messageViewportHeight - activeKeyboardHeight) / messageViewportHeight),
    )

    return Math.max(0.42, DEFAULT_VIEW_POSITION * visibleViewportRatio)
  }, [messageViewportHeight])

  const prepareContextMenuKeyboardPreservation = useCallback(() => {
    const state = KeyboardController.state()
    const activeKeyboardHeight = Math.abs(state.height || 0)
    const isVisible = KeyboardController.isVisible()

    const shouldPreserveKeyboardSpace =
      isComposerFocusedRef.current && (isVisible || activeKeyboardHeight > 0)

    if (!shouldPreserveKeyboardSpace || activeKeyboardHeight <= 0) {
      shouldRestoreComposerFocusRef.current = false
      preservedKeyboardOffset.value = 0
      return false
    }

    shouldRestoreComposerFocusRef.current = true
    preservedKeyboardOffset.value = activeKeyboardHeight

    return true
  }, [preservedKeyboardOffset])

  const releasePreservedKeyboardOffset = useCallback(() => {
    preservedKeyboardOffset.value = withTiming(0, { duration: 160 })
  }, [preservedKeyboardOffset])

  const handleContextMenuClose = useCallback(() => {
    if (!shouldRestoreComposerFocusRef.current) {
      releasePreservedKeyboardOffset()
      return
    }

    requestAnimationFrame(() => {
      messageInputRef.current?.focus()

      setTimeout(() => {
        shouldRestoreComposerFocusRef.current = false
        releasePreservedKeyboardOffset()
      }, 280)
    })
  }, [releasePreservedKeyboardOffset])

  const handleOpenContextMenu = useCallback(
    (payload: MessageBubbleContextMenuPayload) => {
      const shouldDismissKeyboard = prepareContextMenuKeyboardPreservation()

      setActiveContextMenu(payload)

      if (shouldDismissKeyboard) {
        requestAnimationFrame(() => {
          messageInputRef.current?.blur()
          void KeyboardController.dismiss()
        })
      }
    },
    [prepareContextMenuKeyboardPreservation],
  )

  let displayName = 'Unknown'
  let avatarUrl: string | undefined = undefined
  let otherUserId: string | undefined = undefined

  if (currentConversation) {
    if (!currentConversation.isGroup) {
      const otherUser = currentConversation.participants?.find(
        (p: ChatParticipant) => p.id !== user?.id,
      )
      if (otherUser) {
        displayName = otherUser.name || otherUser.email || 'Unknown'
        avatarUrl = otherUser.picture
        otherUserId = otherUser.id
      }
    } else {
      displayName = currentConversation.name || 'Group Chat'
      avatarUrl = currentConversation.picture
    }
  }

  const handleSaveMedia = useCallback(async (item: ChatMediaGalleryItem) => {
    if (!item.canSave) {
      return
    }

    try {
      await saveChatMediaToLibrary({
        type: item.type,
        uri: item.uri,
        ...(item.message.media?.mimeType ? { mimeType: item.message.media.mimeType } : {}),
      })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Saved', `${item.type === 'video' ? 'Video' : 'Photo'} saved to your library.`)
    } catch (error) {
      Alert.alert(
        'Unable to save media',
        error instanceof Error ? error.message : 'Please try again.',
      )
    }
  }, [])

  const handleOpenMedia = useCallback(
    (payload: ChatMediaViewerOpenPayload) => {
      setActiveContextMenu(null)

      const sourceIndex = mediaGalleryItems.findIndex((item) => item.id === payload.messageId)
      if (sourceIndex < 0) {
        return
      }

      const viewerItems =
        timelineMode === 'anchor'
          ? mediaGalleryItems.slice(
              Math.max(0, sourceIndex - ANCHOR_MEDIA_VIEWER_WINDOW_RADIUS),
              Math.min(
                mediaGalleryItems.length,
                sourceIndex + ANCHOR_MEDIA_VIEWER_WINDOW_RADIUS + 1,
              ),
            )
          : mediaGalleryItems

      openMediaViewer({
        autoplayVideo: payload.autoplayVideo,
        conversationTitle: displayName,
        items: viewerItems,
        messageId: payload.messageId,
        onSave: handleSaveMedia,
        ...(payload.sourceRef ? { sourceRef: payload.sourceRef } : {}),
      })
    },
    [displayName, handleSaveMedia, mediaGalleryItems, openMediaViewer, timelineMode],
  )

  const closeActiveContextMenu = useCallback(() => {
    setActiveContextMenu(null)
    handleContextMenuClose()
  }, [handleContextMenuClose])

  const clearConversationUnread = useCallback(
    (conversationId: string) => {
      queryClient.setQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
        (oldData) => {
          if (!Array.isArray(oldData)) {
            return oldData
          }

          let hasChanges = false
          const nextConversations = oldData.map((conversation) => {
            if (conversation.id !== conversationId || !conversation.unreadCount) {
              return conversation
            }

            hasChanges = true
            return { ...conversation, unreadCount: 0 }
          })

          return hasChanges ? nextConversations : oldData
        },
      )
    },
    [queryClient],
  )

  useEffect(() => {
    if (!transitionDone) return

    const timer = setTimeout(() => {
      if (socket?.connected) {
        socket.emit('join_conversation', conversationId)
        socket.emit('mark_seen', conversationId)
        clearConversationUnread(conversationId)
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [clearConversationUnread, conversationId, socket, socket?.connected, transitionDone])

  const scrollToBottom = useCallback((animated = true) => {
    listRef.current?.scrollToOffset({ offset: 0, animated })
  }, [])

  const handleComposerFocusChange = useCallback(
    (focused: boolean) => {
      isComposerFocusedRef.current = focused

      if (focused) {
        if (!shouldRestoreComposerFocusRef.current) {
          preservedKeyboardOffset.value = 0
        }
        return
      }

      if (!shouldRestoreComposerFocusRef.current) {
        preservedKeyboardOffset.value = withTiming(0, { duration: 120 })
      }
    },
    [preservedKeyboardOffset],
  )

  const dismissComposer = useCallback(() => {
    shouldRestoreComposerFocusRef.current = false
    preservedKeyboardOffset.value = withTiming(0, { duration: 120 })
    messageInputRef.current?.blur()
    void KeyboardController.dismiss()
  }, [preservedKeyboardOffset])

  const loadOlderMessages = useCallback(() => {
    if (!hasNextPage || isInitialMessagesLoading || isFetchingNextPage) {
      return
    }

    void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isInitialMessagesLoading])

  const returnToLatestTimeline = useCallback(
    async (shouldScrollToBottom = true) => {
      anchorBottomLoadArmedRef.current = false
      pendingAnchorScrollTargetIdRef.current = null
      pendingReturnToLatestRef.current = shouldScrollToBottom
      setTimelineMode('latest')
      await clearAnchor()
    },
    [clearAnchor],
  )

  useEffect(() => {
    setActiveContextMenu(null)
    closeMediaViewer()
    clearConversationInlinePlayback(conversationId)
    shouldRestoreComposerFocusRef.current = false
    preservedKeyboardOffset.value = 0
    timestampRevealOffset.value = 0
    anchorBottomLoadArmedRef.current = false
    pendingAnchorScrollTargetIdRef.current = null
    pendingReturnToLatestRef.current = false
    setTimelineMode('latest')
    void clearAnchor()

    return () => {
      closeMediaViewer()
      clearConversationInlinePlayback(conversationId)
      resetConversationUi(conversationId)
    }
  }, [
    closeMediaViewer,
    clearConversationInlinePlayback,
    conversationId,
    clearAnchor,
    preservedKeyboardOffset,
    resetConversationUi,
    timestampRevealOffset,
  ])

  useEffect(() => {
    if (timelineMode !== 'latest') {
      prevNewestMessageId.current = newestMessageId
      return
    }

    if (newestMessageId && newestMessageId !== prevNewestMessageId.current) {
      const isInitialAutoScroll = prevNewestMessageId.current === undefined
      const isMyMessage = newestSenderId === user?.id

      const shouldAutoScroll = isMyMessage || isNearBottomRef.current || isInitialAutoScroll

      if (shouldAutoScroll) {
        if (pendingReturnToLatestRef.current) {
          // Returning to latest owns this scroll; do not issue a competing command.
        } else if (isMyMessage && pendingOwnSendBottomScrollRef.current !== 'none') {
          const nextScrollMode = pendingOwnSendBottomScrollRef.current
          pendingOwnSendBottomScrollRef.current = 'none'
          if (nextScrollMode === 'animated') {
            scrollToBottom()
          }
        } else {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              scrollToBottom()
            })
          })
        }
      }

      if (socket?.connected && shouldAutoScroll) {
        socket.emit('mark_seen', conversationId)
        clearConversationUnread(conversationId)
      }
    }
    prevNewestMessageId.current = newestMessageId
  }, [
    clearConversationUnread,
    conversationId,
    newestMessageId,
    newestSenderId,
    scrollToBottom,
    socket,
    timelineMode,
    user?.id,
  ])

  const participantsMap = useMemo(() => {
    const map = new Map<string, ChatParticipant>()
    currentConversation?.participants?.forEach((p: ChatParticipant) => {
      map.set(p.id, p)
    })
    return map
  }, [currentConversation?.participants])
  const otherParticipant = useMemo(() => {
    if (currentConversation?.isGroup) {
      return null
    }

    return (
      currentConversation?.participants?.find((participant) => participant.id !== user?.id) ?? null
    )
  }, [currentConversation?.isGroup, currentConversation?.participants, user?.id])
  const {
    latestOutgoingIdentityKey: _latestOutgoingIdentityKey,
    primaryStatusByIdentityKey,
    readReceiptsByIdentityKey,
  } = useMemo(() => {
    const primaryStatusMap = new Map<string, string>()
    const readReceiptMap = new Map<string, ChatParticipant[]>()

    if (!user?.id) {
      return {
        latestOutgoingIdentityKey: null,
        primaryStatusByIdentityKey: primaryStatusMap,
        readReceiptsByIdentityKey: readReceiptMap,
      }
    }

    const latestOutgoingMessage =
      orderedMessages.find((message) => message.senderId === user.id) ?? null
    const nextLatestOutgoingIdentityKey = getMessageIdentityKey(latestOutgoingMessage)

    let readReceiptIdentityKey: string | null = null
    let isReceiptAnchoredToOtherParticipantActivity = false

    if (!currentConversation?.isGroup && otherParticipant) {
      const newestReadOutgoingMessage =
        orderedMessages.find((message) => {
          if (message.senderId !== user.id) {
            return false
          }

          const messageIdentityKey = getMessageIdentityKey(message)
          if (!messageIdentityKey || !Array.isArray(message.readBy)) {
            return false
          }

          return message.readBy.some((entry) => entry.userId === otherParticipant.id)
        }) ?? null
      const newestOtherParticipantMessage =
        orderedMessages.find((message) => message.senderId === otherParticipant.id) ?? null
      const newestReadOutgoingIndex = newestReadOutgoingMessage
        ? orderedMessages.indexOf(newestReadOutgoingMessage)
        : -1
      const newestOtherParticipantIndex = newestOtherParticipantMessage
        ? orderedMessages.indexOf(newestOtherParticipantMessage)
        : -1
      const shouldAnchorToOtherParticipantActivity =
        newestOtherParticipantIndex >= 0 &&
        (newestReadOutgoingIndex === -1 || newestOtherParticipantIndex < newestReadOutgoingIndex)
      const receiptAnchorMessage = shouldAnchorToOtherParticipantActivity
        ? newestOtherParticipantMessage
        : newestReadOutgoingMessage
      isReceiptAnchoredToOtherParticipantActivity =
        Boolean(receiptAnchorMessage) && receiptAnchorMessage?.senderId === otherParticipant.id

      readReceiptIdentityKey = getMessageIdentityKey(receiptAnchorMessage)
      if (readReceiptIdentityKey) {
        readReceiptMap.set(readReceiptIdentityKey, [otherParticipant])
      }
    }

    if (
      latestOutgoingMessage &&
      nextLatestOutgoingIdentityKey &&
      !isReceiptAnchoredToOtherParticipantActivity
    ) {
      const primaryStatusLabel = getPrimaryStatusLabel({
        hasPlacedReadReceipt: nextLatestOutgoingIdentityKey === readReceiptIdentityKey,
        message: latestOutgoingMessage,
      })
      if (primaryStatusLabel) {
        primaryStatusMap.set(nextLatestOutgoingIdentityKey, primaryStatusLabel)
      }
    }

    return {
      latestOutgoingIdentityKey: nextLatestOutgoingIdentityKey,
      primaryStatusByIdentityKey: primaryStatusMap,
      readReceiptsByIdentityKey: readReceiptMap,
    }
  }, [currentConversation?.isGroup, orderedMessages, otherParticipant, user?.id])

  const isOnline = otherUserId ? onlineUsers.has(otherUserId) : false
  const lastSeenAt = otherUserId ? (lastSeenByUserId[otherUserId] ?? null) : null
  const presenceLabel = !isConnected
    ? 'Reconnecting…'
    : isOnline
      ? 'Online'
      : formatLastSeenLabel(lastSeenAt, presenceTick)

  useEffect(() => {
    if (!transitionDone) return
    if (!isConnected || !otherUserId || currentConversation?.isGroup) return

    requestPresence([otherUserId], { conversationId })
  }, [
    conversationId,
    currentConversation?.isGroup,
    isConnected,
    otherUserId,
    requestPresence,
    transitionDone,
  ])

  useEffect(() => {
    if (isOnline || !lastSeenAt) {
      return
    }

    const intervalId = setInterval(() => {
      setPresenceTick(Date.now())
    }, 60 * 1000)

    return () => clearInterval(intervalId)
  }, [isOnline, lastSeenAt])

  const handleSendMedia = useCallback(
    async (assets: ImagePickerAsset[]) => {
      isNearBottomRef.current = true
      setIsNearBottom(true)
      isScrollButtonVisible.value = false
      pendingOwnSendBottomScrollRef.current = 'already-scrolled'

      if (timelineMode === 'anchor') {
        void returnToLatestTimeline()
      } else {
        requestAnimationFrame(() => {
          scrollToBottom()
        })
      }

      await enqueueMediaAssets(assets)
    },
    [
      enqueueMediaAssets,
      isScrollButtonVisible,
      returnToLatestTimeline,
      scrollToBottom,
      timelineMode,
    ],
  )

  const handleTyping = useCallback(
    (text: string) => {
      if (!socket?.connected) return

      if (!text.trim()) {
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current)
          typingTimeoutRef.current = null
        }
        socket.emit('typing_stop', conversationId)
        return
      }

      socket.emit('typing_start', conversationId)

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }

      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing_stop', conversationId)
        typingTimeoutRef.current = null
      }, 2000)
    },
    [socket, conversationId],
  )

  const handleReply = useCallback(
    (message: Message) => {
      setReplyToMessage(message)
      timestampRevealOffset.value = withSpring(0, {
        mass: 0.9,
        damping: 18,
        stiffness: 220,
      })

      requestAnimationFrame(() => {
        messageInputRef.current?.focus()
      })
    },
    [setReplyToMessage, timestampRevealOffset],
  )

  const handleCancelReply = useCallback(() => {
    setReplyToMessage(null)
  }, [setReplyToMessage])

  const handleSendText = useCallback(
    (text: string, replyTo?: Message | null) => {
      isNearBottomRef.current = true
      setIsNearBottom(true)
      isScrollButtonVisible.value = false

      sendMessage({
        content: text,
        ...(replyTo?.id ? { replyToId: replyTo.id } : {}),
        ...(replyTo ? { replyToMessage: replyTo } : {}),
      })

      if (timelineMode === 'anchor') {
        pendingOwnSendBottomScrollRef.current = 'animated'
        void returnToLatestTimeline(false)
      } else {
        pendingOwnSendBottomScrollRef.current = 'animated'
      }

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }
      socket?.emit('typing_stop', conversationId)
    },
    [
      conversationId,
      isScrollButtonVisible,
      returnToLatestTimeline,
      sendMessage,
      socket,
      timelineMode,
    ],
  )

  const handleRecall = useCallback(
    (messageId: string) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      recallMessage(messageId)
    },
    [recallMessage],
  )

  const handleToggleDetails = useCallback(
    (messageId: string) => {
      toggleExpandedMessage(conversationId, messageId)
    },
    [conversationId, toggleExpandedMessage],
  )

  const clearReplyJumpSettleTimeout = useCallback(() => {
    if (replyJumpSettleTimeoutRef.current) {
      clearTimeout(replyJumpSettleTimeoutRef.current)
      replyJumpSettleTimeoutRef.current = null
    }
  }, [])

  const scheduleMessageHighlight = useCallback(
    (messageId: string) => {
      if (replyHighlightTimeoutRef.current) {
        clearTimeout(replyHighlightTimeoutRef.current)
        replyHighlightTimeoutRef.current = null
      }

      replyHighlightTimeoutRef.current = setTimeout(() => {
        bumpHighlightToken(conversationId, messageId)
      }, 320)
    },
    [bumpHighlightToken, conversationId],
  )

  const settlePendingReplyJump = useCallback(
    (messageId: string) => {
      clearReplyJumpSettleTimeout()

      replyJumpSettleTimeoutRef.current = setTimeout(() => {
        if (pendingAnchorScrollTargetIdRef.current === messageId) {
          pendingAnchorScrollTargetIdRef.current = null
        }
        replyJumpSettleTimeoutRef.current = null
      }, 450)
    },
    [clearReplyJumpSettleTimeout],
  )

  const scrollToMessageById = useCallback(
    (messageId: string) => {
      const index = indexByIdRef.current.get(messageId)
      if (index === undefined) {
        return false
      }

      const performScroll = (retryCount = 0) => {
        const scrollPromise = listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: getReplyScrollViewPosition(),
        })

        if (!scrollPromise) {
          return
        }

        void scrollPromise
          .then(() => {
            scheduleMessageHighlight(messageId)

            if (pendingAnchorScrollTargetIdRef.current === messageId) {
              settlePendingReplyJump(messageId)
            }
          })
          .catch(() => {
            if (retryCount > 0) {
              if (!isPersistedServerMessageId(messageId)) {
                return
              }

              pendingReturnToLatestRef.current = false
              pendingAnchorScrollTargetIdRef.current = messageId
              anchorBottomLoadArmedRef.current = false

              void resolveAnchorTarget(messageId).then((started) => {
                if (!started) {
                  if (pendingAnchorScrollTargetIdRef.current === messageId) {
                    pendingAnchorScrollTargetIdRef.current = null
                  }
                  return
                }

                setTimelineMode('anchor')
              })
              return
            }

            clearReplyJumpSettleTimeout()

            const fallbackLayout = listRef.current?.getLayout(Math.max(0, index - 1))
            if (fallbackLayout) {
              void listRef.current?.scrollToOffset({
                offset: Math.max(0, fallbackLayout.y),
                animated: false,
              })
            }

            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (indexByIdRef.current.has(messageId)) {
                  performScroll(retryCount + 1)
                }
              })
            })
          })
      }

      performScroll()
      return true
    },
    [
      clearReplyJumpSettleTimeout,
      getReplyScrollViewPosition,
      resolveAnchorTarget,
      scheduleMessageHighlight,
      settlePendingReplyJump,
    ],
  )

  const runReplyScroll = useCallback(
    (messageId: string) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToMessageById(messageId)
        })
      })
    },
    [scrollToMessageById],
  )

  const handleScrollToMessage = useCallback(
    async (replyToId?: string) => {
      if (!replyToId) return

      if (scrollToMessageById(replyToId)) {
        return
      }

      if (pendingAnchorScrollTargetIdRef.current === replyToId && isResolvingAnchor) {
        return
      }

      if (
        timelineMode === 'anchor' &&
        activeAnchorTargetId === replyToId &&
        (isResolvingAnchor || Boolean(anchorData))
      ) {
        pendingReturnToLatestRef.current = false
        pendingAnchorScrollTargetIdRef.current = replyToId
        return
      }

      if (!isPersistedServerMessageId(replyToId)) {
        return
      }

      pendingReturnToLatestRef.current = false
      pendingAnchorScrollTargetIdRef.current = replyToId
      anchorBottomLoadArmedRef.current = false

      const started = await resolveAnchorTarget(replyToId)
      if (!started) {
        pendingAnchorScrollTargetIdRef.current = null
        return
      }

      setTimelineMode('anchor')
    },
    [
      activeAnchorTargetId,
      anchorData,
      isResolvingAnchor,
      resolveAnchorTarget,
      scrollToMessageById,
      timelineMode,
    ],
  )

  const handleMessageViewportLayout = useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      const nextHeight = event.nativeEvent.layout.height

      setMessageViewportHeight((currentHeight) => {
        return Math.abs(currentHeight - nextHeight) < 1 ? currentHeight : nextHeight
      })
    },
    [],
  )

  const activeContextMenuMessageId = activeContextMenu?.message.id ?? null
  const activeContextMenuMessage = activeContextMenu?.message ?? null
  const activeContextMenuAnchor = activeContextMenu?.anchor ?? null
  const activeContextMenuConversationId = activeContextMenu?.conversationId
  const activeContextMenuFallbackGroupedTop = activeContextMenu?.isGroupedTop ?? false
  const activeContextMenuFallbackGroupedBottom = activeContextMenu?.isGroupedBottom ?? false

  const activeContextMenuData = useMemo(() => {
    if (!activeContextMenuMessageId || !activeContextMenuMessage || !activeContextMenuAnchor) {
      return null
    }

    const currentMessage = messageById.get(activeContextMenuMessageId) ?? activeContextMenuMessage
    const currentLayout = layoutById.get(currentMessage.id)

    return {
      message: currentMessage,
      anchor: activeContextMenuAnchor,
      conversationId: activeContextMenuConversationId,
      isOwn: currentMessage.senderId === user?.id,
      isGroupedTop: currentLayout?.isGroupedTop ?? activeContextMenuFallbackGroupedTop,
      isGroupedBottom: currentLayout?.isGroupedBottom ?? activeContextMenuFallbackGroupedBottom,
    }
  }, [
    activeContextMenuAnchor,
    activeContextMenuConversationId,
    activeContextMenuFallbackGroupedBottom,
    activeContextMenuFallbackGroupedTop,
    activeContextMenuMessage,
    activeContextMenuMessageId,
    layoutById,
    messageById,
    user?.id,
  ])

  useEffect(() => {
    if (
      timelineMode === 'anchor' &&
      activeAnchorTargetId &&
      !isResolvingAnchor &&
      !anchorData &&
      !pendingReturnToLatestRef.current
    ) {
      pendingAnchorScrollTargetIdRef.current = null
      setTimelineMode('latest')
      void clearAnchor()
    }
  }, [activeAnchorTargetId, anchorData, clearAnchor, isResolvingAnchor, timelineMode])

  useEffect(() => {
    const pendingAnchorTargetId = pendingAnchorScrollTargetIdRef.current

    if (
      timelineMode === 'anchor' &&
      pendingAnchorTargetId &&
      indexByIdRef.current.has(pendingAnchorTargetId)
    ) {
      runReplyScroll(pendingAnchorTargetId)
      return
    }

    if (timelineMode === 'latest' && pendingReturnToLatestRef.current) {
      pendingReturnToLatestRef.current = false
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom()
        })
      })
    }
  }, [orderedMessages, runReplyScroll, scrollToBottom, timelineMode])

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      if (socket?.connected) socket.emit('typing_stop', conversationId)
      if (replyHighlightTimeoutRef.current) clearTimeout(replyHighlightTimeoutRef.current)
      clearReplyJumpSettleTimeout()

      const messagesQueryKey = queryKeys.conversations.messages(conversationId)
      void queryClient.cancelQueries({ queryKey: messagesQueryKey, exact: true })
      trimMessagesCache(queryClient, conversationId)
    }
  }, [clearReplyJumpSettleTimeout, conversationId, queryClient, socket])

  const currentOlderLoader =
    timelineMode === 'anchor' ? () => void loadAnchorOlder('edge') : loadOlderMessages
  const currentIsFetchingOlder =
    timelineMode === 'anchor' ? (anchorData?.isFetchingOlder ?? false) : isFetchingNextPage
  const renderListHeader = useCallback(() => {
    return (
      <View>
        {shouldShowTypingIndicator ? <TypingIndicator displayName={displayName} /> : null}
        <Animated.View style={listSpacerStyle} />
      </View>
    )
  }, [displayName, listSpacerStyle, shouldShowTypingIndicator])
  const listExtraData = useMemo(
    () => ({
      layoutById,
      primaryStatusByIdentityKey,
      readReceiptsByIdentityKey,
    }),
    [layoutById, primaryStatusByIdentityKey, readReceiptsByIdentityKey],
  )

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Message>) => {
      if (!item) return null

      const layout = layoutByIdRef.current.get(item.id) ?? DEFAULT_MESSAGE_LAYOUT
      const isOwn = item.senderId === user?.id
      const sender = item.sender ?? participantsMap.get(item.senderId)
      const messageIdentityKey = getMessageIdentityKey(item)
      const replyToId = item.replyToId ?? item.reply_to_id
      const repliedMessage = replyToId ? (messageById.get(replyToId) ?? null) : null
      const resolvedReplyTarget = repliedMessage ?? item.replyTo ?? null
      const normalizedMessage = backfillReplyPreviewSenderId(item, resolvedReplyTarget)
      const primaryStatusLabel = messageIdentityKey
        ? (primaryStatusByIdentityKey.get(messageIdentityKey) ?? null)
        : null
      const readReceiptParticipants = messageIdentityKey
        ? (readReceiptsByIdentityKey.get(messageIdentityKey) ?? EMPTY_READ_RECEIPT_PARTICIPANTS)
        : EMPTY_READ_RECEIPT_PARTICIPANTS

      return (
        <MessageRow
          message={normalizedMessage}
          repliedMessage={repliedMessage}
          layout={layout}
          isOwn={isOwn}
          primaryStatusLabel={primaryStatusLabel}
          readReceiptParticipants={readReceiptParticipants}
          timestampRevealGesture={timestampRevealGesture}
          timestampRevealOffset={timestampRevealOffset}
          timestampRevealProgress={timestampRevealProgress}
          senderInfo={sender ?? null}
          conversationId={conversationId}
          onToggleDetails={handleToggleDetails}
          onPressReplyPreview={handleScrollToMessage}
          onReply={handleReply}
          onOpenContextMenu={handleOpenContextMenu}
          onOpenMedia={handleOpenMedia}
        />
      )
    },
    [
      conversationId,
      handleReply,
      handleScrollToMessage,
      handleToggleDetails,
      handleOpenContextMenu,
      handleOpenMedia,
      messageById,
      participantsMap,
      primaryStatusByIdentityKey,
      readReceiptsByIdentityKey,
      timestampRevealGesture,
      timestampRevealOffset,
      timestampRevealProgress,
      user?.id,
    ],
  )

  const getItemType = useCallback((item: Message) => {
    if (item.isRecalled === true || item.is_recalled === true) {
      return 'recalled'
    }

    return item.type || 'text'
  }, [])
  const keyExtractor = useCallback((item: Message, index: number) => {
    return getMessageIdentityKey(item) ?? item.id ?? item._id ?? `fallback-${index}`
  }, [])

  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  const loadingIndicatorStyle = useAnimatedStyle(() => {
    const isVisible = currentIsFetchingOlder && !isInitialMessagesLoading
    return {
      transform: [
        {
          translateY: withSpring(isVisible ? 24 : -40, {
            damping: 22,
            stiffness: 260,
            mass: 0.8,
          }),
        },
        {
          scale: withSpring(isVisible ? 1 : 0.8, {
            damping: 22,
            stiffness: 260,
          }),
        },
      ],
      opacity: withTiming(isVisible ? 1 : 0, { duration: 150 }),
    }
  })

  const handleScrollAffordancePress = useCallback(() => {
    if (timelineMode === 'anchor') {
      void returnToLatestTimeline()
      return
    }

    scrollToBottom()
  }, [returnToLatestTimeline, scrollToBottom, timelineMode])

  return (
    <View className="flex-1 bg-bg-primary" style={{ paddingTop: insets.top }}>
      <View className="flex-1 z-10">
        <View className="border-b border-border-light bg-bg-primary px-4 pb-3 pt-2 z-10">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={() => {
                dismissComposer()

                requestAnimationFrame(() => {
                  router.back()
                })
              }}
              className="h-11 w-11 items-center justify-center"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialIcons name="chevron-left" size={24} color="#161616" />
            </TouchableOpacity>

            <View className="ml-1.5 relative">
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} className="h-11 w-11 rounded-full" />
              ) : (
                <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-input">
                  <Text className="text-sm2 font-medium text-text-primary">
                    {displayName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}

              {!currentConversation?.isGroup && isOnline ? (
                <View className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-bg-primary bg-status-online" />
              ) : null}
            </View>

            <View className="ml-3 flex-1 pr-4">
              <Text className="font-semibold text-md text-text-primary" numberOfLines={1}>
                {displayName}
              </Text>
              {!currentConversation?.isGroup ? (
                <Text className="mt-0.5 text-xs2 text-text-muted" numberOfLines={1}>
                  {presenceLabel}
                </Text>
              ) : (
                <Text className="mt-0.5 text-xs2 text-text-muted">Team room</Text>
              )}
            </View>
          </View>

          {!isConnected ? (
            <View className="mt-3 rounded-[20px] border border-border-light bg-surface-accent px-4 py-3">
              <Text className="text-xs2 uppercase tracking-[1.1px] text-brand">
                Connection status
              </Text>
              <Text className="mt-1 text-sm2 leading-5 text-text-primary">
                {queuedMessageCount > 0
                  ? `${queuedMessageCount} message${queuedMessageCount > 1 ? 's are' : ' is'} waiting to send when chat reconnects.`
                  : 'Chat is reconnecting. New messages will wait and send automatically.'}
              </Text>
            </View>
          ) : null}
        </View>

        <View
          style={{ flex: 1, overflow: 'hidden', backgroundColor: 'transparent' }}
          onLayout={handleMessageViewportLayout}
        >
          <Animated.View style={[{ flex: 1 }, keyboardWrapperStyle]}>
            <View className="flex-1">
              <GestureDetector gesture={timestampRevealGesture}>
                <View className="flex-1">
                  {currentIsFetchingOlder && !isInitialMessagesLoading ? (
                    <Animated.View
                      style={[
                        loadingIndicatorStyle,
                        {
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          zIndex: 20,
                          alignItems: 'center',
                        },
                      ]}
                      pointerEvents="none"
                    >
                      {Platform.OS === 'android' ? (
                        <View
                          className="flex-row items-center justify-center rounded-full bg-surface-card px-3.5 py-2 border border-border-light"
                          style={{ elevation: 4 }}
                        >
                          <ActivityIndicator size="small" color="#FF6B2C" />
                        </View>
                      ) : (
                        <View
                          style={{
                            borderRadius: 24,
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.12,
                            shadowRadius: 12,
                          }}
                        >
                          <View style={{ borderRadius: 24, overflow: 'hidden' }}>
                            <BlurView
                              intensity={65}
                              tint={isDark ? 'dark' : 'light'}
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                paddingHorizontal: 14,
                                paddingVertical: 8,
                                backgroundColor: isDark
                                  ? 'rgba(30, 30, 30, 0.4)'
                                  : 'rgba(255, 255, 255, 0.4)',
                              }}
                            >
                              <ActivityIndicator size="small" color="#FF6B2C" />
                            </BlurView>
                          </View>
                        </View>
                      )}
                    </Animated.View>
                  ) : null}
                  <FlashList
                    ref={listRef}
                    inverted
                    data={orderedMessages}
                    extraData={listExtraData}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    getItemType={getItemType}
                    contentContainerStyle={{
                      paddingBottom: 20,
                    }}
                    onEndReached={currentOlderLoader}
                    onEndReachedThreshold={0.2}
                    onScroll={handleScroll}
                    onScrollBeginDrag={handleScrollBeginDrag}
                    onScrollEndDrag={handleScrollEndDrag}
                    onMomentumScrollEnd={handleMomentumScrollEnd}
                    scrollEventThrottle={16}
                    keyboardDismissMode="none"
                    keyboardShouldPersistTaps="handled"
                    ListHeaderComponent={renderListHeader}
                    ListEmptyComponent={
                      isInitialMessagesLoading ? <MessageListLoadingState /> : null
                    }
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={false}
                  />
                  <Animated.View
                    pointerEvents="box-none"
                    style={[
                      scrollButtonStyle,
                      {
                        position: 'absolute',
                        right: 16,
                        bottom: 120,
                        zIndex: 40,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      className="h-11 w-11 items-center justify-center rounded-full bg-surface-card border border-border-light"
                      onPress={handleScrollAffordancePress}
                      activeOpacity={0.8}
                      style={{
                        borderCurve: 'continuous',
                        boxShadow: '0 14px 26px rgba(93, 74, 53, 0.12)',
                      }}
                    >
                      <MaterialIcons name="keyboard-arrow-down" size={24} color="#161514" />
                    </TouchableOpacity>
                  </Animated.View>
                </View>
              </GestureDetector>
              <Animated.View
                pointerEvents="box-none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 30,
                }}
              >
                <MessageInput
                  ref={messageInputRef}
                  onSend={handleSendText}
                  onSendMedia={handleSendMedia}
                  onChangeText={handleTyping}
                  onFocusChange={handleComposerFocusChange}
                  replyTo={replyToMessage}
                  onCancelReply={handleCancelReply}
                />
              </Animated.View>
            </View>
          </Animated.View>
        </View>

        <MessageContextMenu
          visible={Boolean(activeContextMenuData)}
          message={activeContextMenuData?.message ?? null}
          isOwn={activeContextMenuData?.isOwn ?? false}
          isGroupedTop={activeContextMenuData?.isGroupedTop ?? false}
          isGroupedBottom={activeContextMenuData?.isGroupedBottom ?? false}
          anchor={activeContextMenuData?.anchor ?? null}
          onClose={closeActiveContextMenu}
          onReply={
            activeContextMenuData ? () => handleReply(activeContextMenuData.message) : undefined
          }
          onRecall={
            activeContextMenuData ? () => handleRecall(activeContextMenuData.message.id) : undefined
          }
          onSave={
            activeContextMenuData
              ? () => {
                  const item = mediaGalleryItems.find(
                    (galleryItem) =>
                      galleryItem.id === getMessageIdentityKey(activeContextMenuData.message),
                  )
                  if (item) {
                    void handleSaveMedia(item)
                  }
                }
              : undefined
          }
          conversationId={activeContextMenuData?.conversationId}
        />
      </View>
    </View>
  )
}
