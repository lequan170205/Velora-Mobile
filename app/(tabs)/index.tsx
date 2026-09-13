import { MaterialIcons } from '@expo/vector-icons'
import { useIsFocused } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, FlatList, ScrollView, View } from 'react-native'
import Animated, {
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppPressable, AppText } from '../../src/components/base'
import { ChatAvatar } from '../../src/components/chat/ChatAvatar'
import { ConversationItem } from '../../src/components/chat/ConversationItem'
import { AppSearchBar } from '../../src/components/common/AppSearchBar'
import { SafeTouchableOpacity } from '../../src/components/common/SafeTouchableOpacity'
import { getDockedTabBarHeight } from '../../src/components/navigation/CustomTabBar'
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

const SECTION_ENTERING = FadeInDown.springify()
  .damping(18)
  .stiffness(170)
  .reduceMotion(ReduceMotion.System)
const MAX_RELATIVE_TIME_DELAY_MS = 24 * 60 * 60 * 1000

interface MatchSummary {
  id: string
  conversationId: string
  name: string
  picture?: string
}

function ConversationsHeader({ onCreateGroup }: { onCreateGroup: () => void }) {
  return (
    <Animated.View
      entering={SECTION_ENTERING}
      className="flex-row items-end justify-between bg-bg-primary px-5 pb-3 pt-2"
    >
      <View>
        <AppText className="text-xs2 font-semibold uppercase tracking-[1.8px] text-brand-dark">
          Velora
        </AppText>
        <AppText className="font-display text-[28px] leading-[34px] tracking-[-0.7px] text-text-primary">
          Messages
        </AppText>
      </View>
      <SafeTouchableOpacity
        className="h-12 w-12 items-center justify-center overflow-hidden rounded-[18px] border border-brand-soft bg-surface-accent"
        onPress={onCreateGroup}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Create group chat"
      >
        <MaterialIcons name="group-add" size={21} color="#D85A21" />
      </SafeTouchableOpacity>
    </Animated.View>
  )
}

const SkeletonRow = React.memo(function SkeletonRow({ delay }: { delay: number }) {
  const opacity = useSharedValue(1)

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(withTiming(0.45, { duration: 640 }), withTiming(1, { duration: 640 })),
        -1,
        true,
      ),
    )
  }, [delay, opacity])

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View style={style} className="flex-row items-center px-3 py-2.5">
      <View className="h-[52px] w-[52px] rounded-[18px] bg-bg-secondary" />
      <View className="ml-3 flex-1 gap-2.5 overflow-hidden">
        <View className="h-3.5 w-2/5 rounded-full bg-bg-secondary" />
        <View className="h-3 w-3/5 rounded-full bg-bg-secondary" />
      </View>
    </Animated.View>
  )
})

function ConversationListSkeleton() {
  return (
    <View className="mx-2 px-3" pointerEvents="none">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <SkeletonRow key={row} delay={row * 90} />
      ))}
    </View>
  )
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
          name: other.name || other.fullName || other.email?.split('@')[0] || '?',
          ...(other.picture ? { picture: other.picture } : {}),
        },
      ]
    })
    .slice(0, 10)
}

export default function ConversationsScreen() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const isFocused = useIsFocused()
  const insets = useSafeAreaInsets()
  const { data: conversations, isLoading, isError, refetch } = useConversations()
  const { isConnected, requestPresence } = useSocket()
  const { openConversation, prefetchConversation } = useConversationNavigation()

  const matches = useMatches(conversations)

  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [relativeTimeTick, setRelativeTimeTick] = useState(() => Date.now())
  const warmedConversationSignatureRef = useRef('')

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
      const otherName =
        otherParticipant?.name ||
        otherParticipant?.fullName ||
        otherParticipant?.email?.split('@')[0] ||
        ''

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
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState !== 'active' || !isFocused) {
        return
      }

      void refetch()
    })

    return () => {
      subscription.remove()
    }
  }, [isFocused, refetch])

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

  const openNewGroup = useCallback(() => {
    router.push('/conversation/new-group')
  }, [router])

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
        <ConversationsHeader onCreateGroup={openNewGroup} />
        <ConversationListSkeleton />
      </SafeAreaView>
    )
  }

  if (isError) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
        <ConversationsHeader onCreateGroup={openNewGroup} />
        <View className="flex-1 items-center justify-center px-6">
          <View className="h-12 w-12 items-center justify-center rounded-[18px] bg-surface-accent">
            <MaterialIcons name="cloud-off" size={22} color="#D85A21" />
          </View>
          <AppText className="mt-4 text-center font-heading text-lg text-text-primary">
            We couldn&apos;t load your conversations
          </AppText>
          <AppText className="mt-1.5 text-center text-base2 text-text-secondary">
            Check your connection and try again.
          </AppText>
          <AppPressable
            className="mt-6 h-11 items-center justify-center overflow-hidden rounded-full bg-brand px-6"
            onPress={() => {
              refetch()
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Try loading conversations again"
          >
            <AppText className="text-base2 font-semibold text-white">Try again</AppText>
          </AppPressable>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <ConversationsHeader onCreateGroup={openNewGroup} />
      <FlatList
        data={filteredConversations}
        extraData={relativeTimeTick}
        renderItem={renderConversationItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          // The tab bar overlays the list (frosted glass), so clear content
          // past it. SafeAreaView already pads the bottom inset slice.
          paddingBottom: getDockedTabBarHeight(insets.bottom) - insets.bottom + 16,
        }}
        ListHeaderComponent={
          <View className="pb-1">
            {matches.length > 0 ? (
              <Animated.View entering={SECTION_ENTERING.delay(40)}>
                <AppText className="px-5 pb-1 pt-1 text-xs2 font-semibold uppercase tracking-[1.4px] text-text-muted">
                  Matches
                </AppText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10, gap: 14 }}
                >
                  {matches.map((match) => (
                    <SafeTouchableOpacity
                      key={match.id}
                      style={{ width: 64 }}
                      className="items-center"
                      hitSlop={0}
                      onPress={() => openConversation(match.conversationId)}
                      onPressIn={() => {
                        prefetchConversation(match.conversationId)
                      }}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`Open conversation with ${match.name}`}
                    >
                      <ChatAvatar name={match.name} picture={match.picture} size={60} />

                      <AppText
                        className="mt-2 text-sm2 font-medium text-text-primary"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{ width: 64, textAlign: 'center' }}
                      >
                        {match.name}
                      </AppText>
                    </SafeTouchableOpacity>
                  ))}
                </ScrollView>
              </Animated.View>
            ) : null}

            <Animated.View entering={SECTION_ENTERING.delay(80)} className="px-5 pt-2">
              <AppSearchBar
                value={searchQuery}
                onChangeText={setSearchQuery}
                onClear={() => setSearchQuery('')}
                placeholder="Search conversations"
                iconPlacement="left"
                size="compact"
                containerClassName="h-[52px] rounded-full px-4 py-0"
                accessibilityLabel="Search conversations"
              />
            </Animated.View>

            <Animated.View
              entering={SECTION_ENTERING.delay(120)}
              className="flex-row items-center justify-between px-5 pb-1.5 pt-5"
            >
              <AppText className="font-heading text-lg text-text-primary">Recent</AppText>
              <AppText className="text-sm2 text-text-muted">
                {filteredConversations.length}{' '}
                {filteredConversations.length === 1 ? 'chat' : 'chats'}
              </AppText>
            </Animated.View>
          </View>
        }
        ListEmptyComponent={
          <View className="mx-5 mt-4 items-center rounded-[24px] border border-brand-soft bg-surface-accent px-6 py-9">
            <View className="h-12 w-12 items-center justify-center rounded-[18px] border border-brand-soft bg-bg-primary">
              <MaterialIcons
                name={deferredSearchQuery.trim() ? 'search-off' : 'chat-bubble-outline'}
                size={22}
                color="#D85A21"
              />
            </View>
            <AppText className="mt-4 text-center font-heading text-lg text-text-primary">
              {deferredSearchQuery.trim() ? 'No conversations found' : 'Your inbox is ready'}
            </AppText>
            <AppText className="mt-1.5 text-center text-base2 leading-5 text-text-secondary">
              {deferredSearchQuery.trim()
                ? 'Try another name or clear your search.'
                : 'Start a group and bring your people together.'}
            </AppText>
            {deferredSearchQuery.trim() ? (
              <AppPressable
                className="mt-6 h-11 items-center justify-center overflow-hidden rounded-full bg-brand px-6"
                activeOpacity={0.82}
                onPress={() => setSearchQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear conversation search"
              >
                <AppText className="text-base2 font-semibold text-white">Clear search</AppText>
              </AppPressable>
            ) : (
              <AppPressable
                className="mt-6 h-11 flex-row items-center justify-center overflow-hidden rounded-full bg-brand px-6"
                activeOpacity={0.82}
                onPress={openNewGroup}
                accessibilityRole="button"
                accessibilityLabel="Create group chat"
              >
                <MaterialIcons name="group-add" size={19} color="#FFFFFF" />
                <AppText className="ml-2 text-base2 font-semibold text-white">
                  Create a group
                </AppText>
              </AppPressable>
            )}
          </View>
        }
      />
    </SafeAreaView>
  )
}
