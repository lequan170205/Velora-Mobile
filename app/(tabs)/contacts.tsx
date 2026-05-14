import { MaterialIcons } from '@expo/vector-icons'
import { FlashList as OriginalFlashList } from '@shopify/flash-list'
import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native'
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'

import { conversationApi } from '../../src/api/conversation.api'
import { userApi } from '../../src/api/user.api'
import { useContacts } from '../../src/hooks/useContacts'
import { useConversationNavigation } from '../../src/hooks/useConversationNavigation'
import { getConversationsQueryOptions } from '../../src/hooks/useConversations'
import { cn } from '../../src/lib/cn'
import { useAuthStore } from '../../src/stores/authStore'
import { useChatStore } from '../../src/stores/chatStore'

import type { DirectoryUser } from '../../src/types/user.types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FlashList = OriginalFlashList as any
const CARD_ENTERING = FadeInDown.springify().damping(16).stiffness(160)
const ROW_LAYOUT = LinearTransition.springify().damping(18).stiffness(170)
const normalizeEmail = (value: string) => value.trim().toLowerCase()
const getEmailDisplayName = (email: string) => {
  const [localPart] = normalizeEmail(email).split('@')
  return localPart || email
}

const getErrorMessage = (error: unknown, fallback: string) => {
  const responseMessage = (error as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data?.message

  if (Array.isArray(responseMessage) && responseMessage.length > 0) {
    return responseMessage[0]
  }

  if (typeof responseMessage === 'string' && responseMessage.trim().length > 0) {
    return responseMessage
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallback
}

export default function ContactsScreen() {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [emailInput, setEmailInput] = useState('')
  const [pendingConversationKey, setPendingConversationKey] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const { data, isLoading, fetchNextPage, hasNextPage } = useContacts(deferredSearch)
  const { user: currentUser } = useAuthStore()
  const { onlineUsers } = useChatStore()
  const { openConversation, runConversationEntry } = useConversationNavigation()

  const users = useMemo(() => {
    return ((data?.pages.flatMap((page) => page?.users || []) || []) as DirectoryUser[]).filter(
      (user) => user.id !== currentUser?.id,
    )
  }, [currentUser?.id, data])

  const liveCount = useMemo(() => {
    return users.filter((user) => onlineUsers.has(user.id)).length
  }, [onlineUsers, users])

  const normalizedEmailInput = normalizeEmail(emailInput)
  const isAnyConversationPending = pendingConversationKey !== null
  const isEmailConversationPending = pendingConversationKey?.startsWith('email:') ?? false

  const createAndOpenConversation = useCallback(
    async (targetUserId: string) => {
      const conversation = await conversationApi.create({
        participantIds: [targetUserId],
        type: 'DIRECT',
      })
      const conversationsQueryOptions = getConversationsQueryOptions()

      try {
        await queryClient.fetchQuery({
          ...conversationsQueryOptions,
          staleTime: 0,
        })
      } catch (error) {
        console.warn('[Contacts] Failed to refresh conversations cache', error)
        void queryClient.invalidateQueries({
          queryKey: conversationsQueryOptions.queryKey,
        })
      }

      openConversation(conversation.id)
    },
    [openConversation, queryClient],
  )

  const handleUserPress = useCallback(
    (user: DirectoryUser) => {
      const entryKey = `direct:${user.id}`

      void runConversationEntry(entryKey, async () => {
        setPendingConversationKey(entryKey)

        try {
          await createAndOpenConversation(user.id)
        } catch (error) {
          Alert.alert('Error', getErrorMessage(error, 'Could not start the conversation.'))
        } finally {
          setPendingConversationKey((currentKey) => (currentKey === entryKey ? null : currentKey))
        }
      })
    },
    [createAndOpenConversation, runConversationEntry],
  )

  const handleCreateByEmail = useCallback(() => {
    if (!normalizedEmailInput) {
      Alert.alert('Missing email', 'Enter an email address to start a conversation.')
      return
    }

    const entryKey = `email:${normalizedEmailInput}`

    void runConversationEntry(entryKey, async () => {
      setPendingConversationKey(entryKey)

      try {
        const matchedUser = await userApi.findByEmail(normalizedEmailInput)

        if (!matchedUser) {
          Alert.alert('No user found', `We couldn't find an account for ${normalizedEmailInput}.`)
          return
        }

        if (matchedUser.id === currentUser?.id) {
          Alert.alert('Unavailable', 'You cannot start a conversation with your own email.')
          return
        }

        await createAndOpenConversation(matchedUser.id)
        setEmailInput('')
      } catch (error) {
        Alert.alert('Error', getErrorMessage(error, 'Could not start the conversation.'))
      } finally {
        setPendingConversationKey((currentKey) => (currentKey === entryKey ? null : currentKey))
      }
    })
  }, [createAndOpenConversation, currentUser?.id, normalizedEmailInput, runConversationEntry])

  const renderItem = ({ item }: { item: DirectoryUser }) => {
    if (!item) return null

    const displayName = getEmailDisplayName(item.email)
    const isOnline = onlineUsers.has(item.id)
    const isPending = pendingConversationKey === `direct:${item.id}`

    return (
      <Animated.View layout={ROW_LAYOUT} entering={CARD_ENTERING}>
        <Pressable
          className="mx-4 mb-3"
          onPress={() => {
            void handleUserPress(item)
          }}
          disabled={isAnyConversationPending}
        >
          <View
            className="flex-row items-center rounded-[28px] border border-border-light bg-surface-card px-4 py-4"
            style={{
              borderCurve: 'continuous',
              boxShadow: '0 12px 24px rgba(93, 74, 53, 0.08)',
            }}
          >
            <View className="relative mr-4">
              <View className="h-14 w-14 items-center justify-center rounded-full bg-surface-muted">
                <Text className="font-heading text-lg text-text-primary">
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>

              <View
                className={cn(
                  'absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-surface-card',
                  isOnline ? 'bg-status-online' : 'bg-border-strong',
                )}
              />
            </View>

            <View className="flex-1">
              <Text className="font-heading text-md text-text-primary" numberOfLines={1}>
                {displayName}
              </Text>
              <Text className="mt-1 text-sm2 text-text-secondary" numberOfLines={1}>
                {item.email}
              </Text>
              <Text
                className={cn(
                  'mt-2 text-xs2 uppercase tracking-[1.1px]',
                  isOnline ? 'text-status-online' : 'text-text-muted',
                )}
              >
                {isOnline ? 'Available now' : 'Direct message ready'}
              </Text>
            </View>

            <View className="ml-3 rounded-full bg-brand-soft px-3 py-2">
              {isPending ? (
                <ActivityIndicator color="#D85A21" size="small" />
              ) : (
                <MaterialIcons name="chat" size={18} color="#D85A21" />
              )}
            </View>
          </View>
        </Pressable>
      </Animated.View>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <FlashList
        data={users}
        renderItem={renderItem}
        keyExtractor={(item: DirectoryUser, index: number) => item?.id || index.toString()}
        estimatedItemSize={106}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 164 }}
        onEndReached={() => {
          if (hasNextPage) fetchNextPage()
        }}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View className="pb-5">
            <Animated.View entering={CARD_ENTERING} className="px-4 pt-3">
              <View
                className="rounded-[32px] border border-border-light bg-surface-card px-5 py-5"
                style={{
                  borderCurve: 'continuous',
                  boxShadow: '0 18px 36px rgba(93, 74, 53, 0.08)',
                }}
              >
                <Text className="text-xs2 uppercase tracking-[1.4px] text-text-muted">
                  People Directory
                </Text>
                <Text className="mt-2 font-heading text-[30px] leading-[36px] text-text-primary">
                  Reach the right person fast
                </Text>
                <Text className="mt-2 text-base2 leading-6 text-text-secondary">
                  Browse your workspace, see who is live, and jump into a secure conversation with
                  one tap.
                </Text>

                <View className="mt-5 flex-row gap-3">
                  <View className="flex-1 rounded-[24px] bg-surface-muted px-4 py-4">
                    <Text className="text-xs2 uppercase tracking-[1.1px] text-text-muted">
                      Contacts
                    </Text>
                    <Text className="mt-2 font-heading text-xxl text-text-primary">
                      {users.length}
                    </Text>
                  </View>

                  <View className="flex-1 rounded-[24px] bg-surface-accent px-4 py-4">
                    <Text className="text-xs2 uppercase tracking-[1.1px] text-text-muted">
                      Live now
                    </Text>
                    <Text className="mt-2 font-heading text-xxl text-text-primary">
                      {liveCount}
                    </Text>
                  </View>
                </View>
              </View>
            </Animated.View>

            <Animated.View entering={CARD_ENTERING.delay(40)} className="px-4 pt-4">
              <View
                className="rounded-[28px] border border-border-light bg-surface-card px-5 py-5"
                style={{
                  borderCurve: 'continuous',
                  boxShadow: '0 12px 24px rgba(93, 74, 53, 0.06)',
                }}
              >
                <Text className="text-xs2 uppercase tracking-[1.2px] text-text-muted">
                  Start by email
                </Text>
                <Text className="mt-2 font-heading text-xl text-text-primary">
                  Create a direct conversation instantly
                </Text>
                <Text className="mt-2 text-base2 leading-6 text-text-secondary">
                  Enter a teammate&apos;s email and we&apos;ll open the existing chat or create a
                  new one for you.
                </Text>

                <View className="mt-5 flex-row items-center rounded-full border border-border-light bg-surface-input px-4 py-3">
                  <MaterialIcons name="alternate-email" size={20} color="#9B958C" />
                  <TextInput
                    className="ml-3 flex-1 text-base text-text-primary"
                    value={emailInput}
                    onChangeText={setEmailInput}
                    placeholder="teammate@company.com"
                    placeholderTextColor="#9B958C"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    onSubmitEditing={handleCreateByEmail}
                  />
                </View>

                <Pressable
                  className="mt-4 items-center justify-center rounded-full bg-brand px-4 py-3.5"
                  onPress={handleCreateByEmail}
                  disabled={isAnyConversationPending || normalizedEmailInput.length === 0}
                  style={{
                    opacity:
                      isAnyConversationPending || normalizedEmailInput.length === 0 ? 0.6 : 1,
                  }}
                >
                  {isEmailConversationPending ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text className="font-medium text-white">Start conversation</Text>
                  )}
                </Pressable>
              </View>
            </Animated.View>

            <Animated.View entering={CARD_ENTERING.delay(80)} className="px-4 pt-4">
              <View
                className="rounded-[28px] border border-border-light bg-surface-card px-4 py-4"
                style={{
                  borderCurve: 'continuous',
                  boxShadow: '0 12px 24px rgba(93, 74, 53, 0.06)',
                }}
              >
                <View className="flex-row items-center rounded-full border border-border-light bg-surface-input px-4 py-3">
                  <MaterialIcons name="search" size={20} color="#9B958C" />
                  <TextInput
                    className="ml-3 flex-1 text-base text-text-primary"
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search directory by email"
                    placeholderTextColor="#9B958C"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>
            </Animated.View>

            <Animated.View
              entering={CARD_ENTERING.delay(120)}
              className="flex-row items-center justify-between px-4 pt-6 pb-3"
            >
              <Text className="font-heading text-lg text-text-primary">Workspace directory</Text>
              <Text className="text-xs2 uppercase tracking-[1.3px] text-text-muted">
                {users.length} results
              </Text>
            </Animated.View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center px-4 pt-6">
            {isLoading ? (
              <ActivityIndicator color="#FF6B2C" size="large" />
            ) : (
              <View
                className="w-full rounded-[28px] border border-dashed border-border-default bg-surface-card px-6 py-10"
                style={{ borderCurve: 'continuous' }}
              >
                <Text className="text-center font-heading text-xl text-text-primary">
                  {deferredSearch.trim() ? 'No people found' : 'No contacts yet'}
                </Text>
                <Text className="mt-2 text-center text-base2 leading-6 text-text-secondary">
                  {deferredSearch.trim()
                    ? 'Try another search term to expand your directory results.'
                    : 'Contacts will appear here as your workspace grows.'}
                </Text>
              </View>
            )}
          </View>
        }
      />
    </SafeAreaView>
  )
}
