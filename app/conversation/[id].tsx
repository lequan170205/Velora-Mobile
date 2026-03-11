import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useRef } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { MessageBubble } from '../../src/components/chat/MessageBubble'
import { MessageInput } from '../../src/components/chat/MessageInput'
import { useMessages, useSendMessage } from '../../src/hooks/useMessages'
import { useAuthStore } from '../../src/stores/authStore'
import { useChatStore } from '../../src/stores/chatStore'
import type { Message } from '../../src/types/conversation.types'

// NativeWind limitation: iOS shadow — cannot express shadowOffset/shadowRadius via className
const headerShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.3,
  shadowRadius: 4,
  elevation: 5,
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { optimisticMessages } = useChatStore()
  const flatListRef = useRef<FlatList<Message>>(null)

  const { data: messagesData, isLoading, fetchNextPage, hasNextPage } = useMessages(id)

  const { mutate: sendMessage } = useSendMessage(id)

  // Pages contain Message[] arrays directly — reverse for oldest-first display
  const serverMessages = messagesData?.pages.flatMap((page) => page ?? []).reverse() ?? []
  const pendingMessages = optimisticMessages[id] ?? []
  const messages = [...serverMessages, ...pendingMessages]

  useEffect(() => {
    if (messages.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: false })
    }
  }, [messages.length])

  const handleSendText = (text: string) => {
    sendMessage(text)
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-bg-primary items-center justify-center">
        <ActivityIndicator color="#0A7CFF" size="large" />
      </View>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Header */}
        <View
          className="flex-row items-center bg-bg-primary border-b border-surface-card px-4 py-3 z-10"
          style={headerShadow}
        >
          <TouchableOpacity
            className="w-10 h-10 items-center justify-center -ml-2 mr-2"
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="arrow-back" size={26} color="#f8fafc" />
          </TouchableOpacity>

          {/* Avatar placeholder */}
          <View className="w-10 h-10 rounded-full bg-surface-card items-center justify-center mr-3">
            <MaterialIcons name="person" size={22} color="#94a3b8" />
          </View>

          <View className="flex-1">
            <Text className="text-text-primary font-semibold text-md" numberOfLines={1}>
              Chat
            </Text>
          </View>

          <View className="flex-row gap-1">
            <TouchableOpacity
              className="w-10 h-10 items-center justify-center rounded-full"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="call" size={22} color="#f8fafc" />
            </TouchableOpacity>
            <TouchableOpacity
              className="w-10 h-10 items-center justify-center rounded-full"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="videocam" size={24} color="#f8fafc" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Message List */}
        <FlatList<Message>
          ref={flatListRef}
          data={messages}
          // NativeWind limitation: FlatList contentContainerStyle is a JS prop (not a component className)
          contentContainerStyle={{ paddingVertical: 12 }}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble message={item} isOwn={item.senderId === user?.id} />
          )}
          showsVerticalScrollIndicator={false}
          onEndReached={() => {
            if (hasNextPage) fetchNextPage()
          }}
          onEndReachedThreshold={0.1}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />

        {/* Input */}
        <MessageInput onSend={handleSendText} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
