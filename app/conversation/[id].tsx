import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { ActivityIndicator, FlatList, Image, Text, TouchableOpacity, View } from 'react-native'
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedKeyboard,
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
import { useMessages, useSendMessage } from '../../src/hooks/useMessages'
import { useSocket } from '../../src/providers/SocketProvider'
import { useAuthStore } from '../../src/stores/authStore'
import { useCallStore } from '../../src/stores/callStore'
import { useChatStore } from '../../src/stores/chatStore'
import type { ChatParticipant, Conversation, Message } from '../../src/types/conversation.types'

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

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { optimisticMessages, typingUsers } = useChatStore()
  const queryClient = useQueryClient()

  const { socket } = useSocket()
  const [isOnline, setIsOnline] = useState(false)

  const { data, isLoading, fetchNextPage, hasNextPage } = useMessages(id as string)
  const { mutate: sendMessage } = useSendMessage(id as string)

  const listRef = useRef<FlatList>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const typingTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)

  const serverMessages = (data?.pages.flat() as Message[]) || []
  const localOptimistic = optimisticMessages[id as string] || []

  const startCall = useCallStore((state) => state.startCall)

  const allMessages = useMemo(() => {
    const serverIds = new Set(serverMessages.map((m: Message) => m?.id))
    const pendingMessages = localOptimistic.filter((m: Message) => m && !serverIds.has(m.id))

    return [...pendingMessages, ...serverMessages].sort(
      (a, b) => new Date(b?.createdAt).getTime() - new Date(a?.createdAt).getTime(),
    )
  }, [serverMessages, localOptimistic])

  const prevFirstMessageId = useRef(allMessages[0]?.id)

  const keyboard = useAnimatedKeyboard()
  const insets = useSafeAreaInsets()

  const animatedKeyboardStyle = useAnimatedStyle(() => {
    return {
      paddingBottom: Math.max(0, keyboard.height.value - insets.bottom),
    }
  })

  const activeTypers = typingUsers[id as string] || []
  const isOtherUserTyping = activeTypers.some((typerId) => typerId !== user?.id)

  useEffect(() => {
    if (socket?.connected) {
      socket.emit('join_conversation', id)
      socket.emit('mark_seen', id)
    }
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

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y
    setShowScrollButton(offsetY > 200)
  }

  const scrollToBottom = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
  }

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
        displayName = otherUser.email || 'Unknown'
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
      sender: user as any,
      content: uri,
      type: type,
      status: 'SENT',
      createdAt: now,
      updatedAt: now,
    }

    useChatStore.getState().addOptimisticMessage(id as string, tempMessage)
  }

  const handleTyping = () => {
    if (!socket?.connected) return

    socket.emit('typing_start', id)

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing_stop', id)
    }, 2000)
  }

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
                className="text-text-muted text-xs2 font-medium bg-surface-card px-3 py-1 overflow-hidden"
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
          />
        </View>
      )
    },
    [user?.id, allMessages],
  )

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top', 'bottom']}>
      <Animated.View className="flex-1 z-10" style={animatedKeyboardStyle}>
        <View
          className="flex-row items-center justify-between bg-bg-primary border-b border-surface-card px-2 pt-2 pb-2.5 z-10"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
            shadowRadius: 3,
            elevation: 4,
          }}
        >
          <View className="flex-1 flex-row items-center">
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-10 h-10 items-center justify-center"
            >
              <MaterialIcons name="arrow-back-ios" size={20} color="#0A7CFF" />
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-1 flex-row items-center ml-1"
              onPress={() => router.push(`/conversation/${id}/info` as never)}
              activeOpacity={0.7}
            >
              <View className="relative">
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    className="w-9 h-9"
                    style={{ borderRadius: 18 }}
                  />
                ) : (
                  <View className="w-9 h-9 rounded-avatar-sm bg-surface-focus items-center justify-center">
                    <Text className="text-text-primary font-semibold text-sm2">
                      {displayName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                {isOnline && (
                  <View className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-call-green border-2 border-bg-primary" />
                )}
              </View>

              <View className="flex-1 justify-center ml-2.5">
                <Text className="text-text-primary font-semibold text-md" numberOfLines={1}>
                  {displayName}
                </Text>
                {!currentConversation?.isGroup && (
                  <Text className="text-text-muted text-xs2 mt-0.5">
                    {isOnline ? 'Active now' : 'Offline'}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center gap-4 pr-2">
            <TouchableOpacity className="items-center justify-center" onPress={handleVoiceCall}>
              <MaterialIcons name="call" size={24} color="#0A7CFF" />
            </TouchableOpacity>
            <TouchableOpacity className="items-center justify-center" onPress={handleVideoCall}>
              <MaterialIcons name="videocam" size={26} color="#0A7CFF" />
            </TouchableOpacity>
          </View>
        </View>

        <View className="flex-1">
          {isLoading && serverMessages.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color="#0A7CFF" size="large" />
            </View>
          ) : (
            <>
              <FlatList
                ref={listRef}
                data={allMessages}
                renderItem={renderItem}
                keyExtractor={(item: Message, index: number) =>
                  item?.id?.toString() || `fallback-${index}`
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
                  isOtherUserTyping ? <TypingIndicator displayName={displayName} /> : null
                }
                showsVerticalScrollIndicator={false}
              />
              {showScrollButton && (
                <Animated.View
                  entering={FadeIn}
                  exiting={FadeOut}
                  className="absolute bottom-5 right-4 z-10"
                >
                  <TouchableOpacity
                    className="w-10 h-10 rounded-full bg-surface-focus border border-[#333333] items-center justify-center"
                    onPress={scrollToBottom}
                    activeOpacity={0.8}
                    style={{
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 3 },
                      shadowOpacity: 0.4,
                      shadowRadius: 4,
                      elevation: 5,
                    }}
                  >
                    <MaterialIcons name="keyboard-arrow-down" size={24} color="#f8fafc" />
                  </TouchableOpacity>
                </Animated.View>
              )}
            </>
          )}
        </View>

        <MessageInput
          onSend={(text) => {
            sendMessage(text)
            socket?.emit('typing_stop', id)
          }}
          onSendMedia={handleSendMedia}
          onChangeText={handleTyping}
        />
      </Animated.View>
    </SafeAreaView>
  )
}
