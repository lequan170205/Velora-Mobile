import { type FlashListRef } from '@shopify/flash-list'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type NativeScrollEvent, type NativeSyntheticEvent, Platform } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import {
  EMPTY_CONVERSATION_MESSAGES as EMPTY_MESSAGES,
  getClientMessageIdentity,
  getOrderDebugSample,
  getRenderableOptimisticMessages,
  isPersistedServerMessageId,
} from '../../lib/conversation/conversationMessagePolicies'
import { mergeMessageCollectionByIdentity } from '../../lib/messageIdentity'
import { buildMessageListState, sortMessagesCanonicalNewestFirst } from '../../lib/messageListState'
import { useChatStore } from '../../stores/chatStore'
import { useMessageListUiStore } from '../../stores/messageListUiStore'
import { useAnchoredMessages } from '../useAnchoredMessages'
import { useMessages } from '../useMessages'

import type { MessageLayout } from '../../lib/messageListState'
import type { OptimisticSortAnchor } from '../../stores/chatStore'
import type { Conversation, Message } from '../../types/conversation.types'
import type { Socket } from 'socket.io-client'

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

type UseConversationTimelineControllerInput = {
  conversation: Conversation | null
  conversationId: string
  currentUserId: string | null
  getReplyScrollViewPosition: () => number
  resetConversationKeyboard: () => void
  socket: Socket | null
}

export const useConversationTimelineController = ({
  conversation,
  conversationId,
  currentUserId,
  getReplyScrollViewPosition,
  resetConversationKeyboard,
  socket,
}: UseConversationTimelineControllerInput) => {
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
  const confirmMessage = useChatStore((state) => state.confirmMessage)
  const dequeueOfflineMessage = useChatStore((state) => state.dequeueOfflineMessage)
  const bumpHighlightToken = useMessageListUiStore((state) => state.bumpHighlightToken)
  const resetConversationUi = useMessageListUiStore((state) => state.resetConversationUi)
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
    conversation,
    conversationId,
  })
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
  const replyHighlightTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const replyJumpSettleTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const pendingAnchorScrollTargetIdRef = useRef<string | null>(null)
  const pendingReturnToLatestRef = useRef(false)
  const anchorBottomLoadArmedRef = useRef(false)

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

  const resetTimestampRevealForReply = useCallback(() => {
    timestampRevealOffset.value = withSpring(0, {
      mass: 0.65,
      damping: 27,
      stiffness: 310,
      overshootClamping: true,
    })
  }, [timestampRevealOffset])

  useEffect(() => {
    return () => {
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
  const isInitialMessagesLoading =
    (timelineMode === 'latest' ? isLoading : isResolvingAnchor) && orderedMessages.length === 0

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

  useEffect(() => {
    isNearBottomRef.current = true
    setIsNearBottom(true)
    isScrollButtonVisible.value = false
  }, [conversationId, isScrollButtonVisible])

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
      const isMyMessage = newestSenderId === currentUserId
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
    clearPendingOwnMediaBatchScrollTransaction,
    currentUserId,
    newestClientMessageId,
    newestMessageId,
    newestSenderId,
    scrollToBottomForNewestMessage,
    timelineMode,
  ])

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

  const prepareOwnSendBottomFollow = useCallback(() => {
    isNearBottomRef.current = true
    setIsNearBottom(true)
    isScrollButtonVisible.value = false

    if (timelineMode === 'anchor') {
      pendingOwnSendBottomScrollRef.current = 'animated'
      void returnToLatestTimeline(false)
    } else {
      pendingOwnSendBottomScrollRef.current = 'animated'
    }
  }, [isScrollButtonVisible, returnToLatestTimeline, timelineMode])

  const cancelOwnSendBottomFollow = useCallback(() => {
    pendingOwnSendBottomScrollRef.current = 'none'
  }, [])

  const handleScrollAffordancePress = useCallback(() => {
    if (timelineMode === 'anchor') {
      void returnToLatestTimeline()
      return
    }

    scrollToBottom()
  }, [returnToLatestTimeline, scrollToBottom, timelineMode])

  return {
    cancelOwnSendBottomFollow,
    currentIsFetchingOlder,
    currentOlderLoader,
    handleMomentumScrollEnd,
    handleScroll,
    handleScrollAffordancePress,
    handleScrollBeginDrag,
    handleScrollEndDrag,
    handleScrollToMessage,
    hasLoadedLatestMessagePages,
    isInitialMessagesLoading,
    isNearBottom,
    latestSeenFrontierMessageId,
    layoutById,
    layoutByIdRef,
    listRef,
    messageById,
    orderedMessages,
    prepareOwnSendBottomFollow,
    registerPendingOwnMediaBatchScrollTransaction,
    resetTimestampRevealForReply,
    scrollButtonStyle,
    timelineMode,
    timestampRevealGesture,
    timestampRevealOffset,
    timestampRevealProgress,
  }
}
