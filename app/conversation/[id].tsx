import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Text, TouchableOpacity, View } from 'react-native'
import {
  KeyboardStickyView,
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
} from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { MessageBubble } from '../../src/components/chat/MessageBubble'
import { MessageInput } from '../../src/components/chat/MessageInput'
import { queryKeys } from '../../src/constants/queryKeys'
import { useRecallMessage } from '../../src/hooks/useMessageActions'
import { useMessages, useSendBotMessage, useSendMessage } from '../../src/hooks/useMessages'
import { cn } from '../../src/lib/cn'
import { useSocket } from '../../src/providers/SocketProvider'
import { useAuthStore } from '../../src/stores/authStore'
import { useCallStore } from '../../src/stores/callStore'
import { useChatStore } from '../../src/stores/chatStore'

import type { ChatParticipant, Conversation, Message } from '../../src/types/conversation.types'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

const formatSeparatorDate = (dateString: string) => {
  const date = new Date(dateString)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'

  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
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
      entering={FadeIn}
      exiting={FadeOut}
      className="flex-row items-center px-4 py-2 mb-2"
    >
      <Text className="text-text-muted text-xs italic mr-1">{displayName} is typing</Text>
      <View className="flex-row items-end pb-[2px]">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </View>
    </Animated.View>
  )
}

const KeyboardListSpacer = ({ gap, openedOffset }: { gap: number; openedOffset: number }) => {
  const { height, progress } = useReanimatedKeyboardAnimation()

  const style = useAnimatedStyle(
    () => ({
      height: Math.max(0, -height.value) - progress.value * openedOffset + gap,
    }),
    [gap, openedOffset],
  )

  return <Animated.View pointerEvents="none" style={style} />
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const {
    optimisticMessages,
    typingUsers,
    replyToMessage,
    setReplyToMessage,
    isBotConversation,
    confirmMessage,
    dequeueOfflineMessage,
  } = useChatStore()
  const isBot = isBotConversation(id as string)
  const queryClient = useQueryClient()

  const { socket } = useSocket()
  const [isOnline, setIsOnline] = useState(false)

  const { data, isLoading, fetchNextPage, hasNextPage } = useMessages(id as string)
  const { mutate: sendMessage } = useSendMessage(id as string)
  const { mutate: sendBotMessage } = useSendBotMessage(id as string)
  const { mutate: recallMessage } = useRecallMessage(id as string)
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)

  const listRef = useRef<FlatList>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const typingTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)

  const serverMessages = (data?.pages.flat() as Message[]) || []
  const localOptimistic = optimisticMessages[id as string] || []

  const startCall = useCallStore((state) => state.startCall)

  const allMessages = useMemo(() => {
    const serverIds = new Set(serverMessages.map((m: Message) => m?.id))
    const serverClientMessageIds = new Set(
      serverMessages
        .map((message: Message) => message?.clientMessageId)
        .filter((clientMessageId): clientMessageId is string => Boolean(clientMessageId)),
    )

    const pendingMessages = localOptimistic.filter((m: Message) => {
      if (!m) return false
      if (serverIds.has(m.id)) return false
      if (serverClientMessageIds.has(m.id)) return false
      return true
    })

    const combinedMessages = [...pendingMessages, ...serverMessages].sort(
      (a, b) => new Date(b?.createdAt).getTime() - new Date(a?.createdAt).getTime(),
    )

    const dedupedMessages = new Map<string, Message>()

    combinedMessages.forEach((message) => {
      if (!message?.id) return

      const existing = dedupedMessages.get(message.id)
      if (!existing) {
        dedupedMessages.set(message.id, message)
        return
      }

      // Keep a single message instance per id while preserving the richer payload.
      dedupedMessages.set(message.id, { ...message, ...existing })
    })

    return Array.from(dedupedMessages.values())
  }, [serverMessages, localOptimistic])

  useEffect(() => {
    if (serverMessages.length === 0 || localOptimistic.length === 0) {
      return
    }

    const optimisticIds = new Set(localOptimistic.map((message) => message.id))

    serverMessages.forEach((message) => {
      if (message.clientMessageId && optimisticIds.has(message.clientMessageId)) {
        confirmMessage(message.clientMessageId, message)
        dequeueOfflineMessage(message.clientMessageId)
      }
    })
  }, [confirmMessage, dequeueOfflineMessage, localOptimistic, serverMessages])

  const prevFirstMessageId = useRef(allMessages[0]?.id)
  const insets = useSafeAreaInsets()
  const messageInputGap = 12

  const activeTypers = typingUsers[id as string] || []
  const isOtherUserTyping = activeTypers.some((typerId) => typerId !== user?.id)

  useEffect(() => {
    if (socket?.connected) {
      socket.emit('join_conversation', id)
      socket.emit('mark_seen', id)
    }

    return () => {}
  }, [socket, socket?.connected, id])

  useEffect(() => {
    const currentFirstMessageId = allMessages[0]?.id

    if (currentFirstMessageId && currentFirstMessageId !== prevFirstMessageId.current) {
      if (!showScrollButton || allMessages[0]?.senderId === user?.id) {
        scrollToBottom()
      }

      if (socket?.connected) {
        socket.emit('mark_seen', id)
      }
    }

    prevFirstMessageId.current = currentFirstMessageId
  }, [allMessages, showScrollButton, socket, id, user?.id])

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y
    setShowScrollButton(offsetY > 200)
  }, [])

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
  }, [])

  const cachedData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)
  const allConversations: Conversation[] = Array.isArray(cachedData)
    ? (cachedData as Conversation[])
    : (cachedData as { pages?: Conversation[][] })?.pages?.flat() || []
  const currentConversation = allConversations.find((c: Conversation) => c?.id === id)

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

  useEffect(() => {
    if (!socket || !otherUserId || currentConversation?.isGroup) return

    socket.emit('check_presence', { userId: otherUserId })

    const handlePresence = (data: { userId: string; isOnline: boolean }) => {
      if (data.userId === otherUserId) {
        setIsOnline(data.isOnline)
      }
    }

    socket.on('presence_update', handlePresence)

    return () => {
      socket.off('presence_update', handlePresence)
    }
  }, [socket, otherUserId, currentConversation?.isGroup])

  const handleVoiceCall = () => {
    startCall(id as string, displayName, false, avatarUrl)
    router.push(`/call/${id}?type=voice` as never)
  }

  const handleVideoCall = () => {
    startCall(id as string, displayName, true, avatarUrl)
    router.push(`/call/${id}?type=video` as never)
  }

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
      conversationId: id as string,
      senderId: user.id,
      sender: user,
      content: uri,
      type: type,
      status: 'SENT',
      createdAt: now,
      updatedAt: now,
    }

    useChatStore.getState().addOptimisticMessage(id as string, tempMessage)
  }

  const handleTyping = useCallback(
    (text: string) => {
      if (!socket?.connected) return

      if (!text.trim()) {
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current)
          typingTimeoutRef.current = null
        }
        socket.emit('typing_stop', id)
        return
      }

      socket.emit('typing_start', id)

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }

      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing_stop', id)
        typingTimeoutRef.current = null
      }, 2000)
    },
    [socket, id],
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
      socket?.emit('typing_stop', id)
    },
    [sendMessage, socket, id],
  )

  const handleSend = useCallback(
    (text: string, replyToId?: string) => {
      if (isBot) {
        sendBotMessage({ content: text })
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current)
          typingTimeoutRef.current = null
        }
        socket?.emit('typing_stop', id)
        return
      }

      handleSendText(text, replyToId)
    },
    [handleSendText, id, isBot, sendBotMessage, socket],
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

  const handleScrollToMessage = useCallback(
    (replyToId?: string) => {
      if (!replyToId) return

      const index = allMessages.findIndex((m) => m.id === replyToId)
      if (index !== -1) {
        listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        })
      }
    },
    [allMessages],
  )

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }

      if (socket?.connected) {
        socket.emit('typing_stop', id)
      }
    }
  }, [socket, id])

  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      if (!item) return null

      const isOwn = item?.senderId === user?.id
      const previousMessage = allMessages[index + 1]
      const nextMessage = allMessages[index - 1]

      let showDateSeparator = false
      if (!previousMessage) {
        showDateSeparator = true
      } else {
        const currentDay = new Date(item.createdAt).setHours(0, 0, 0, 0)
        const prevDay = new Date(previousMessage.createdAt).setHours(0, 0, 0, 0)
        if (currentDay !== prevDay) showDateSeparator = true
      }

      let isNextDay = false
      if (nextMessage) {
        const currentDay = new Date(item.createdAt).setHours(0, 0, 0, 0)
        const nextDay = new Date(nextMessage.createdAt).setHours(0, 0, 0, 0)
        if (currentDay !== nextDay) isNextDay = true
      }

      const FIVE_MINS = 5 * 60 * 1000
      const timeGapPrev = previousMessage
        ? new Date(item.createdAt).getTime() - new Date(previousMessage.createdAt).getTime()
        : 0
      const timeGapNext = nextMessage
        ? new Date(nextMessage.createdAt).getTime() - new Date(item.createdAt).getTime()
        : 0

      const isGroupedTop =
        previousMessage?.senderId === item.senderId && timeGapPrev < FIVE_MINS && !showDateSeparator
      const isGroupedBottom =
        nextMessage?.senderId === item.senderId && timeGapNext < FIVE_MINS && !isNextDay

      const showAvatar = nextMessage?.senderId !== item.senderId || isNextDay

      return (
        <View>
          {showDateSeparator && (
            <View className="items-center my-4">
              <Text
                className="text-text-muted text-xs2 font-medium px-3 py-1 overflow-hidden"
                style={{ borderRadius: 12 }}
              >
                {formatSeparatorDate(item.createdAt)}
              </Text>
            </View>
          )}
          <MessageBubble
            message={item}
            isOwn={isOwn}
            showAvatar={showAvatar}
            isGroupedTop={isGroupedTop}
            isGroupedBottom={isGroupedBottom}
            isExpanded={expandedMessageId === item.id}
            onToggleDetails={() => handleToggleDetails(item.id)}
            onPressReplyPreview={() => handleScrollToMessage(item.replyToId)}
            onReply={() => handleReply(item)}
            onRecall={() => handleRecall(item.id)}
            conversationId={id}
          />
        </View>
      )
    },
    [user?.id, allMessages, expandedMessageId, handleToggleDetails, handleScrollToMessage],
  )

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top', 'bottom']}>
      <View className="flex-1 z-10">
        <View className="flex-row items-center justify-between bg-bg-primary border-b border-border-default px-2 pt-2 pb-2.5 z-10">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={() => router.back()}
              className="flex-row items-center px-1"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialIcons name="chevron-left" size={28} color="#1C1C1E" />
              <Text className="text-text-primary font-medium text-md -ml-1">Chat</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            className="items-center flex-1"
            onPress={() => router.push(`/conversation/${id}/info` as never)}
            activeOpacity={0.7}
          >
            <Text className="text-text-primary font-semibold text-md" numberOfLines={1}>
              {displayName}
            </Text>
            {!currentConversation?.isGroup && (
              <Text
                className={cn(
                  'text-xs2 mt-0.5',
                  isOnline ? 'text-status-online' : 'text-text-muted',
                )}
              >
                {isOnline ? 'Online' : 'Offline'}
              </Text>
            )}
          </TouchableOpacity>

          <View className="flex-row items-center pr-2">
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} className="w-9 h-9 rounded-full" />
            ) : (
              <View className="w-9 h-9 rounded-full bg-surface-card items-center justify-center">
                <Text className="text-text-primary font-semibold text-sm2">
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View className="flex-1">
          {isLoading && serverMessages.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color="#FF6B2C" size="large" />
            </View>
          ) : (
            <>
              <FlatList
                ref={listRef}
                data={allMessages}
                extraData={expandedMessageId}
                renderItem={renderItem}
                keyExtractor={(item: Message, index: number) =>
                  item?.id ? item.id.toString() : `fallback-${index}`
                }
                onEndReached={() => {
                  if (hasNextPage) fetchNextPage()
                }}
                onEndReachedThreshold={0.5}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                inverted
                onContentSizeChange={() => {
                  if (!showScrollButton) {
                    scrollToBottom()
                  }
                }}
                ListHeaderComponent={
                  <View>
                    {isOtherUserTyping ? <TypingIndicator displayName={displayName} /> : null}
                    <KeyboardListSpacer gap={messageInputGap} openedOffset={insets.bottom} />
                  </View>
                }
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={true}
                initialNumToRender={20}
                maxToRenderPerBatch={10}
                windowSize={10}
                updateCellsBatchingPeriod={50}
                onScrollToIndexFailed={(info) => {
                  const wait = new Promise((resolve) => setTimeout(resolve, 500))
                  wait.then(() => {
                    listRef.current?.scrollToIndex({
                      index: info.index,
                      animated: true,
                      viewPosition: 0.5,
                    })
                  })
                }}
              />
              {showScrollButton && (
                <Animated.View
                  entering={FadeIn}
                  exiting={FadeOut}
                  className="absolute bottom-5 right-4 z-10"
                >
                  <TouchableOpacity
                    className="w-10 h-10 rounded-full bg-bg-primary border border-border-default items-center justify-center"
                    onPress={scrollToBottom}
                    activeOpacity={0.8}
                    style={{
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.1,
                      shadowRadius: 4,
                      elevation: 3,
                    }}
                  >
                    <MaterialIcons name="keyboard-arrow-down" size={24} color="#1C1C1E" />
                  </TouchableOpacity>
                </Animated.View>
              )}
            </>
          )}
        </View>

        <KeyboardStickyView offset={{ opened: insets.bottom }}>
          <MessageInput
            onSend={handleSend}
            onSendMedia={handleSendMedia}
            onChangeText={handleTyping}
            replyTo={replyToMessage}
            onCancelReply={handleCancelReply}
          />
        </KeyboardStickyView>
      </View>
    </SafeAreaView>
  )
}
