import { MaterialIcons } from '@expo/vector-icons'
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list'
import { BlurView } from 'expo-blur'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  withSpring,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ConversationHeader } from '../../src/components/chat/conversation/ConversationHeader'
import {
  ConversationMessageListLoadingState,
  ConversationTypingIndicator,
} from '../../src/components/chat/conversation/ConversationLoadingState'
import { ConversationMessageRow } from '../../src/components/chat/conversation/ConversationMessageRow'
import { MessageContextMenu } from '../../src/components/chat/MessageContextMenu'
import { MessageInput } from '../../src/components/chat/MessageInput'
import { useConversationContextMenuRuntime } from '../../src/hooks/conversation/useConversationContextMenuRuntime'
import { useConversationKeyboardRuntime } from '../../src/hooks/conversation/useConversationKeyboardRuntime'
import { useConversationMediaViewerRuntime } from '../../src/hooks/conversation/useConversationMediaViewerRuntime'
import { useConversationMetadata } from '../../src/hooks/conversation/useConversationMetadata'
import { useConversationPresence } from '../../src/hooks/conversation/useConversationPresence'
import { useConversationReceiptModel } from '../../src/hooks/conversation/useConversationReceiptModel'
import { useConversationSessionRuntime } from '../../src/hooks/conversation/useConversationSessionRuntime'
import { useAnchoredMessages } from '../../src/hooks/useAnchoredMessages'
import { useChatMediaUploads } from '../../src/hooks/useChatMediaUploads'
import { useRecallMessage } from '../../src/hooks/useMessageActions'
import { useMessages, useSendMessage } from '../../src/hooks/useMessages'
import {
  backfillReplyPreviewFromResolvedTarget,
  EMPTY_CONVERSATION_MESSAGES as EMPTY_MESSAGES,
  getClientMessageIdentity,
  getConversationMessageItemType,
  getConversationMessageKey,
  getOrderDebugSample,
  getRenderableOptimisticMessages,
  isPersistedServerMessageId,
} from '../../src/lib/conversation/conversationMessagePolicies'
import {
  EMPTY_READ_RECEIPT_PARTICIPANTS,
  getGroupTypingLabel,
} from '../../src/lib/conversation/conversationPresentationPolicies'
import {
  getMessageIdentityKey,
  mergeMessageCollectionByIdentity,
} from '../../src/lib/messageIdentity'
import {
  buildMessageListState,
  DEFAULT_MESSAGE_LAYOUT,
  sortMessagesCanonicalNewestFirst,
  type MessageLayout,
} from '../../src/lib/messageListState'
import { useCall } from '../../src/providers/CallProvider'
import { useSocket } from '../../src/providers/SocketProvider'
import { useAuthStore } from '../../src/stores/authStore'
import { useChatStore } from '../../src/stores/chatStore'
import { useMessageListUiStore } from '../../src/stores/messageListUiStore'

import type { OptimisticSortAnchor } from '../../src/stores/chatStore'
import type { Message } from '../../src/types/conversation.types'
import type { ImagePickerAsset } from 'expo-image-picker'

const EMPTY_TYPERS: string[] = []
const EMPTY_OPTIMISTIC_SORT_ANCHORS: Record<string, OptimisticSortAnchor> = {}
const TIMESTAMP_REVEAL_MAX_OFFSET = 64

type TimelineMode = 'latest' | 'anchor'
type PendingOwnSendBottomScrollMode = 'none' | 'animated'
type PendingOwnMediaBatchScrollTransaction = {
  batchId: string
  clientMessageIds: Set<string>
  pendingConfirmSuppressClientMessageIds: Set<string>
  initialScrollConsumed: boolean
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const conversationId = id as string
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuthStore()
  // VIDEO_CALL_1TO1_CONVERSATION_PATCH
  const { startVideoCall, startVoiceCall } = useCall()
  const localOptimistic = useChatStore(
    useCallback(
      (state) => getRenderableOptimisticMessages(state.optimisticMessages[conversationId]),
      [conversationId],
    ),
  )
  const optimisticSortAnchorsByMessageId = useChatStore(
    useCallback(
      (state) => state.optimisticSortAnchors[conversationId] ?? EMPTY_OPTIMISTIC_SORT_ANCHORS,
      [conversationId],
    ),
  )
  const activeTypers = useChatStore(
    useCallback((state) => state.typingUsers[conversationId] ?? EMPTY_TYPERS, [conversationId]),
  )
  const isConversationRevoked = useChatStore(
    useCallback((state) => state.revokedConversationIds.has(conversationId), [conversationId]),
  )
  const replyToMessage = useChatStore((state) => state.replyToMessage)
  const setReplyToMessage = useChatStore((state) => state.setReplyToMessage)
  const confirmMessage = useChatStore((state) => state.confirmMessage)
  const dequeueOfflineMessage = useChatStore((state) => state.dequeueOfflineMessage)
  const queuedMessageCount = useChatStore(
    useCallback(
      (state) =>
        state.offlineQueue.filter((message) => message.conversationId === conversationId).length,
      [conversationId],
    ),
  )
  const {
    avatarUrl,
    currentConversation,
    displayName,
    isGroup,
    otherParticipant,
    otherUserId,
    participantsMap,
  } = useConversationMetadata({
    conversationId,
    currentUserId: user?.id ?? null,
  })

  const { socket, isConnected, requestPresence } = useSocket()

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMessages(conversationId)
  const hasLoadedLatestMessagePages = Boolean(data?.pages.length)
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
  const bumpHighlightToken = useMessageListUiStore((state) => state.bumpHighlightToken)
  const resetConversationUi = useMessageListUiStore((state) => state.resetConversationUi)
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('latest')

  const listRef = useRef<FlashListRef<Message>>(null)
  const layoutByIdRef = useRef<Map<string, MessageLayout>>(new Map())
  const indexByIdRef = useRef<Map<string, number>>(new Map())
  const pendingOwnSendBottomScrollRef = useRef<PendingOwnSendBottomScrollMode>('none')
  const pendingOwnMediaBatchScrollTransactionsRef = useRef<
    Map<string, PendingOwnMediaBatchScrollTransaction>
  >(new Map())
  const pendingOwnMediaBatchByClientMessageIdRef = useRef<Map<string, string>>(new Map())
  const isScrollButtonVisible = useSharedValue(false)
  const isNearBottomRef = useRef(true)
  const timestampRevealOffset = useSharedValue(0)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const {
    dismissComposer,
    dismissKeyboardForContextMenu,
    getReplyScrollViewPosition,
    handleComposerFocusChange,
    handleMessageViewportLayout,
    keyboardWrapperStyle,
    listSpacerStyle,
    messageInputRef,
    prepareContextMenuKeyboardPreservation,
    resetConversationKeyboard,
    restoreComposerAfterContextMenu,
  } = useConversationKeyboardRuntime({ bottomInset: insets.bottom })
  const timestampRevealProgress = useDerivedValue(() =>
    Math.min(Math.abs(timestampRevealOffset.value) / TIMESTAMP_REVEAL_MAX_OFFSET, 1),
  )
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
        // Reply gestures activate first; timestamp reveal requires a more deliberate pull.
        .activeOffsetX([-20, 9999])
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
        .onFinalize(() => {
          'worklet'
          timestampRevealOffset.value = withSpring(0, {
            mass: 0.65,
            damping: 27,
            stiffness: 310,
            overshootClamping: true,
          })
        }),
    [timestampRevealOffset],
  )
  const typingTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const replyHighlightTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const replyJumpSettleTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const pendingAnchorScrollTargetIdRef = useRef<string | null>(null)
  const pendingReturnToLatestRef = useRef(false)
  const anchorBottomLoadArmedRef = useRef(false)

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      if (socket?.connected) socket.emit('typing_stop', conversationId)
      if (replyHighlightTimeoutRef.current) clearTimeout(replyHighlightTimeoutRef.current)
      if (replyJumpSettleTimeoutRef.current) {
        clearTimeout(replyJumpSettleTimeoutRef.current)
        replyJumpSettleTimeoutRef.current = null
      }
    }
  }, [conversationId, socket])

  const serverMessages = useMemo(() => {
    const flattenedMessages = (data?.pages.flat() as Message[] | undefined) ?? EMPTY_MESSAGES
    return mergeMessageCollectionByIdentity(flattenedMessages)
  }, [data])
  const activeServerMessages = useMemo(
    () =>
      sortMessagesCanonicalNewestFirst(
        timelineMode === 'anchor' ? (anchorData?.messages ?? EMPTY_MESSAGES) : serverMessages,
      ),
    [anchorData?.messages, serverMessages, timelineMode],
  )

  const { orderedMessages, layoutById, messageById, indexById } = useMemo(
    () =>
      buildMessageListState({
        localOptimistic: timelineMode === 'latest' ? localOptimistic : EMPTY_MESSAGES,
        optimisticSortAnchorsByMessageId,
        previousLayoutById: layoutByIdRef.current,
        serverMessages: activeServerMessages,
      }),
    [activeServerMessages, localOptimistic, optimisticSortAnchorsByMessageId, timelineMode],
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

  useEffect(() => {
    if (serverMessages.length === 0 || localOptimistic.length === 0) return

    const timeoutId = setTimeout(() => {
      const optimisticIds = new Set(localOptimistic.map((message) => message.id))

      const messagesToConfirm: Message[] = []

      serverMessages.forEach((message) => {
        if (
          message.clientMessageId &&
          optimisticIds.has(message.clientMessageId) &&
          message.type === 'text' &&
          !message.media
        ) {
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
  const newestClientMessageId = getClientMessageIdentity(newestMessage)
  const newestSenderId = newestMessage?.senderId
  const latestSeenFrontierMessageId = useMemo(() => {
    const frontierMessage =
      orderedMessages.find((message) => isPersistedServerMessageId(message.id)) ?? null

    return frontierMessage?.id ?? null
  }, [orderedMessages])
  const prevNewestMessageId = useRef(newestMessageId)
  const { transitionDone } = useConversationSessionRuntime({
    conversation: currentConversation ?? null,
    conversationId,
    currentUser: user ?? null,
    hasLoadedLatestMessagePages,
    isConnected,
    isNearBottom,
    latestSeenFrontierMessageId,
    socket,
    timelineMode,
  })

  useEffect(() => {
    isNearBottomRef.current = true
    setIsNearBottom(true)
    isScrollButtonVisible.value = false
  }, [conversationId, isScrollButtonVisible])

  const isOtherUserTyping = activeTypers.some((typerId) => typerId !== user?.id)
  const shouldShowTypingIndicator = isOtherUserTyping && isNearBottom
  const isInitialMessagesLoading =
    (timelineMode === 'latest' ? isLoading : isResolvingAnchor) && orderedMessages.length === 0
  const {
    activeContextMenuData,
    activeContextMenuMessageId,
    clearActiveContextMenu,
    closeActiveContextMenu,
    handleOpenContextMenu,
  } = useConversationContextMenuRuntime({
    currentUserId: user?.id ?? null,
    dismissKeyboardForContextMenu,
    layoutById,
    messageById,
    prepareContextMenuKeyboardPreservation,
    restoreComposerAfterContextMenu,
  })

  const groupTypingLabel = useMemo(() => {
    return getGroupTypingLabel({
      activeTypers,
      conversation: currentConversation ?? null,
      currentUserId: user?.id ?? null,
    })
  }, [activeTypers, currentConversation, user?.id])

  const handleStartVoiceCall = useCallback(() => {
    if (!otherUserId || currentConversation?.isGroup) {
      return
    }

    void startVoiceCall({
      conversationId,
      peerUserId: otherUserId,
      ...(displayName ? { peerName: displayName } : {}),
      ...(avatarUrl ? { peerAvatarUrl: avatarUrl } : {}),
    })
  }, [
    avatarUrl,
    conversationId,
    currentConversation?.isGroup,
    displayName,
    otherUserId,
    startVoiceCall,
  ])

  const handleStartVideoCall = useCallback(() => {
    if (!otherUserId || currentConversation?.isGroup) return
    void startVideoCall({
      conversationId,
      peerUserId: otherUserId,
      ...(displayName ? { peerName: displayName } : {}),
      ...(avatarUrl ? { peerAvatarUrl: avatarUrl } : {}),
    })
  }, [
    avatarUrl,
    conversationId,
    currentConversation?.isGroup,
    displayName,
    otherUserId,
    startVideoCall,
  ])

  const { closeMediaViewer, handleOpenMedia, handleSaveMedia, mediaGalleryItems } =
    useConversationMediaViewerRuntime({
      clearActiveContextMenu,
      conversationId,
      conversationTitle: displayName,
      orderedMessages,
      timelineMode,
    })

  const registerPendingOwnMediaBatchScrollTransaction = useCallback(
    (batch: { batchId: string; clientMessageIds: string[] }) => {
      if (batch.clientMessageIds.length === 0) {
        return
      }

      pendingOwnMediaBatchScrollTransactionsRef.current.set(batch.batchId, {
        batchId: batch.batchId,
        clientMessageIds: new Set(batch.clientMessageIds),
        pendingConfirmSuppressClientMessageIds: new Set(batch.clientMessageIds),
        initialScrollConsumed: false,
      })

      batch.clientMessageIds.forEach((clientMessageId) => {
        pendingOwnMediaBatchByClientMessageIdRef.current.set(clientMessageId, batch.batchId)
      })
    },
    [],
  )

  const clearPendingOwnMediaBatchScrollTransaction = useCallback((batchId: string) => {
    const transactions = pendingOwnMediaBatchScrollTransactionsRef.current
    const transaction = transactions.get(batchId)

    if (!transaction) {
      return
    }

    transactions.delete(batchId)
    transaction.clientMessageIds.forEach((clientMessageId) => {
      if (pendingOwnMediaBatchByClientMessageIdRef.current.get(clientMessageId) === batchId) {
        pendingOwnMediaBatchByClientMessageIdRef.current.delete(clientMessageId)
      }
    })
  }, [])

  useEffect(() => {
    pendingOwnSendBottomScrollRef.current = 'none'
    pendingOwnMediaBatchScrollTransactionsRef.current.clear()
    pendingOwnMediaBatchByClientMessageIdRef.current.clear()
  }, [conversationId])

  const scrollToBottom = useCallback((animated = true) => {
    listRef.current?.scrollToOffset({ offset: 0, animated })
  }, [])

  const scrollToBottomForNewestMessage = useCallback(() => {
    if (Platform.OS === 'android') {
      requestAnimationFrame(() => {
        scrollToBottom()
      })
      return
    }

    scrollToBottom()
  }, [scrollToBottom])

  const handleOpenGroupInfo = useCallback(() => {
    if (!currentConversation?.isGroup) return

    dismissComposer()
    router.push({
      pathname: '/conversation/[id]/info',
      params: { id: conversationId },
    })
  }, [conversationId, currentConversation?.isGroup, dismissComposer, router])

  useEffect(() => {
    if (!isConversationRevoked) {
      return
    }

    dismissComposer()
    closeMediaViewer()
    requestAnimationFrame(() => {
      router.replace('/')
    })
  }, [closeMediaViewer, dismissComposer, isConversationRevoked, router])

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
    resetConversationKeyboard()
    timestampRevealOffset.value = 0
    anchorBottomLoadArmedRef.current = false
    pendingAnchorScrollTargetIdRef.current = null
    pendingReturnToLatestRef.current = false
    setTimelineMode('latest')
    void clearAnchor()

    return () => {
      resetConversationUi(conversationId)
    }
  }, [
    conversationId,
    clearAnchor,
    resetConversationKeyboard,
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
      const pendingOwnMediaBatchId =
        newestClientMessageId !== null
          ? pendingOwnMediaBatchByClientMessageIdRef.current.get(newestClientMessageId)
          : undefined
      const pendingOwnMediaBatchScrollTransaction = pendingOwnMediaBatchId
        ? pendingOwnMediaBatchScrollTransactionsRef.current.get(pendingOwnMediaBatchId)
        : undefined
      const newestBelongsToPendingOwnMediaBatch =
        newestClientMessageId !== null &&
        Boolean(pendingOwnMediaBatchScrollTransaction?.clientMessageIds.has(newestClientMessageId))
      const shouldSuppressPendingOwnMediaConfirmScroll =
        isMyMessage &&
        newestClientMessageId !== null &&
        Boolean(
          pendingOwnMediaBatchScrollTransaction?.initialScrollConsumed &&
          pendingOwnMediaBatchScrollTransaction.pendingConfirmSuppressClientMessageIds.has(
            newestClientMessageId,
          ),
        )

      const shouldAutoScroll = isMyMessage || isNearBottomRef.current || isInitialAutoScroll

      if (shouldAutoScroll) {
        if (pendingReturnToLatestRef.current) {
          // Returning to latest owns this scroll; do not issue a competing command.
        } else if (isMyMessage && pendingOwnSendBottomScrollRef.current !== 'none') {
          const nextScrollMode = pendingOwnSendBottomScrollRef.current
          pendingOwnSendBottomScrollRef.current = 'none'
          if (nextScrollMode === 'animated') {
            scrollToBottomForNewestMessage()
          }
          if (newestBelongsToPendingOwnMediaBatch && pendingOwnMediaBatchScrollTransaction) {
            pendingOwnMediaBatchScrollTransaction.initialScrollConsumed = true
          }
        } else if (
          shouldSuppressPendingOwnMediaConfirmScroll &&
          newestClientMessageId &&
          pendingOwnMediaBatchId &&
          pendingOwnMediaBatchScrollTransaction
        ) {
          pendingOwnMediaBatchScrollTransaction.pendingConfirmSuppressClientMessageIds.delete(
            newestClientMessageId,
          )

          if (
            pendingOwnMediaBatchScrollTransaction.pendingConfirmSuppressClientMessageIds.size === 0
          ) {
            clearPendingOwnMediaBatchScrollTransaction(pendingOwnMediaBatchId)
          }
        } else {
          scrollToBottomForNewestMessage()
        }
      }
    }
    prevNewestMessageId.current = newestMessageId
  }, [
    newestClientMessageId,
    newestMessageId,
    newestSenderId,
    scrollToBottomForNewestMessage,
    timelineMode,
    user?.id,
    clearPendingOwnMediaBatchScrollTransaction,
  ])

  const { primaryStatusByIdentityKey, readReceiptsByIdentityKey } = useConversationReceiptModel({
    conversation: currentConversation ?? null,
    currentUserId: user?.id ?? null,
    orderedMessages,
    otherParticipant,
  })
  const { isOnline, presenceLabel } = useConversationPresence({
    conversationId,
    isConnected,
    isGroup,
    otherUserId: otherUserId ?? null,
    requestPresence,
    transitionDone,
  })

  const handleSendMedia = useCallback(
    async (assets: ImagePickerAsset[]) => {
      isNearBottomRef.current = true
      setIsNearBottom(true)
      isScrollButtonVisible.value = false

      if (timelineMode === 'anchor') {
        pendingOwnSendBottomScrollRef.current = 'animated'
        void returnToLatestTimeline(false)
      } else {
        pendingOwnSendBottomScrollRef.current = 'animated'
      }

      const queuedMediaBatch = await enqueueMediaAssets(assets, {
        onWillCommitBatch: registerPendingOwnMediaBatchScrollTransaction,
      })

      if (!queuedMediaBatch) {
        pendingOwnSendBottomScrollRef.current = 'none'
      }
    },
    [
      enqueueMediaAssets,
      isScrollButtonVisible,
      registerPendingOwnMediaBatchScrollTransaction,
      returnToLatestTimeline,
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
        mass: 0.65,
        damping: 27,
        stiffness: 310,
        overshootClamping: true,
      })

      requestAnimationFrame(() => {
        messageInputRef.current?.focus()
      })
    },
    [messageInputRef, setReplyToMessage, timestampRevealOffset],
  )

  const handleCancelReply = useCallback(() => {
    setReplyToMessage(null)
  }, [setReplyToMessage])

  const handleSendText = useCallback(
    (text: string, replyTo?: Message | null) => {
      isNearBottomRef.current = true
      setIsNearBottom(true)
      isScrollButtonVisible.value = false

      if (timelineMode === 'anchor') {
        pendingOwnSendBottomScrollRef.current = 'animated'
        void returnToLatestTimeline(false)
      } else {
        pendingOwnSendBottomScrollRef.current = 'animated'
      }

      sendMessage({
        content: text,
        ...(replyTo?.id ? { replyToId: replyTo.id } : {}),
        ...(replyTo ? { replyToMessage: replyTo } : {}),
      })

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

  const handleSendSuggestedQuery = useCallback(
    (query: string) => {
      handleSendText(query)
    },
    [handleSendText],
  )

  const handleRecall = useCallback(
    (messageId: string) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      recallMessage(messageId)
    },
    [recallMessage],
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
      const pendingOwnMediaBatchId =
        newestClientMessageId !== null
          ? pendingOwnMediaBatchByClientMessageIdRef.current.get(newestClientMessageId)
          : undefined
      const pendingOwnMediaBatchScrollTransaction = pendingOwnMediaBatchId
        ? pendingOwnMediaBatchScrollTransactionsRef.current.get(pendingOwnMediaBatchId)
        : undefined

      if (newestClientMessageId && pendingOwnMediaBatchScrollTransaction) {
        pendingOwnMediaBatchScrollTransaction.initialScrollConsumed = true
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom()
        })
      })
    }
  }, [newestClientMessageId, orderedMessages, runReplyScroll, scrollToBottom, timelineMode])

  const currentOlderLoader =
    timelineMode === 'anchor' ? () => void loadAnchorOlder('edge') : loadOlderMessages
  const currentIsFetchingOlder =
    timelineMode === 'anchor' ? (anchorData?.isFetchingOlder ?? false) : isFetchingNextPage
  const renderListHeader = useCallback(() => {
    return (
      <View>
        {shouldShowTypingIndicator ? (
          <ConversationTypingIndicator label={groupTypingLabel ?? `${displayName} is typing`} />
        ) : null}
        <Animated.View style={listSpacerStyle} />
      </View>
    )
  }, [displayName, groupTypingLabel, listSpacerStyle, shouldShowTypingIndicator])
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
      const normalizedMessage = backfillReplyPreviewFromResolvedTarget({
        conversation: currentConversation ?? null,
        currentUserId: user?.id ?? null,
        message: item,
        replyTo: resolvedReplyTarget,
      })
      const primaryStatusLabel = messageIdentityKey
        ? (primaryStatusByIdentityKey.get(messageIdentityKey) ?? null)
        : null
      const readReceiptParticipants = messageIdentityKey
        ? (readReceiptsByIdentityKey.get(messageIdentityKey) ?? EMPTY_READ_RECEIPT_PARTICIPANTS)
        : EMPTY_READ_RECEIPT_PARTICIPANTS

      return (
        <ConversationMessageRow
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
          isContextMenuActive={messageIdentityKey === activeContextMenuMessageId}
          onPressReplyPreview={handleScrollToMessage}
          onReply={handleReply}
          onSendSuggestedQuery={handleSendSuggestedQuery}
          onOpenContextMenu={handleOpenContextMenu}
          onOpenMedia={handleOpenMedia}
        />
      )
    },
    [
      activeContextMenuMessageId,
      conversationId,
      currentConversation,
      handleReply,
      handleSendSuggestedQuery,
      handleScrollToMessage,
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

  const getItemType = useCallback((item: Message) => getConversationMessageItemType(item), [])
  const keyExtractor = useCallback(
    (item: Message, index: number) => getConversationMessageKey(item, index),
    [],
  )

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

  const handleBack = useCallback(() => {
    dismissComposer()
    requestAnimationFrame(() => {
      router.back()
    })
  }, [dismissComposer, router])

  if (isConversationRevoked) {
    return <View className="flex-1 bg-bg-primary" />
  }

  return (
    <View className="flex-1 bg-bg-primary" style={{ paddingTop: insets.top }}>
      <View className="flex-1 z-10">
        <ConversationHeader
          {...(avatarUrl ? { avatarUrl } : {})}
          displayName={displayName}
          groupTypingLabel={groupTypingLabel}
          isConnected={isConnected}
          isGroup={isGroup}
          isOnline={isOnline}
          participantCount={currentConversation?.participantIds.length ?? 0}
          presenceLabel={presenceLabel}
          queuedMessageCount={queuedMessageCount}
          showCallActions={!currentConversation?.isGroup && Boolean(otherUserId)}
          onBack={handleBack}
          onOpenGroupInfo={handleOpenGroupInfo}
          onStartVideoCall={handleStartVideoCall}
          onStartVoiceCall={handleStartVoiceCall}
        />

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
                    scrollEnabled={!activeContextMenuData}
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
                      isInitialMessagesLoading ? <ConversationMessageListLoadingState /> : null
                    }
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={false}
                    maintainVisibleContentPosition={{ disabled: Platform.OS === 'android' }}
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
          replyTarget={activeContextMenuData?.replyTarget ?? null}
          previewLayout={activeContextMenuData?.previewLayout}
          isOwn={activeContextMenuData?.isOwn ?? false}
          isGroupedTop={activeContextMenuData?.isGroupedTop ?? false}
          isGroupedBottom={activeContextMenuData?.isGroupedBottom ?? false}
          anchor={activeContextMenuData?.anchor ?? null}
          gestureState={activeContextMenuData?.gestureState}
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
