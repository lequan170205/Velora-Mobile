import { MaterialIcons } from '@expo/vector-icons'
import { useIsFocused } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, ScrollView, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AppPressable, AppText, AppTextInput } from '../../src/components/base'
import { ConversationItem } from '../../src/components/chat/ConversationItem'
import { SafeTouchableOpacity } from '../../src/components/common/SafeTouchableOpacity'
import { useBotChat } from '../../src/hooks/useBotChat'
import { useConversationNavigation } from '../../src/hooks/useConversationNavigation'
import { useConversations } from '../../src/hooks/useConversations'
import {
  MESSAGE_CACHE_WARMUP_LIMIT,
  prefetchMessagesForConversations,
} from '../../src/hooks/useMessages'
import { getNextConversationPreviewRefreshAt } from '../../src/lib/conversationPreviewTime'
import { useSocket } from '../../src/providers/SocketProvider'
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
  const queryClient = useQueryClient()
  const isFocused = useIsFocused()
  const { data: conversations, isLoading, isError, refetch } = useConversations()
  const { mutateAsync: startBotChat, isPending: isBotLoading } = useBotChat()
  const { isConnected, requestPresence } = useSocket()
  const { openConversation, prefetchConversation, runConversationEntry } =
    useConversationNavigation()

  const matches = useMatches(conversations)

  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [relativeTimeTick, setRelativeTimeTick] = useState(() => Date.now())
  const warmedConversationSignatureRef = useRef('')

  const handleBotChat = useCallback(() => {
    void runConversationEntry('bot-conversation', async () => {
      try {
        await startBotChat()
      } catch {
        Alert.alert('Error', 'Could not open bot conversation. Please try again.')
      }
    })
  }, [runConversationEntry, startBotChat])

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

  const warmConversationIds = useMemo(() => {
    if (!conversations?.length) {
      return []
    }

    return conversations.slice(0, MESSAGE_CACHE_WARMUP_LIMIT).map((conversation) => conversation.id)
  }, [conversations])

  const presenceUserIds = useMemo(() => {
    if (!conversations?.length) {
      return []
    }

    return conversations.flatMap((conversation) => {
      if (conversation.isGroup) {
        return []
      }

      const otherParticipant = conversation.participants?.find(
        (participant: ChatParticipant) => participant.id !== useAuthStore.getState().user?.id,
      )

      return otherParticipant?.id ? [otherParticipant.id] : []
    })
  }, [conversations])

  useEffect(() => {
    if (!warmConversationIds.length) {
      warmedConversationSignatureRef.current = ''
      return
    }

    const signature = warmConversationIds.join(':')
    if (warmedConversationSignatureRef.current === signature) {
      return
    }

    warmedConversationSignatureRef.current = signature
    void prefetchMessagesForConversations(queryClient, warmConversationIds)
  }, [queryClient, warmConversationIds])

  useEffect(() => {
    if (!isConnected || presenceUserIds.length === 0) {
      return
    }

    requestPresence(presenceUserIds)
  }, [isConnected, presenceUserIds, requestPresence])

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
          <AppText className="text-center text-base2 text-text-secondary">
            We couldn&apos;t load your conversations.
          </AppText>
          <AppPressable
            className="mt-4 rounded-full bg-brand px-5 py-3"
            onPress={() => {
              refetch()
            }}
            activeOpacity={0.85}
          >
            <AppText className="font-medium text-white">Try again</AppText>
          </AppPressable>
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
              <AppText className="text-[20px] font-bold tracking-[-0.6px] text-brand-dark">
                VELORA
              </AppText>

              <AppPressable
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
              </AppPressable>
            </Animated.View>

            {matches.length > 0 ? (
              <Animated.View entering={SECTION_ENTERING.delay(40)} className="pt-3">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, gap: 4 }}
                >
                  {matches.map((match) => (
                    <SafeTouchableOpacity
                      key={match.id}
                      style={{ width: 96 }}
                      className="items-center"
                      onPress={() => openConversation(match.conversationId)}
                      onPressIn={() => {
                        prefetchConversation(match.conversationId)
                      }}
                      activeOpacity={0.8}
                    >
                      {match.picture ? (
                        <Image
                          source={{ uri: match.picture }}
                          className="h-24 w-24 rounded-full bg-surface-input"
                          resizeMode="cover"
                        />
                      ) : (
                        <View className="h-24 w-24 items-center justify-center rounded-full bg-surface-input">
                          <AppText className="font-medium text-base text-text-primary">
                            {match.name.charAt(0).toUpperCase()}
                          </AppText>
                        </View>
                      )}

                      <AppText
                        className="mt-2 text-sm font-medium text-text-primary"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{ width: 96, textAlign: 'center' }}
                      >
                        {match.name}
                      </AppText>
                    </SafeTouchableOpacity>
                  ))}
                </ScrollView>
              </Animated.View>
            ) : null}

            <Animated.View entering={SECTION_ENTERING.delay(80)} className="px-5 pt-5">
              <View className="flex-row items-center rounded-full bg-surface-input px-4 py-3.5">
                <AppTextInput
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
              <AppText className="px-5 text-xs uppercase tracking-[1.4px] text-text-muted">
                Messages
              </AppText>
              <View className="mt-4 h-px bg-border-light" />
            </Animated.View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center px-5 pt-10">
            <AppText className="text-center text-base2 text-text-secondary">
              {deferredSearchQuery.trim()
                ? 'No conversations match your search.'
                : 'No conversations yet.'}
            </AppText>
          </View>
        }
      />
    </SafeAreaView>
  )
}
