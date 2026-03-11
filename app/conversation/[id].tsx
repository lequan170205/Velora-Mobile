import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { MessageBubble } from '../../src/components/chat/MessageBubble'
import { MessageInput } from '../../src/components/chat/MessageInput'
import { queryKeys } from '../../src/constants/queryKeys'
import { useMessages, useSendMessage } from '../../src/hooks/useMessages'
import { useAuthStore } from '../../src/stores/authStore'
import { useCallStore } from '../../src/stores/callStore'
import { useChatStore } from '../../src/stores/chatStore'
import type { Message } from '../../src/types/conversation.types'

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { optimisticMessages } = useChatStore()
  const queryClient = useQueryClient()

  const { data, isLoading, fetchNextPage, hasNextPage } = useMessages(id as string)
  const { mutate: sendMessage } = useSendMessage(id as string)

  const listRef = useRef<FlatList>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const serverMessages = (data?.pages.flat() as Message[]) || []
  const localOptimistic = optimisticMessages[id as string] || []
  const serverIds = new Set(serverMessages.map((m) => m?.id))
  const pendingMessages = localOptimistic.filter((m) => m && !serverIds.has(m.id))
  const startCall = useCallStore((state) => state.startCall)

  const allMessages = [...pendingMessages, ...serverMessages].sort(
    (a, b) => new Date(b?.createdAt).getTime() - new Date(a?.createdAt).getTime(),
  )

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y
    setShowScrollButton(offsetY > 200)
  }

  const scrollToBottom = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
  }

  const cachedData = queryClient.getQueryData<any>(queryKeys.conversations.all)
  const allConversations = Array.isArray(cachedData) ? cachedData : cachedData?.pages?.flat() || []
  const currentConversation = allConversations.find((c: any) => c.id === id)

  let displayName = 'Unknown'
  let avatarUrl: string | undefined = undefined

  if (currentConversation) {
    if (!currentConversation.isGroup) {
      const otherUser = currentConversation.participants?.find((p: any) => p.id !== user?.id)
      if (otherUser) {
        displayName = otherUser.email || 'Unknown'
        avatarUrl = otherUser.picture
      }
    } else {
      displayName = currentConversation.name || 'Group Chat'
      avatarUrl = currentConversation.picture
    }
  }

  const isOnline = true

  const handleVoiceCall = () => {
    startCall(displayName, false, avatarUrl)
    router.push(`/call/${id}?type=voice` as any)
  }

  const handleVideoCall = () => {
    startCall(displayName, true, avatarUrl)
    router.push(`/call/${id}?type=video` as any)
  }

  const handleSendMedia = async (uri: string, type: 'IMAGE' | 'FILE', fileInfo: any) => {
    Alert.alert('Media Selected', `Type: ${type}\nName: ${fileInfo.fileName || 'file'}`)
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1 z-10"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header — iOS shadow kept as inline: NativeWind limitation */}
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
          {/* Left: back + user info */}
          <View className="flex-1 flex-row items-center">
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-10 h-10 items-center justify-center"
            >
              <MaterialIcons name="arrow-back-ios" size={20} color="#0A7CFF" />
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-1 flex-row items-center ml-1"
              onPress={() => router.push(`/conversation/${id}/info` as any)}
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
                <Text className="text-text-muted text-xs2 mt-0.5">
                  {isOnline ? 'Active now' : 'Offline'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Right: call actions */}
          <View className="flex-row items-center gap-4 pr-2">
            <TouchableOpacity className="items-center justify-center" onPress={handleVoiceCall}>
              <MaterialIcons name="call" size={24} color="#0A7CFF" />
            </TouchableOpacity>
            <TouchableOpacity className="items-center justify-center" onPress={handleVideoCall}>
              <MaterialIcons name="videocam" size={26} color="#0A7CFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Message list */}
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
                renderItem={({ item }: { item: Message }) => {
                  if (!item) return null
                  return <MessageBubble message={item} isOwn={item.senderId === user?.id} />
                }}
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
                contentContainerStyle={{ paddingVertical: 16 }}
                showsVerticalScrollIndicator={false}
              />
              {showScrollButton && (
                <TouchableOpacity
                  className="absolute bottom-5 right-4 w-10 h-10 rounded-full bg-surface-focus border border-[#333333] items-center justify-center z-10"
                  onPress={scrollToBottom}
                  activeOpacity={0.8}
                  style={{
                    // NativeWind limitation: iOS shadow
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 0.4,
                    shadowRadius: 4,
                    elevation: 5,
                  }}
                >
                  <MaterialIcons name="keyboard-arrow-down" size={24} color="#f8fafc" />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        <MessageInput onSend={(text) => sendMessage(text)} onSendMedia={handleSendMedia} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
