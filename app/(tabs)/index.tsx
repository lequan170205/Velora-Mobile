import { MaterialIcons } from '@expo/vector-icons'
import React, { useCallback, useMemo, useState } from 'react' // Thêm useState, useMemo
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ConversationItem } from '../../src/components/chat/ConversationItem'
import { useBotChat } from '../../src/hooks/useBotChat'
import { useConversations } from '../../src/hooks/useConversations'
import { useAuthStore } from '../../src/stores/authStore'

import type { ChatParticipant, Conversation } from '../../src/types/conversation.types'

// Extract match avatars from conversation participants
function useMatches(conversations: Conversation[] | undefined) {
  const { user } = useAuthStore()
  if (!conversations) return []

  return conversations
    .filter((c) => !c.isGroup)
    .map((c) => {
      const other = c.participants?.find((p: ChatParticipant) => p.id !== user?.id)
      return other
        ? {
            id: other.id,
            name: other.name || other.email?.split('@')[0] || '?',
            picture: other.picture,
          }
        : null
    })
    .filter(Boolean)
    .slice(0, 10)
}

export default function ConversationsScreen() {
  const { data: conversations, isLoading, isError } = useConversations()
  const { mutate: startBotChat, isPending: isBotLoading } = useBotChat()
  const { user } = useAuthStore() // Lấy user hiện tại để lọc tên người đối diện
  const matches = useMatches(conversations)

  // 1. Thêm state để lưu từ khóa tìm kiếm
  const [searchQuery, setSearchQuery] = useState('')

  const handleBotChat = () => {
    startBotChat('Hello!', {
      onError: () => {
        Alert.alert('Error', 'Could not connect to bot. Please try again.')
      },
    })
  }
  // 2. Thêm logic lọc danh sách hội thoại
  const filteredConversations = useMemo(() => {
    if (!conversations) return []
    if (!searchQuery.trim()) return conversations

    const lowerQuery = searchQuery.toLowerCase()

    return conversations.filter((c) => {
      // Nếu là group chat, tìm theo tên group (nếu bạn có trường name cho group)
      if (c.isGroup && c.name) {
        return c.name.toLowerCase().includes(lowerQuery)
      }

      // Nếu là chat 1-1, tìm theo tên người đối diện
      const otherParticipant = c.participants?.find((p: ChatParticipant) => p.id !== user?.id)
      const otherName = otherParticipant?.name || otherParticipant?.email?.split('@')[0] || ''

      return otherName.toLowerCase().includes(lowerQuery)
    })
  }, [conversations, searchQuery, user?.id])

  const renderConversationItem = useCallback(
    ({ item }: { item: Conversation }) => <ConversationItem conversation={item} />,
    [],
  )

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-primary">
        <ActivityIndicator color="#FF6B2C" size="large" />
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
    <SafeAreaView className="flex-1 bg-bg-primary">
      <FlatList
        // 3. Thay data từ conversations thành danh sách đã lọc
        data={filteredConversations}
        renderItem={renderConversationItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={10}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={true}
        ListHeaderComponent={
          <View>
            {/* Matches Section */}
            <View className="pt-2 pb-3">
              <Text className="text-text-secondary font-medium text-xs2 tracking-widest uppercase px-5 mb-3">
                MATCHES
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 16 }}
              >
                {matches.map((match: any) => (
                  <View key={match.id} className="items-center" style={{ width: 64 }}>
                    {match.picture ? (
                      <Image
                        source={{ uri: match.picture }}
                        className="w-14 h-14 rounded-full bg-surface-card"
                        resizeMode="cover"
                      />
                    ) : (
                      <View className="w-14 h-14 rounded-full bg-surface-card items-center justify-center">
                        <Text className="text-text-primary font-semibold text-xl">
                          {match.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Text
                      className="text-text-primary font-medium text-xs2 mt-1.5"
                      numberOfLines={1}
                    >
                      {match.name}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>

            {/* Search Bar */}
            <View className="px-5 mb-4">
              <View className="flex-row items-center bg-surface-card rounded-full px-4 py-2.5">
                <TextInput
                  placeholder="Search"
                  placeholderTextColor="#AEAEB2"
                  className="flex-1 text-text-primary font-sans text-base"
                  // 4. Bỏ editable={false} và thêm value + onChangeText
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                <MaterialIcons name="search" size={20} color="#AEAEB2" />
              </View>
            </View>

            {/* Chat Section Header */}
            <Text className="text-text-secondary font-medium text-xs2 tracking-widest uppercase px-5 mb-2">
              CHAT
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center p-8">
            <Text className="text-text-secondary font-sans text-base2">
              {searchQuery.trim() !== ''
                ? 'No matches found.'
                : 'No conversations yet. Start chatting!'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}
