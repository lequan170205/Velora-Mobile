import { MaterialIcons } from '@expo/vector-icons'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  PanResponder,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { ConversationItem } from '../../src/components/chat/ConversationItem'
import { useBotChat } from '../../src/hooks/useBotChat'
import { useConversations } from '../../src/hooks/useConversations'
import { useAuthStore } from '../../src/stores/authStore'

import type { ChatParticipant, Conversation } from '../../src/types/conversation.types'

interface MatchSummary {
  id: string
  name: string
  picture?: string
}

function useMatches(conversations: Conversation[] | undefined): MatchSummary[] {
  const { user } = useAuthStore()
  if (!conversations) return []

  return conversations
    .filter((conversation) => !conversation.isGroup)
    .flatMap((conversation) => {
      const other = conversation.participants?.find(
        (participant: ChatParticipant) => participant.id !== user?.id,
      )

      if (!other) return []

      const match: MatchSummary = {
        id: other.id,
        name: other.name || other.email?.split('@')[0] || '?',
        ...(other.picture && { picture: other.picture }),
      }
      return [match]
    })
    .slice(0, 10)
}

export default function ConversationsScreen() {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const { data: conversations, isLoading, isError } = useConversations()
  const { mutate: startBotChat, isPending: isBotLoading } = useBotChat()
  const { user } = useAuthStore()
  const matches = useMatches(conversations)
  const [searchQuery, setSearchQuery] = useState('')

  const fabSize = 56
  const fabMargin = 20
  const initialFabPosition = useMemo(
    () => ({
      x: Math.max(fabMargin, width - fabSize - fabMargin),
      y: Math.max(fabMargin, height - insets.bottom - fabSize - 96),
    }),
    [fabSize, fabMargin, height, insets.bottom, width],
  )
  const fabPosition = useRef(new Animated.ValueXY(initialFabPosition)).current
  const currentFabPosition = useRef(initialFabPosition)
  const hasMovedFab = useRef(false)

  useEffect(() => {
    if (hasMovedFab.current) return

    fabPosition.setValue(initialFabPosition)
    currentFabPosition.current = initialFabPosition
  }, [fabPosition, initialFabPosition])

  useEffect(() => {
    const listenerId = fabPosition.addListener((value) => {
      currentFabPosition.current = value
    })

    return () => {
      fabPosition.removeListener(listenerId)
    }
  }, [fabPosition])

  const settleFabPosition = useCallback(() => {
    fabPosition.flattenOffset()

    const minX = fabMargin
    const maxX = Math.max(minX, width - fabSize - fabMargin)
    const minY = insets.top + fabMargin
    const maxY = Math.max(minY, height - insets.bottom - fabSize - 88)
    const nextPosition = {
      x: Math.min(Math.max(currentFabPosition.current.x, minX), maxX),
      y: Math.min(Math.max(currentFabPosition.current.y, minY), maxY),
    }

    Animated.spring(fabPosition, {
      toValue: nextPosition,
      useNativeDriver: false,
    }).start()
  }, [fabMargin, fabPosition, fabSize, height, insets.bottom, insets.top, width])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4,
        onPanResponderGrant: () => {
          hasMovedFab.current = true
          fabPosition.extractOffset()
        },
        onPanResponderMove: Animated.event([null, { dx: fabPosition.x, dy: fabPosition.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: settleFabPosition,
        onPanResponderTerminate: settleFabPosition,
      }),
    [fabPosition, settleFabPosition],
  )

  const handleBotChat = () => {
    startBotChat(undefined, {
      onError: () => {
        Alert.alert('Error', 'Could not open bot conversation. Please try again.')
      },
    })
  }

  const filteredConversations = useMemo(() => {
    if (!conversations) return []
    if (!searchQuery.trim()) return conversations

    const lowerQuery = searchQuery.toLowerCase()

    return conversations.filter((conversation) => {
      if (conversation.isGroup && conversation.name) {
        return conversation.name.toLowerCase().includes(lowerQuery)
      }

      const otherParticipant = conversation.participants?.find(
        (participant: ChatParticipant) => participant.id !== user?.id,
      )
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
            <View className="pt-2 pb-3">
              <Text className="text-text-secondary font-medium text-xs2 tracking-widest uppercase px-5 mb-3">
                MATCHES
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 16 }}
              >
                {matches.map((match) => (
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

            <View className="px-5 mb-4">
              <View className="flex-row items-center bg-surface-card rounded-full px-4 py-4">
                <TextInput
                  placeholder="Search"
                  placeholderTextColor="#AEAEB2"
                  className="flex-1 text-text-primary font-sans text-base"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                <MaterialIcons name="search" size={20} color="#AEAEB2" />
              </View>
            </View>

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

      <Animated.View
        className="absolute z-20"
        style={{
          transform: fabPosition.getTranslateTransform(),
        }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          className="w-14 h-14 rounded-full bg-brand items-center justify-center"
          onPress={handleBotChat}
          disabled={isBotLoading}
          activeOpacity={0.85}
          style={{
            width: fabSize,
            height: fabSize,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.28,
            shadowRadius: 10,
            elevation: 8,
          }}
        >
          {isBotLoading ? (
            <ActivityIndicator color="#f8fafc" size="small" />
          ) : (
            <MaterialIcons name="smart-toy" size={26} color="#f8fafc" />
          )}
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  )
}
