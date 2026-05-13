import { MaterialIcons } from '@expo/vector-icons'
import { useIsFocused } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ConversationItem } from '../../src/components/chat/ConversationItem'
import { useBotChat } from '../../src/hooks/useBotChat'
import { useConversations } from '../../src/hooks/useConversations'
import { prefetchMessages } from '../../src/hooks/useMessages'
import { getNextConversationPreviewRefreshAt } from '../../src/lib/conversationPreviewTime'
import { useAuthStore } from '../../src/stores/authStore'

import type { ChatParticipant, Conversation } from '../../src/types/conversation.types'

const SECTION_ENTERING = FadeInDown.springify().damping(18).stiffness(170)
const MAX_RELATIVE_TIME_DELAY_MS = 24 * 60 * 60 * 1000

interface MatchSummary {
  id: string
  conversationId: string
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

      return [
        {
          id: other.id,
          conversationId: conversation.id,
          name: other.name || other.email?.split('@')[0] || '?',
          ...(other.picture ? { picture: other.picture } : {}),
        },
      ]
    })
    .slice(0, 10)
}

export default function ConversationsScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const isFocused = useIsFocused()
  const { data: conversations, isLoading, isError, refetch } = useConversations()
  const { mutate: startBotChat, isPending: isBotLoading } = useBotChat()

  const matches = useMatches(conversations)

  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [relativeTimeTick, setRelativeTimeTick] = useState(() => Date.now())

  const handleBotChat = () => {
    startBotChat(undefined, {
      onError: () => {
        Alert.alert('Error', 'Could not open bot conversation. Please try again.')
      },
    })
  }

  const filteredConversations = useMemo(() => {
    if (!conversations) return []

    const normalizedQuery = deferredSearchQuery.trim().toLowerCase()
    if (!normalizedQuery) return conversations

    return conversations.filter((conversation) => {
      if (conversation.isGroup && conversation.name) {
        return conversation.name.toLowerCase().includes(normalizedQuery)
      }

      const otherParticipant = conversation.participants?.find(
        (participant: ChatParticipant) => participant.id !== useAuthStore.getState().user?.id,
      )
      const otherName = otherParticipant?.name || otherParticipant?.email?.split('@')[0] || ''

      return otherName.toLowerCase().includes(normalizedQuery)
    })
  }, [conversations, deferredSearchQuery])

  useEffect(() => {
    if (!isFocused) {
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const scheduleNextTick = () => {
      const now = Date.now()
      const nextRefreshAt = filteredConversations.reduce<number | null>(
        (closestRefreshAt, conversation) => {
          if (!conversation.lastMessageAt) {
            return closestRefreshAt
          }

          const refreshAt = getNextConversationPreviewRefreshAt(conversation.lastMessageAt, now)
          if (!refreshAt) {
            return closestRefreshAt
          }

          if (closestRefreshAt === null || refreshAt < closestRefreshAt) {
            return refreshAt
          }

          return closestRefreshAt
        },
        null,
      )

      if (nextRefreshAt === null) {
        return
      }

      const delay = Math.min(MAX_RELATIVE_TIME_DELAY_MS, Math.max(1000, nextRefreshAt - now + 50))

      timeoutId = setTimeout(() => {
        setRelativeTimeTick(Date.now())
        scheduleNextTick()
      }, delay)
    }

    setRelativeTimeTick(Date.now())
    scheduleNextTick()

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [filteredConversations, isFocused])

  const renderConversationItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <ConversationItem conversation={item} relativeTimeTick={relativeTimeTick} />
    ),
    [relativeTimeTick],
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
      <SafeAreaView className="flex-1 bg-bg-primary">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-base2 text-text-secondary">
            We couldn&apos;t load your conversations.
          </Text>
          <TouchableOpacity
            className="mt-4 rounded-full bg-brand px-5 py-3"
            onPress={() => {
              refetch()
            }}
            activeOpacity={0.85}
          >
            <Text className="font-medium text-white">Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <FlatList
        data={filteredConversations}
        extraData={relativeTimeTick}
        renderItem={renderConversationItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={
          <View className="pb-2">
            <Animated.View
              entering={SECTION_ENTERING}
              className="flex-row items-center justify-between px-5 pt-2"
            >
              <Text className="text-[28px] font-semibold tracking-[-0.6px] text-text-primary">
                Messages
              </Text>

              <TouchableOpacity
                className="h-10 w-10 items-center justify-center rounded-full bg-surface-input"
                onPress={handleBotChat}
                activeOpacity={0.82}
                disabled={isBotLoading}
              >
                {isBotLoading ? (
                  <ActivityIndicator color="#FF6B2C" size="small" />
                ) : (
                  <MaterialIcons name="smart-toy" size={20} color="#161616" />
                )}
              </TouchableOpacity>
            </Animated.View>

            {matches.length > 0 ? (
              <Animated.View entering={SECTION_ENTERING.delay(40)} className="pt-5">
                <Text className="px-5 text-xs2 uppercase tracking-[1.4px] text-text-muted">
                  People
                </Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, gap: 16 }}
                >
                  {matches.map((match) => (
                    <TouchableOpacity
                      key={match.id}
                      className="items-center"
                      style={{ width: 68 }}
                      onPress={() => router.push(`/conversation/${match.conversationId}`)}
                      onPressIn={() => {
                        void prefetchMessages(queryClient, match.conversationId)
                      }}
                      activeOpacity={0.8}
                    >
                      {match.picture ? (
                        <Image
                          source={{ uri: match.picture }}
                          className="h-14 w-14 rounded-full bg-surface-input"
                          resizeMode="cover"
                        />
                      ) : (
                        <View className="h-14 w-14 items-center justify-center rounded-full bg-surface-input">
                          <Text className="font-medium text-base text-text-primary">
                            {match.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <Text
                        className="mt-2 text-center text-sm2 font-medium text-text-primary"
                        numberOfLines={1}
                      >
                        {match.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </Animated.View>
            ) : null}

            <Animated.View entering={SECTION_ENTERING.delay(80)} className="px-5 pt-5">
              <View className="flex-row items-center rounded-full bg-surface-input px-4 py-3.5">
                <TextInput
                  className="flex-1 text-base text-text-primary"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search"
                  placeholderTextColor="#A6A6A6"
                />
                <MaterialIcons name="search" size={20} color="#A6A6A6" />
              </View>
            </Animated.View>

            <Animated.View entering={SECTION_ENTERING.delay(120)} className="pt-6">
              <Text className="px-5 text-xs2 uppercase tracking-[1.4px] text-text-muted">
                Messages
              </Text>
              <View className="mt-4 h-px bg-border-light" />
            </Animated.View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center px-5 pt-10">
            <Text className="text-center text-base2 text-text-secondary">
              {deferredSearchQuery.trim()
                ? 'No conversations match your search.'
                : 'No conversations yet.'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}
