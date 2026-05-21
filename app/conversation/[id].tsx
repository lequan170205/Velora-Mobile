import { MaterialIcons } from '@expo/vector-icons'
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list'
import { useQueryClient } from '@tanstack/react-query'
import { BlurView } from 'expo-blur'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
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
import {
  KeyboardController,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller'
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  MessageBubble,
  type MessageBubbleContextMenuPayload,
} from '../../src/components/chat/MessageBubble'
import { MessageContextMenu } from '../../src/components/chat/MessageContextMenu'
import { MessageInput, type MessageInputHandle } from '../../src/components/chat/MessageInput'
import { queryKeys } from '../../src/constants/queryKeys'
import { useChatMediaUploads } from '../../src/hooks/useChatMediaUploads'
import { useRecallMessage } from '../../src/hooks/useMessageActions'
import { trimMessagesCache, useMessages, useSendMessage } from '../../src/hooks/useMessages'
import {
  getMessageIdentityKey,
  getMessageIdentityTokens,
  mergeMessageRecords,
} from '../../src/lib/messageIdentity'
import { formatLastSeenLabel } from '../../src/lib/presence'
import { useSocket } from '../../src/providers/SocketProvider'
import { useAuthStore } from '../../src/stores/authStore'
import { useChatStore } from '../../src/stores/chatStore'
import { useChatVideoPlaybackStore } from '../../src/stores/chatVideoPlaybackStore'
import { useMessageListUiStore } from '../../src/stores/messageListUiStore'

import type { ChatParticipant, Conversation, Message } from '../../src/types/conversation.types'
import type { ImagePickerAsset } from 'expo-image-picker'

type MessageLayout = {
  showDateSeparator: boolean
  separatorLabel: string
  isGroupedTop: boolean
  isGroupedBottom: boolean
  showAvatar: boolean
  timeLabel: string
}

type ActiveContextMenuState = MessageBubbleContextMenuPayload

const DEFAULT_MESSAGE_LAYOUT: MessageLayout = {
  showDateSeparator: false,
  separatorLabel: '',
  isGroupedTop: false,
  isGroupedBottom: false,
  showAvatar: false,
  timeLabel: '',
}

const createdAtTimestampCache = new Map<string, number>()
const createdAtDayStartCache = new Map<string, number>()
const createdAtTimeLabelCache = new Map<string, string>()

const getMessageCreatedAtMs = (dateString?: string) => {
  if (!dateString) return 0

  const cachedTimestamp = createdAtTimestampCache.get(dateString)
  if (cachedTimestamp !== undefined) {
    return cachedTimestamp
  }

  const nextTimestamp = new Date(dateString).getTime()
  const normalizedTimestamp = Number.isFinite(nextTimestamp) ? nextTimestamp : 0
  createdAtTimestampCache.set(dateString, normalizedTimestamp)

  return normalizedTimestamp
}

const getMessageDayStartMs = (dateString?: string) => {
  if (!dateString) return 0

  const cachedDayStart = createdAtDayStartCache.get(dateString)
  if (cachedDayStart !== undefined) {
    return cachedDayStart
  }

  const createdAtMs = getMessageCreatedAtMs(dateString)
  if (!createdAtMs) {
    createdAtDayStartCache.set(dateString, 0)
    return 0
  }

  const nextDayStart = new Date(createdAtMs)
  nextDayStart.setHours(0, 0, 0, 0)

  const normalizedDayStart = nextDayStart.getTime()
  createdAtDayStartCache.set(dateString, normalizedDayStart)

  return normalizedDayStart
}

const getMessageTimeLabel = (dateString?: string) => {
  if (!dateString) return ''

  const cachedTimeLabel = createdAtTimeLabelCache.get(dateString)
  if (cachedTimeLabel !== undefined) {
    return cachedTimeLabel
  }

  const createdAtMs = getMessageCreatedAtMs(dateString)
  if (!createdAtMs) {
    createdAtTimeLabelCache.set(dateString, '')
    return ''
  }

  const nextTimeLabel = new Date(createdAtMs).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })

  createdAtTimeLabelCache.set(dateString, nextTimeLabel)
  return nextTimeLabel
}

const buildSeparatorLabel = (dayStartMs: number) => {
  if (!dayStartMs) return ''

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const todayDayStartMs = today.getTime()
  const yesterdayDayStartMs = todayDayStartMs - 24 * 60 * 60 * 1000

  if (dayStartMs === todayDayStartMs) return 'Today'
  if (dayStartMs === yesterdayDayStartMs) return 'Yesterday'

  return new Date(dayStartMs).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const getStableLayout = (previousLayout: MessageLayout | undefined, nextLayout: MessageLayout) => {
  if (
    previousLayout &&
    previousLayout.showDateSeparator === nextLayout.showDateSeparator &&
    previousLayout.separatorLabel === nextLayout.separatorLabel &&
    previousLayout.isGroupedTop === nextLayout.isGroupedTop &&
    previousLayout.isGroupedBottom === nextLayout.isGroupedBottom &&
    previousLayout.showAvatar === nextLayout.showAvatar &&
    previousLayout.timeLabel === nextLayout.timeLabel
  ) {
    return previousLayout
  }

  return nextLayout
}

const EMPTY_MESSAGES: Message[] = []
const EMPTY_TYPERS: string[] = []
const renderableOptimisticMessagesCache = new WeakMap<Message[], Message[]>()
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
  layout: MessageLayout
  isOwn: boolean
  senderInfo?: ChatParticipant | Message['sender'] | null
  conversationId: string
  onToggleDetails: (messageId: string) => void
  onPressReplyPreview: (replyToId?: string) => void
  onReply: (message: Message) => void
  onOpenContextMenu: (payload: MessageBubbleContextMenuPayload) => void
}

const MessageRow = memo(
  function MessageRow({
    message,
    layout,
    isOwn,
    senderInfo,
    conversationId,
    onToggleDetails,
    onPressReplyPreview,
    onReply,
    onOpenContextMenu,
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
      onPressReplyPreview(message.replyToId)
    }, [message.replyToId, onPressReplyPreview])

    return (
      <View>
        {layout.showDateSeparator ? (
          <View className="my-4 items-center">
            <Text className="text-xs2 text-text-muted">{layout.separatorLabel}</Text>
          </View>
        ) : null}
        <MessageBubble
          message={message}
          timeLabel={layout.timeLabel}
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
          conversationId={conversationId}
        />
      </View>
    )
  },
  (prevProps, nextProps) =>
    prevProps.message === nextProps.message &&
    prevProps.layout === nextProps.layout &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.senderInfo === nextProps.senderInfo &&
    prevProps.conversationId === nextProps.conversationId &&
    prevProps.onToggleDetails === nextProps.onToggleDetails &&
    prevProps.onPressReplyPreview === nextProps.onPressReplyPreview &&
    prevProps.onReply === nextProps.onReply &&
    prevProps.onOpenContextMenu === nextProps.onOpenContextMenu,
)

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

  const { socket, isConnected, requestPresence } = useSocket()

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMessages(conversationId)
  const { mutate: sendMessage } = useSendMessage(conversationId)
  const { enqueueMediaAssets } = useChatMediaUploads(conversationId)
  const { mutate: recallMessage } = useRecallMessage(conversationId)
  const toggleExpandedMessage = useMessageListUiStore((state) => state.toggleExpandedMessage)
  const bumpHighlightToken = useMessageListUiStore((state) => state.bumpHighlightToken)
  const resetConversationUi = useMessageListUiStore((state) => state.resetConversationUi)
  const clearConversationInlinePlayback = useChatVideoPlaybackStore(
    (state) => state.clearConversation,
  )
  const [activeContextMenu, setActiveContextMenu] = useState<ActiveContextMenuState | null>(null)

  const listRef = useRef<FlashListRef<Message>>(null)
  const layoutByIdRef = useRef<Map<string, MessageLayout>>(new Map())
  const indexByIdRef = useRef<Map<string, number>>(new Map())
  const messageInputRef = useRef<MessageInputHandle>(null)
  const isScrollButtonVisible = useSharedValue(false)
  const isNearBottomRef = useRef(true)
  const preservedKeyboardOffset = useSharedValue(0)

  const { height: keyboardHeight } = useReanimatedKeyboardAnimation()

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
      const isNearBottom = offsetY <= 50
      isNearBottomRef.current = isNearBottom

      const shouldShowScrollButton = offsetY > 200
      if (shouldShowScrollButton !== isScrollButtonVisible.value) {
        isScrollButtonVisible.value = shouldShowScrollButton
      }
    },
    [isScrollButtonVisible],
  )

  const scrollButtonStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(isScrollButtonVisible.value ? 1 : 0, { duration: 200 }),
      transform: [{ scale: withTiming(isScrollButtonVisible.value ? 1 : 0.8, { duration: 200 }) }],
    }
  })
  const typingTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const replyHighlightTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const isComposerFocusedRef = useRef(false)
  const shouldRestoreComposerFocusRef = useRef(false)

  const serverMessages = useMemo(() => {
    return (data?.pages.flat() as Message[]) || EMPTY_MESSAGES
  }, [data])

  const [transitionDone, setTransitionDone] = useState(false)
  const [presenceTick, setPresenceTick] = useState(() => Date.now())

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setTransitionDone(true)
    })
    return () => handle.cancel()
  }, [])

  const { orderedMessages, layoutById, messageById, indexById } = useMemo(() => {
    const serverIdentityTokens = new Set<string>()
    for (const message of serverMessages) {
      for (const token of getMessageIdentityTokens(message)) {
        serverIdentityTokens.add(token)
      }
    }

    const pendingMessages: Message[] = []
    for (const message of localOptimistic) {
      if (!message) continue

      const hasServerMatch = getMessageIdentityTokens(message).some((token) =>
        serverIdentityTokens.has(token),
      )
      if (!hasServerMatch) {
        pendingMessages.push(message)
      }
    }

    const combinedMessages = [...pendingMessages, ...serverMessages]
    const getVirtualTime = (msg: Message) => {
      let time = getMessageCreatedAtMs(msg.createdAt)
      const isSending = (msg.id || msg._id || '').startsWith('temp-') && msg.status !== 'FAILED'

      if (isSending) {
        time += 10000000000000
      }

      return time
    }

    combinedMessages.sort((left, right) => getVirtualTime(right) - getVirtualTime(left))

    const dedupedIndexByIdentity = new Map<string, number>()
    const dedupedMessages: Message[] = []

    for (const message of combinedMessages) {
      const identityKey = getMessageIdentityKey(message)
      if (!identityKey) continue

      const existingIndex = dedupedIndexByIdentity.get(identityKey)
      if (existingIndex === undefined) {
        dedupedIndexByIdentity.set(identityKey, dedupedMessages.length)
        dedupedMessages.push(message)
      } else {
        const existingMessage = dedupedMessages[existingIndex]
        if (!existingMessage) continue

        dedupedMessages[existingIndex] = mergeMessageRecords(existingMessage, message)
      }
    }

    const FIVE_MINS = 5 * 60 * 1000
    const previousLayoutById = layoutByIdRef.current
    const nextLayoutById = new Map<string, MessageLayout>()
    const nextMessageById = new Map<string, Message>()
    const nextIndexById = new Map<string, number>()

    for (let index = 0; index < dedupedMessages.length; index += 1) {
      const item = dedupedMessages[index]
      if (!item) continue

      const previousMessage = dedupedMessages[index + 1]
      const nextMessage = dedupedMessages[index - 1]

      const itemTime = getMessageCreatedAtMs(item.createdAt)
      const itemDay = getMessageDayStartMs(item.createdAt)
      const prevTime = previousMessage ? getMessageCreatedAtMs(previousMessage.createdAt) : 0
      const prevDay = previousMessage ? getMessageDayStartMs(previousMessage.createdAt) : 0
      const nextTime = nextMessage ? getMessageCreatedAtMs(nextMessage.createdAt) : 0
      const nextDay = nextMessage ? getMessageDayStartMs(nextMessage.createdAt) : 0

      const showDateSeparator = !previousMessage || itemDay !== prevDay
      const isNextDay = !!nextMessage && itemDay !== nextDay

      const nextLayout = getStableLayout(previousLayoutById.get(item.id), {
        showDateSeparator,
        separatorLabel: showDateSeparator ? buildSeparatorLabel(itemDay) : '',
        isGroupedTop:
          previousMessage?.senderId === item.senderId &&
          itemTime - prevTime < FIVE_MINS &&
          !showDateSeparator,
        isGroupedBottom:
          nextMessage?.senderId === item.senderId && nextTime - itemTime < FIVE_MINS && !isNextDay,
        showAvatar: nextMessage?.senderId !== item.senderId || isNextDay,
        timeLabel: getMessageTimeLabel(item.createdAt),
      })

      nextLayoutById.set(item.id, nextLayout)
      nextMessageById.set(item.id, item)
      nextIndexById.set(item.id, index)
    }

    return {
      orderedMessages: dedupedMessages,
      layoutById: nextLayoutById,
      messageById: nextMessageById,
      indexById: nextIndexById,
    }
  }, [localOptimistic, serverMessages])

  layoutByIdRef.current = layoutById
  indexByIdRef.current = indexById

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
    isScrollButtonVisible.value = false
  }, [conversationId, isScrollButtonVisible])

  const isOtherUserTyping = activeTypers.some((typerId) => typerId !== user?.id)
  const isInitialMessagesLoading = isLoading && orderedMessages.length === 0
  const getReplyScrollViewPosition = useCallback(() => 0.72, [])

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

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
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

  useEffect(() => {
    setActiveContextMenu(null)
    clearConversationInlinePlayback(conversationId)
    shouldRestoreComposerFocusRef.current = false
    preservedKeyboardOffset.value = 0

    return () => {
      clearConversationInlinePlayback(conversationId)
      resetConversationUi(conversationId)
    }
  }, [
    clearConversationInlinePlayback,
    conversationId,
    preservedKeyboardOffset,
    resetConversationUi,
  ])

  useEffect(() => {
    if (newestMessageId && newestMessageId !== prevNewestMessageId.current) {
      const isInitialAutoScroll = prevNewestMessageId.current === undefined
      const isMyMessage = newestSenderId === user?.id

      const shouldAutoScroll = isMyMessage || isNearBottomRef.current || isInitialAutoScroll

      if (shouldAutoScroll) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollToBottom()
          })
        })
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
    user?.id,
  ])

  const cachedData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)
  const allConversations: Conversation[] = Array.isArray(cachedData)
    ? (cachedData as Conversation[])
    : (cachedData as { pages?: Conversation[][] })?.pages?.flat() || []
  const currentConversation = allConversations.find((c: Conversation) => c?.id === conversationId)

  const participantsMap = useMemo(() => {
    const map = new Map<string, ChatParticipant>()
    currentConversation?.participants?.forEach((p: ChatParticipant) => {
      map.set(p.id, p)
    })
    return map
  }, [currentConversation?.participants])

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
      await enqueueMediaAssets(assets)
    },
    [enqueueMediaAssets],
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

      requestAnimationFrame(() => {
        messageInputRef.current?.focus()
      })
    },
    [setReplyToMessage],
  )

  const handleCancelReply = useCallback(() => {
    setReplyToMessage(null)
  }, [setReplyToMessage])

  const handleSendText = useCallback(
    (text: string, replyToId?: string) => {
      sendMessage({ content: text, ...(replyToId ? { replyToId } : {}) })
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }
      socket?.emit('typing_stop', conversationId)
    },
    [sendMessage, socket, conversationId],
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

  const scrollToMessageById = useCallback(
    (messageId: string) => {
      const index = indexByIdRef.current.get(messageId)
      if (index === undefined) {
        return false
      }

      void listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: getReplyScrollViewPosition(),
      })
      scheduleMessageHighlight(messageId)
      return true
    },
    [getReplyScrollViewPosition, scheduleMessageHighlight],
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
    (replyToId?: string) => {
      if (!replyToId) return

      runReplyScroll(replyToId)
    },
    [runReplyScroll],
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
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      if (socket?.connected) socket.emit('typing_stop', conversationId)
      if (replyHighlightTimeoutRef.current) clearTimeout(replyHighlightTimeoutRef.current)

      setTimeout(() => {
        const messagesQueryKey = queryKeys.conversations.messages(conversationId)
        void queryClient.cancelQueries({ queryKey: messagesQueryKey, exact: true })
        trimMessagesCache(queryClient, conversationId)
      }, 300)
    }
  }, [queryClient, socket, conversationId])

  const renderListHeader = useCallback(() => {
    return (
      <View>
        {isOtherUserTyping ? <TypingIndicator displayName={displayName} /> : null}
        <Animated.View style={listSpacerStyle} />
      </View>
    )
  }, [isOtherUserTyping, displayName, listSpacerStyle])

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Message>) => {
      if (!item) return null

      const layout = layoutByIdRef.current.get(item.id) ?? DEFAULT_MESSAGE_LAYOUT
      const isOwn = item.senderId === user?.id
      const sender = item.sender ?? participantsMap.get(item.senderId)

      return (
        <MessageRow
          message={item}
          layout={layout}
          isOwn={isOwn}
          senderInfo={sender ?? null}
          conversationId={conversationId}
          onToggleDetails={handleToggleDetails}
          onPressReplyPreview={handleScrollToMessage}
          onReply={handleReply}
          onOpenContextMenu={handleOpenContextMenu}
        />
      )
    },
    [
      conversationId,
      handleReply,
      handleScrollToMessage,
      handleToggleDetails,
      handleOpenContextMenu,
      participantsMap,
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
    const isVisible = isFetchingNextPage && !isInitialMessagesLoading
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

        <View style={{ flex: 1, overflow: 'hidden', backgroundColor: 'transparent' }}>
          <Animated.View style={[{ flex: 1 }, keyboardWrapperStyle]}>
            <View className="flex-1">
              {isFetchingNextPage && !isInitialMessagesLoading ? (
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
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                getItemType={getItemType}
                contentContainerStyle={{
                  paddingBottom: 20,
                }}
                onEndReached={loadOlderMessages}
                onEndReachedThreshold={0.2}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                keyboardDismissMode="none"
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={renderListHeader}
                ListEmptyComponent={isInitialMessagesLoading ? <MessageListLoadingState /> : null}
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
                  onPress={scrollToBottom}
                  activeOpacity={0.8}
                  style={{
                    borderCurve: 'continuous',
                    boxShadow: '0 14px 26px rgba(93, 74, 53, 0.12)',
                  }}
                >
                  <MaterialIcons name="keyboard-arrow-down" size={24} color="#161514" />
                </TouchableOpacity>
              </Animated.View>
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
          conversationId={activeContextMenuData?.conversationId}
        />
      </View>
    </View>
  )
}
