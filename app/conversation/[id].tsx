import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Image, Keyboard, Text, TouchableOpacity, View } from 'react-native'
import {
  KeyboardStickyView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller'
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'

import { MessageBubble } from '../../src/components/chat/MessageBubble'
import { MessageInput } from '../../src/components/chat/MessageInput'
import { queryKeys } from '../../src/constants/queryKeys'
import { useRecallMessage } from '../../src/hooks/useMessageActions'
import { useMessages, useSendMessage } from '../../src/hooks/useMessages'
import {
  getMessageIdentityKey,
  getMessageIdentityTokens,
  mergeMessageRecords,
} from '../../src/lib/messageIdentity'
import { useSocket } from '../../src/providers/SocketProvider'
import { useAuthStore } from '../../src/stores/authStore'
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

const MESSAGE_LAYOUT = LinearTransition.springify().damping(18).stiffness(170)

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
    confirmMessage,
    dequeueOfflineMessage,
  } = useChatStore()
  const queryClient = useQueryClient()

  const { socket } = useSocket()
  const [isOnline, setIsOnline] = useState(false)

  const { data, isLoading, fetchNextPage, hasNextPage } = useMessages(id as string)
  const { mutate: sendMessage } = useSendMessage(id as string)
  const { mutate: recallMessage } = useRecallMessage(id as string)
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)
  const [highlightedMessage, setHighlightedMessage] = useState<{
    id: string
    token: number
  } | null>(null)
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [listViewportHeight, setListViewportHeight] = useState(0)

  const listRef = useRef<FlatList>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const typingTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const replyHighlightTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const highlightResetTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)
  const pendingReplyTargetIdRef = useRef<string | null>(null)
  const keyboardHeightRef = useRef(0)
  const listViewportHeightRef = useRef(0)
  const [isTransitioning, setIsTransitioning] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setIsTransitioning(false), 350)
    return () => clearTimeout(timer)
  }, [])

  const serverMessages = useMemo(() => {
    const flat = (data?.pages.flat() as Message[]) || []

    return isTransitioning ? flat.slice(0, 20) : flat
  }, [data, isTransitioning])

  const localOptimistic = useMemo(() => {
    return optimisticMessages[id as string] || []
  }, [id, optimisticMessages])

  const allMessages = useMemo(() => {
    const serverIdentityTokens = new Set(
      serverMessages.flatMap((message: Message) => getMessageIdentityTokens(message)),
    )

    const pendingMessages = localOptimistic.filter((m: Message) => {
      if (!m) return false
      if (getMessageIdentityTokens(m).some((token) => serverIdentityTokens.has(token))) return false
      return true
    })

    const combinedMessages = [...pendingMessages, ...serverMessages].sort((a, b) => {
      const timeA = a?.createdAt || ''
      const timeB = b?.createdAt || ''
      return timeB > timeA ? 1 : timeB < timeA ? -1 : 0
    })

    const dedupedMessages = new Map<string, Message>()

    combinedMessages.forEach((message) => {
      const identityKey = getMessageIdentityKey(message)
      if (!identityKey) return

      const existing = dedupedMessages.get(identityKey)
      if (!existing) {
        dedupedMessages.set(identityKey, message)
        return
      }
      dedupedMessages.set(identityKey, mergeMessageRecords(existing, message))
    })

    return Array.from(dedupedMessages.values())
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
          confirmMessage(msg.clientMessageId, msg)
          dequeueOfflineMessage(msg.clientMessageId)
        })
      }
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [confirmMessage, dequeueOfflineMessage, localOptimistic, serverMessages])

  const prevFirstMessageId = useRef(allMessages[0]?.id)
  const messageInputGap = 12

  const activeTypers = typingUsers[id as string] || []
  const isOtherUserTyping = activeTypers.some((typerId) => typerId !== user?.id)
  const isInitialMessagesLoading = isLoading && allMessages.length === 0
  const replyScrollViewPosition = useMemo(() => {
    if (!isKeyboardVisible || !listViewportHeight || !keyboardHeight) {
      return 0.5
    }

    const coveredRatio = Math.min((keyboardHeight + 24) / listViewportHeight, 0.8)

    // The list is inverted, so the visual center of the visible area is mirrored.
    return Math.min(0.9, Math.max(0.68, 0.5 + coveredRatio / 2))
  }, [isKeyboardVisible, keyboardHeight, listViewportHeight])

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
    const timer = setTimeout(() => {
      if (socket?.connected) {
        socket.emit('join_conversation', id)
        socket.emit('mark_seen', id)
        clearConversationUnread(id)
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [clearConversationUnread, id, socket, socket?.connected])

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y
    setShowScrollButton(offsetY > 200)
  }, [])

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
  }, [])

  useEffect(() => {
    const currentFirstMessageId = allMessages[0]?.id

    if (currentFirstMessageId && currentFirstMessageId !== prevFirstMessageId.current) {
      if (!showScrollButton || allMessages[0]?.senderId === user?.id) {
        scrollToBottom()
      }

      if (socket?.connected) {
        socket.emit('mark_seen', id)
        clearConversationUnread(id)
      }
    }

    prevFirstMessageId.current = currentFirstMessageId
  }, [allMessages, clearConversationUnread, id, scrollToBottom, showScrollButton, socket, user?.id])

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
      pendingReplyTargetIdRef.current = null

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
        pendingReplyTargetIdRef.current = null
        return false
      }

      pendingReplyTargetIdRef.current = messageId
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: replyScrollViewPosition,
      })
      scheduleMessageHighlight(messageId)
      return true
    },
    [allMessages, replyScrollViewPosition, scheduleMessageHighlight],
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

  useEffect(() => {
    const keyboardShowListener = Keyboard.addListener('keyboardDidShow', (event) => {
      const height = event.endCoordinates.height
      keyboardHeightRef.current = height
      setIsKeyboardVisible(true)
      setKeyboardHeight(height)

      const pendingId = pendingReplyTargetIdRef.current
      if (pendingId) {
        requestAnimationFrame(() => {
          const index = allMessages.findIndex((m) => m.id === pendingId)
          if (index === -1) return
          const vpHeight = listViewportHeightRef.current
          const coveredRatio = Math.min((height + 24) / vpHeight, 0.8)
          const viewPosition = Math.min(0.9, Math.max(0.68, 0.5 + coveredRatio / 2))
          listRef.current?.scrollToIndex({ index, animated: true, viewPosition })
        })
      }
    })

    const keyboardHideListener = Keyboard.addListener('keyboardDidHide', () => {
      keyboardHeightRef.current = 0
      setIsKeyboardVisible(false)
      setKeyboardHeight(0)
    })

    return () => {
      keyboardShowListener.remove()
      keyboardHideListener.remove()
    }
  }, [allMessages])

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }

      if (socket?.connected) {
        socket.emit('typing_stop', id)
      }

      if (replyHighlightTimeoutRef.current) {
        clearTimeout(replyHighlightTimeoutRef.current)
        replyHighlightTimeoutRef.current = null
      }

      if (highlightResetTimeoutRef.current) {
        clearTimeout(highlightResetTimeoutRef.current)
        highlightResetTimeoutRef.current = null
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
        <Animated.View layout={MESSAGE_LAYOUT}>
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
            isGroupedTop={isGroupedTop}
            isGroupedBottom={isGroupedBottom}
            highlightToken={highlightedMessage?.id === item.id ? highlightedMessage.token : 0}
            isExpanded={expandedMessageId === item.id}
            onToggleDetails={() => handleToggleDetails(item.id)}
            onPressReplyPreview={() => handleScrollToMessage(item.replyToId)}
            onReply={() => handleReply(item)}
            onRecall={() => handleRecall(item.id)}
            conversationId={id}
          />
        </Animated.View>
      )
    },
    [
      user?.id,
      allMessages,
      expandedMessageId,
      highlightedMessage,
      id,
      handleToggleDetails,
      handleScrollToMessage,
      handleReply,
      handleRecall,
    ],
  )

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <View className="flex-1 z-10">
        <View className="border-b border-border-light bg-bg-primary px-4 pb-3 pt-2 z-10">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={() => router.back()}
              className="flex-row items-center py-2 pr-3"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialIcons name="chevron-left" size={24} color="#161616" />
              <Text className="-ml-1 text-md font-medium text-text-primary">Chat</Text>
            </TouchableOpacity>

            <View className="flex-1 items-center px-4">
              <Text className="font-semibold text-md text-text-primary" numberOfLines={1}>
                {displayName}
              </Text>
              {!currentConversation?.isGroup ? (
                <Text className="mt-0.5 text-xs2 text-text-muted">
                  {isOnline ? 'Online' : 'Offline'}
                </Text>
              ) : (
                <Text className="mt-0.5 text-xs2 text-text-muted">Team room</Text>
              )}
            </View>

            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} className="h-11 w-11 rounded-full" />
            ) : (
              <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-input">
                <Text className="text-sm2 font-medium text-text-primary">
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View className="flex-1">
          <FlatList
            ref={listRef}
            onLayout={(event) => {
              const h = event.nativeEvent.layout.height
              listViewportHeightRef.current = h
              setListViewportHeight(h)
            }}
            data={allMessages}
            extraData={`${expandedMessageId ?? ''}:${highlightedMessage?.id ?? ''}:${highlightedMessage?.token ?? 0}`}
            renderItem={renderItem}
            keyExtractor={(item: Message, index: number) =>
              item?.id ? item.id.toString() : `fallback-${index}`
            }
            onEndReached={() => {
              if (hasNextPage && !isInitialMessagesLoading) fetchNextPage()
            }}
            onEndReachedThreshold={0.5}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            inverted
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="automatic"
            onContentSizeChange={() => {
              if (!showScrollButton && allMessages.length > 0) {
                scrollToBottom()
              }
            }}
            ListHeaderComponent={
              <View>
                {isOtherUserTyping ? <TypingIndicator displayName={displayName} /> : null}
                <KeyboardListSpacer gap={messageInputGap} openedOffset={0} />
              </View>
            }
            ListEmptyComponent={isInitialMessagesLoading ? <MessageListLoadingState /> : null}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={true}
            initialNumToRender={20}
            maxToRenderPerBatch={10}
            windowSize={10}
            updateCellsBatchingPeriod={50}
            onScrollToIndexFailed={(info) => {
              const wait = new Promise((resolve) => setTimeout(resolve, 500))
              wait.then(() => {
                const targetMessageId =
                  pendingReplyTargetIdRef.current ?? allMessages[info.index]?.id
                listRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: computeViewPosition(),
                })
                if (targetMessageId) {
                  scheduleMessageHighlight(targetMessageId)
                }
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
          )}
        </View>

        <KeyboardStickyView offset={{ opened: 0 }}>
          <MessageInput
            onSend={handleSendText}
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
