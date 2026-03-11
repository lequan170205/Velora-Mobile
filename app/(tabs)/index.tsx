import { MaterialIcons } from '@expo/vector-icons'
import { FlashList } from '@shopify/flash-list'
import React from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ConversationItem } from '../../src/components/chat/ConversationItem'
import { useConversations } from '../../src/hooks/useConversations'

export default function ConversationsScreen() {
  const { data: conversations, isLoading, isError } = useConversations()

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-primary">
        <ActivityIndicator color="#0A7CFF" size="large" />
      </View>
    )
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-primary">
        <Text className="text-status-error font-medium text-md">Failed to load conversations</Text>
      </View>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-4 pb-4 z-10">
        <Text className="text-text-primary font-bold text-display">Messages</Text>
        <TouchableOpacity className="w-10 h-10 rounded-full bg-surface-card items-center justify-center">
          <MaterialIcons name="edit" size={24} color="#f8fafc" />
        </TouchableOpacity>
      </View>

      {/* List */}
      <View className="flex-1 z-10">
        <FlashList
          data={conversations || []}
          renderItem={({ item }) => <ConversationItem conversation={item} />}
          keyExtractor={(item) => item.id}
          // @ts-expect-error FlashList types mismatch
          estimatedItemSize={100}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View className="items-center p-8">
              <Text className="text-text-secondary font-sans text-base2">
                No conversations yet. Start chatting!
              </Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  )
}
