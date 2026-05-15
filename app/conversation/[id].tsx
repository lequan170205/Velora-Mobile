import { MaterialIcons } from '@expo/vector-icons'
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list'
import { useQueryClient } from '@tanstack/react-query'
import { BlurView } from 'expo-blur'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  KeyboardStickyView,
  useKeyboardState,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller'
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import {
  MessageBubble,
  type MessageBubbleContextMenuPayload,
} from '../../src/components/chat/MessageBubble'
import { MessageContextMenu } from '../../src/components/chat/MessageContextMenu'
import { MessageInput, type MessageInputHandle } from '../../src/components/chat/MessageInput'
import { queryKeys } from '../../src/constants/queryKeys'
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

import type { ChatParticipant, Conversation, Message } from '../../src/types/conversation.types'

type RenderableMessage = Message & {
  _layout: {
    showDateSeparator: boolean
    isGroupedTop: boolean
    isGroupedBottom: boolean
    showAvatar: boolean
  }
}

type ActiveContextMenuState = MessageBubbleContextMenuPayload

const formatSeparatorDate = (dateString: string) => {
  const date = new Date(dateString)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'

  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
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

const KeyboardListSpacer = ({
  baseHeight,
  isKeyboardSpaceEnabled,
  preservedKeyboardHeight,
}: {
  baseHeight: number
  isKeyboardSpaceEnabled: boolean
  preservedKeyboardHeight: SharedValue<number>
}) => {
  const { height } = useReanimatedKeyboardAnimation()

  const style = useAnimatedStyle(
    () => ({
      height:
        baseHeight +
        Math.max(
          preservedKeyboardHeight.value,
          isKeyboardSpaceEnabled ? Math.max(0, -height.value) : 0,
        ),
    }),
    [baseHeight, height, isKeyboardSpaceEnabled, preservedKeyboardHeight],
  )

  return <Animated.View pointerEvents="none" style={style} />
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

  const { socket, isConnected, requestPresence } = useSocket()

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMessages(conversationId)
  const { mutate: sendMessage } = useSendMessage(conversationId)
  const { mutate: recallMessage } = useRecallMessage(conversationId)
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)
  const [highlightedMessage, setHighlightedMessage] = useState<{
    id: string
    token: number
  } | null>(null)
  const [activeContextMenu, setActiveContextMenu] = useState<ActiveContextMenuState | null>(null)
  const keyboardVisible = useKeyboardState((state) => state.isVisible)
  const keyboardHeight = useKeyboardState((state) => state.height)

  const listRef = useRef<FlashListRef<RenderableMessage>>(null)
  const messageInputRef = useRef<MessageInputHandle>(null)
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const isScrollButtonVisible = useSharedValue(false)
  const isNearBottomRef = useRef(true)
  const shouldPinLatestMessagesRef = useRef(false)
  const isComposerFocusedShared = useSharedValue(false)
  const shouldPinLatestMessagesShared = useSharedValue(false)
  const lastKeyboardPinnedHeight = useSharedValue(0)

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = Math.max(0, event.nativeEvent.contentOffset.y)
      const shouldShowScrollButton = offsetY > 200
      const isNearBottom = !shouldShowScrollButton
      isNearBottomRef.current = isNearBottom

      if (isComposerFocusedRef.current) {
        shouldPinLatestMessagesRef.current = isNearBottom
        shouldPinLatestMessagesShared.value = isNearBottom
      }

      if (shouldShowScrollButton !== isScrollButtonVisible.value) {
        isScrollButtonVisible.value = shouldShowScrollButton
      }
    },
    [isScrollButtonVisible, shouldPinLatestMessagesShared],
  )

  const scrollButtonStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(isScrollButtonVisible.value ? 1 : 0, { duration: 200 }),
      transform: [{ scale: withTiming(isScrollButtonVisible.value ? 1 : 0.8, { duration: 200 }) }],
      // Tắt pointerEvents khi ẩn để không chặn thao tác chạm
      pointerEvents: isScrollButtonVisible.value ? 'auto' : 'none',
    }
  })
  const typingTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const replyHighlightTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const highlightResetTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const focusPinTimeoutRefs = useRef<(NodeJS.Timeout | number)[]>([])
  const focusPinRunIdRef = useRef(0)
  const isComposerFocusedRef = useRef(false)
  const shouldRestoreComposerFocusRef = useRef(false)
  const preservedKeyboardHeight = useSharedValue(0)
  const { height: keyboardAnimatedHeight } = useReanimatedKeyboardAnimation()

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

  const allMessages = useMemo<RenderableMessage[]>(() => {
    const serverIdentityTokens = new Set(
      serverMessages.flatMap((message) => getMessageIdentityTokens(message)),
    )

    const pendingMessages = localOptimistic.filter((m) => {
      if (!m) return false
      return !getMessageIdentityTokens(m).some((token) => serverIdentityTokens.has(token))
    })

    const combinedMessages = [...pendingMessages, ...serverMessages].sort((a, b) => {
      const timeA = a?.createdAt || ''
      const timeB = b?.createdAt || ''
      return timeB > timeA ? 1 : timeB < timeA ? -1 : 0
    })

    const dedupedIndexByIdentity = new Map<string, number>()
    const dedupedArray: Message[] = []

    for (const message of combinedMessages) {
      const identityKey = getMessageIdentityKey(message)
      if (!identityKey) continue

      const existingIndex = dedupedIndexByIdentity.get(identityKey)
      if (existingIndex === undefined) {
        dedupedIndexByIdentity.set(identityKey, dedupedArray.length)
        dedupedArray.push(message)
      } else {
        const existingMessage = dedupedArray[existingIndex]
        if (!existingMessage) continue

        dedupedArray[existingIndex] = mergeMessageRecords(existingMessage, message)
      }
    }

    const FIVE_MINS = 5 * 60 * 1000

    return dedupedArray.map((item, index, array) => {
      const previousMessage = array[index + 1]
      const nextMessage = array[index - 1]

      const itemTime = new Date(item.createdAt).getTime()
      const itemDay = new Date(item.createdAt).setHours(0, 0, 0, 0)

      const prevTime = previousMessage ? new Date(previousMessage.createdAt).getTime() : 0
      const prevDay = previousMessage ? new Date(previousMessage.createdAt).setHours(0, 0, 0, 0) : 0

      const nextTime = nextMessage ? new Date(nextMessage.createdAt).getTime() : 0
      const nextDay = nextMessage ? new Date(nextMessage.createdAt).setHours(0, 0, 0, 0) : 0

      const showDateSeparator = !previousMessage || itemDay !== prevDay
      const isNextDay = !!nextMessage && itemDay !== nextDay

      const isGroupedTop =
        previousMessage?.senderId === item.senderId &&
        itemTime - prevTime < FIVE_MINS &&
        !showDateSeparator

      const isGroupedBottom =
        nextMessage?.senderId === item.senderId && nextTime - itemTime < FIVE_MINS && !isNextDay

      const showAvatar = nextMessage?.senderId !== item.senderId || isNextDay

      return {
        ...item,
        _layout: {
          showDateSeparator,
          isGroupedTop,
          isGroupedBottom,
          showAvatar,
        },
      }
    })
  }, [serverMessages, localOptimistic])

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

  const newestMessage = allMessages[0]
  const newestMessageId = newestMessage?.id
  const newestSenderId = newestMessage?.senderId
  const prevNewestMessageId = useRef(newestMessageId)

  useEffect(() => {
    isNearBottomRef.current = true
    shouldPinLatestMessagesRef.current = false
    shouldPinLatestMessagesShared.value = false
    lastKeyboardPinnedHeight.value = 0
    isScrollButtonVisible.value = false
  }, [
    conversationId,
    isScrollButtonVisible,
    lastKeyboardPinnedHeight,
    shouldPinLatestMessagesShared,
  ])

  const isOtherUserTyping = activeTypers.some((typerId) => typerId !== user?.id)
  const isInitialMessagesLoading = isLoading && allMessages.length === 0
  const getReplyScrollViewPosition = useCallback(() => 0.72, [])

  useEffect(() => {
    if (isComposerFocused && keyboardVisible && keyboardHeight > 0) {
      shouldRestoreComposerFocusRef.current = false
      preservedKeyboardHeight.value = 0
      return
    }

    if (!keyboardVisible) {
      if (!shouldRestoreComposerFocusRef.current) {
        preservedKeyboardHeight.value = 0
      }

      if (!isComposerFocused) {
        shouldPinLatestMessagesRef.current = false
        shouldPinLatestMessagesShared.value = false
        isComposerFocusedShared.value = false
      }
    }
  }, [
    isComposerFocused,
    isComposerFocusedShared,
    keyboardHeight,
    keyboardVisible,
    preservedKeyboardHeight,
    shouldPinLatestMessagesShared,
  ])

  const prepareContextMenuKeyboardPreservation = useCallback(() => {
    const state = KeyboardController.state()
    const activeKeyboardHeight = state.height || 0
    const isVisible = KeyboardController.isVisible()

    const shouldPreserveKeyboardSpace =
      isComposerFocusedRef.current && (isVisible || activeKeyboardHeight > 0)

    if (!shouldPreserveKeyboardSpace || activeKeyboardHeight <= 0) {
      shouldRestoreComposerFocusRef.current = false
      preservedKeyboardHeight.value = 0
      return false
    }

    shouldRestoreComposerFocusRef.current = true
    preservedKeyboardHeight.value = activeKeyboardHeight
    messageInputRef.current?.blur()
    void KeyboardController.dismiss()
    return true
  }, [preservedKeyboardHeight])

  const handleContextMenuClose = useCallback(() => {
    if (!shouldRestoreComposerFocusRef.current) {
      preservedKeyboardHeight.value = 0
      return
    }

    requestAnimationFrame(() => {
      messageInputRef.current?.focus()
    })
  }, [preservedKeyboardHeight])

  const handleOpenContextMenu = useCallback(
    (payload: MessageBubbleContextMenuPayload) => {
      setActiveContextMenu(payload)

      requestAnimationFrame(() => {
        prepareContextMenuKeyboardPreservation()
      })
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

  const scrollToBottomImmediate = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [])

  const clearPendingFocusPins = useCallback(() => {
    focusPinTimeoutRefs.current.forEach((timeoutId) => {
      clearTimeout(timeoutId)
    })
    focusPinTimeoutRefs.current = []
  }, [])

  const scheduleFocusPin = useCallback(() => {
    clearPendingFocusPins()
    const runId = ++focusPinRunIdRef.current

    const pinIfStillRelevant = () => {
      if (
        focusPinRunIdRef.current !== runId ||
        !isComposerFocusedRef.current ||
        !shouldPinLatestMessagesRef.current
      ) {
        return
      }

      scrollToBottomImmediate()
    }

    pinIfStillRelevant()

    requestAnimationFrame(() => {
      pinIfStillRelevant()

      requestAnimationFrame(() => {
        pinIfStillRelevant()
      })
    })
    ;[48, 120, 220].forEach((delay) => {
      const timeoutId = setTimeout(() => {
        pinIfStillRelevant()
      }, delay)
      focusPinTimeoutRefs.current.push(timeoutId)
    })
  }, [clearPendingFocusPins, scrollToBottomImmediate])

  const handleComposerFocusChange = useCallback(
    (focused: boolean) => {
      const shouldPinLatestMessages = focused ? isNearBottomRef.current : false

      if (!focused) {
        focusPinRunIdRef.current += 1
        clearPendingFocusPins()
      }

      shouldPinLatestMessagesRef.current = shouldPinLatestMessages
      shouldPinLatestMessagesShared.value = shouldPinLatestMessages
      isComposerFocusedRef.current = focused
      isComposerFocusedShared.value = focused
      setIsComposerFocused(focused)

      if (focused && shouldPinLatestMessages) {
        scheduleFocusPin()
      }
    },
    [
      clearPendingFocusPins,
      isComposerFocusedShared,
      scheduleFocusPin,
      shouldPinLatestMessagesShared,
    ],
  )

  useAnimatedReaction(
    () => ({
      keyboardHeight: Math.round(Math.max(0, -keyboardAnimatedHeight.value)),
      isComposerFocused: isComposerFocusedShared.value,
      shouldPinLatestMessages: shouldPinLatestMessagesShared.value,
    }),
    (current) => {
      if (!current.isComposerFocused || !current.shouldPinLatestMessages) {
        lastKeyboardPinnedHeight.value = 0
        return
      }

      if (current.keyboardHeight <= 0) {
        lastKeyboardPinnedHeight.value = 0
        return
      }

      if (
        lastKeyboardPinnedHeight.value === 0 ||
        Math.abs(current.keyboardHeight - lastKeyboardPinnedHeight.value) >= 32
      ) {
        lastKeyboardPinnedHeight.value = current.keyboardHeight
        scheduleOnRN(scrollToBottomImmediate)
      }
    },
    [
      isComposerFocusedShared,
      keyboardAnimatedHeight,
      lastKeyboardPinnedHeight,
      scrollToBottomImmediate,
      shouldPinLatestMessagesShared,
    ],
  )

  const dismissComposer = useCallback(() => {
    shouldRestoreComposerFocusRef.current = false
    preservedKeyboardHeight.value = 0
    messageInputRef.current?.blur()
    void KeyboardController.dismiss()
  }, [preservedKeyboardHeight])

  const loadOlderMessages = useCallback(() => {
    if (!hasNextPage || isInitialMessagesLoading || isFetchingNextPage) {
      return
    }

    void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isInitialMessagesLoading])

  useEffect(() => {
    setActiveContextMenu(null)
    shouldRestoreComposerFocusRef.current = false
    preservedKeyboardHeight.value = 0
  }, [conversationId, preservedKeyboardHeight])

  useEffect(() => {
    if (newestMessageId && newestMessageId !== prevNewestMessageId.current) {
      if (isNearBottomRef.current || newestSenderId === user?.id) {
        scrollToBottom()
      }

      if (socket?.connected) {
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

  const handleSendMedia = async (
    uri: string,
    type: 'image' | 'file',
    _fileInfo: { fileName?: string } | unknown,
  ) => {
    if (!user?.id) return

    const now = new Date().toISOString()
    const tempId = `temp-${Date.now()}`

    const tempMessage: Message = {
      id: tempId,
      conversationId,
      senderId: user.id,
      sender: user,
      content: uri,
      type: type,
      status: 'SENT',
      createdAt: now,
      updatedAt: now,
    }

    useChatStore.getState().addOptimisticMessage(conversationId, tempMessage)
  }

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

  const handleToggleDetails = useCallback((messageId: string) => {
    setExpandedMessageId((prevId) => (prevId === messageId ? null : messageId))
  }, [])

  const scheduleMessageHighlight = useCallback((messageId: string) => {
    if (replyHighlightTimeoutRef.current) {
      clearTimeout(replyHighlightTimeoutRef.current)
      replyHighlightTimeoutRef.current = null
    }

    replyHighlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMessage((prev) => ({
        id: messageId,
        token: prev?.id === messageId ? prev.token + 1 : (prev?.token ?? 0) + 1,
      }))

      if (highlightResetTimeoutRef.current) {
        clearTimeout(highlightResetTimeoutRef.current)
      }

      highlightResetTimeoutRef.current = setTimeout(() => {
        setHighlightedMessage((prev) => (prev?.id === messageId ? null : prev))
      }, 1500)
    }, 320)
  }, [])

  const scrollToMessageById = useCallback(
    (messageId: string) => {
      const index = allMessages.findIndex((message) => message.id === messageId)
      if (index === -1) {
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
    [allMessages, getReplyScrollViewPosition, scheduleMessageHighlight],
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

    const currentMessage =
      allMessages.find((message) => message.id === activeContextMenuMessageId) ??
      activeContextMenuMessage

    return {
      message: currentMessage,
      anchor: activeContextMenuAnchor,
      conversationId: activeContextMenuConversationId,
      isOwn: currentMessage.senderId === user?.id,
      isGroupedTop:
        '_layout' in currentMessage
          ? Boolean((currentMessage as RenderableMessage)._layout?.isGroupedTop)
          : activeContextMenuFallbackGroupedTop,
      isGroupedBottom:
        '_layout' in currentMessage
          ? Boolean((currentMessage as RenderableMessage)._layout?.isGroupedBottom)
          : activeContextMenuFallbackGroupedBottom,
    }
  }, [
    activeContextMenuAnchor,
    activeContextMenuConversationId,
    activeContextMenuFallbackGroupedBottom,
    activeContextMenuFallbackGroupedTop,
    activeContextMenuMessage,
    activeContextMenuMessageId,
    allMessages,
    user?.id,
  ])

  useEffect(() => {
    return () => {
      clearPendingFocusPins()
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      if (socket?.connected) socket.emit('typing_stop', conversationId)
      if (replyHighlightTimeoutRef.current) clearTimeout(replyHighlightTimeoutRef.current)
      if (highlightResetTimeoutRef.current) clearTimeout(highlightResetTimeoutRef.current)

      setTimeout(() => {
        const messagesQueryKey = queryKeys.conversations.messages(conversationId)
        void queryClient.cancelQueries({ queryKey: messagesQueryKey, exact: true })
        trimMessagesCache(queryClient, conversationId)
      }, 300)
    }
  }, [clearPendingFocusPins, queryClient, socket, conversationId])

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RenderableMessage>) => {
      if (!item) return null

      const { showDateSeparator, isGroupedTop, isGroupedBottom, showAvatar } = item._layout
      const isOwn = item?.senderId === user?.id
      const sender = item.sender ?? participantsMap.get(item.senderId)

      return (
        <View>
          {showDateSeparator && (
            <View className="my-4 items-center">
              <Text className="text-xs2 text-text-muted">
                {formatSeparatorDate(item.createdAt)}
              </Text>
            </View>
          )}
          <MessageBubble
            message={item}
            isOwn={isOwn}
            showAvatar={showAvatar}
            senderInfo={sender}
            isGroupedTop={isGroupedTop}
            isGroupedBottom={isGroupedBottom}
            highlightToken={highlightedMessage?.id === item.id ? highlightedMessage.token : 0}
            isExpanded={expandedMessageId === item.id}
            isContextMenuActive={activeContextMenuMessageId === item.id}
            onToggleDetails={() => handleToggleDetails(item.id)}
            onPressReplyPreview={() => handleScrollToMessage(item.replyToId)}
            onReply={() => handleReply(item)}
            onOpenContextMenu={handleOpenContextMenu}
            conversationId={conversationId}
          />
        </View>
      )
    },
    [
      user?.id,
      participantsMap,
      expandedMessageId,
      highlightedMessage,
      activeContextMenuMessageId,
      conversationId,
      handleToggleDetails,
      handleScrollToMessage,
      handleReply,
      handleOpenContextMenu,
    ],
  )

  const getItemType = useCallback((item: RenderableMessage) => {
    if (item.isRecalled === true || item.is_recalled === true) {
      return 'recalled'
    }

    return item.type || 'text'
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
            data={allMessages}
            extraData={`${expandedMessageId ?? ''}:${highlightedMessage?.id ?? ''}:${highlightedMessage?.token ?? 0}:${activeContextMenuMessageId ?? ''}`}
            renderItem={renderItem}
            keyExtractor={(item: RenderableMessage, index: number) =>
              item?.id ? item.id.toString() : `fallback-${index}`
            }
            getItemType={getItemType}
            onEndReached={loadOlderMessages}
            onEndReachedThreshold={0.2}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            keyboardDismissMode="none"
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="automatic"
            ListHeaderComponent={
              <View>
                {isOtherUserTyping ? <TypingIndicator displayName={displayName} /> : null}
                <KeyboardListSpacer
                  baseHeight={0}
                  isKeyboardSpaceEnabled={isComposerFocused}
                  preservedKeyboardHeight={preservedKeyboardHeight}
                />
              </View>
            }
            ListEmptyComponent={isInitialMessagesLoading ? <MessageListLoadingState /> : null}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={false}
          />
          <Animated.View className="absolute bottom-5 right-4 z-10" style={scrollButtonStyle}>
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
        </View>

        <View>
          <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
            <MessageInput
              ref={messageInputRef}
              onSend={handleSendText}
              onSendMedia={handleSendMedia}
              onChangeText={handleTyping}
              onFocusChange={handleComposerFocusChange}
              replyTo={replyToMessage}
              onCancelReply={handleCancelReply}
            />
          </KeyboardStickyView>
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
