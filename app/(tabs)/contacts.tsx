import { MaterialIcons } from '@expo/vector-icons'
import { FlashList as OriginalFlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { conversationApi } from '../../src/api/conversation.api'
import { useContacts } from '../../src/hooks/useContacts'
import { cn } from '../../src/lib/cn'
import { useChatStore } from '../../src/stores/chatStore'
import type { UserSession } from '../../src/types/user.types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FlashList = OriginalFlashList as any

export default function ContactsScreen() {
  const [search, setSearch] = useState('')

  const { data, isLoading, fetchNextPage, hasNextPage } = useContacts(search)
  const { onlineUsers } = useChatStore()
  const router = useRouter()

  const users = data?.pages.flatMap((page) => page?.users || []) || []

  const handleUserPress = async (user: UserSession) => {
    try {
      const conv = await conversationApi.create({
        participantIds: [user.id],
        type: 'DIRECT',
      })
      router.push(`/conversation/${conv.id}`)
    } catch (err) {
      console.error(err)
    }
  }

  const renderItem = ({ item }: { item: UserSession }) => {
    if (!item) return null
    const isOnline = onlineUsers.has(item.id)

    return (
      <TouchableOpacity
        className="mx-4"
        onPress={() => handleUserPress(item)}
        activeOpacity={0.7}
      >
        <View className="flex-row items-center py-3">
          {/* Avatar with online badge */}
          <View className="relative mr-3">
            <View className="w-12 h-12 rounded-avatar bg-surface-card items-center justify-center">
              <Text className="text-text-primary font-bold text-lg">
                {item.firstName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View
              className={cn(
                'absolute bottom-[-2px] right-[-2px] w-3.5 h-3.5 rounded-full border-2 border-bg-primary',
                isOnline ? 'bg-status-online' : 'bg-text-muted',
              )}
            />
          </View>

          {/* Info */}
          <View className="flex-1 justify-center">
            <Text className="text-text-primary font-semibold text-md mb-1" numberOfLines={1}>
              {item.firstName} {item.lastName}
            </Text>
            <Text
              className={cn(
                'font-sans text-sm2',
                isOnline ? 'text-status-online' : 'text-text-muted',
              )}
            >
              {isOnline ? 'Active Now' : 'Offline'}
            </Text>
          </View>

          {/* Action icon */}
          <View className="w-10 h-10 items-center justify-center">
            <MaterialIcons name="chat-bubble" size={24} color="#0A7CFF" />
          </View>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      {/* Header */}
      <View className="px-4 pt-4 z-10">
        <Text className="text-text-primary font-bold text-display">Contacts</Text>

        {/* Search bar */}
        <View className="flex-row items-center bg-surface-card rounded-full h-10 mt-4 px-3">
          <MaterialIcons name="search" size={20} color="#64748b" style={{ marginRight: 8 }} />
          <TextInput
            className="flex-1 text-text-primary font-sans text-md h-full"
            value={search}
            onChangeText={setSearch}
            placeholder="Search users..."
            placeholderTextColor="#64748b"
          />
        </View>
      </View>

      {/* List */}
      <View className="flex-1 pt-2 z-10">
        {isLoading ? (
          <ActivityIndicator color="#0A7CFF" size="large" className="flex-1 justify-center" />
        ) : (
          <FlashList
            data={users}
            renderItem={renderItem}
            keyExtractor={(item: UserSession, index: number) => item?.id || index.toString()}
            estimatedItemSize={80}
            showsVerticalScrollIndicator={false}
            onEndReached={() => {
              if (hasNextPage) fetchNextPage()
            }}
            onEndReachedThreshold={0.5}
            ListEmptyComponent={
              <View className="items-center p-8">
                <Text className="text-text-secondary font-sans text-base2">No contacts found</Text>
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  )
}
