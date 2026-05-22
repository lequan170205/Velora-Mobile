import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'

import { friendApi } from '../../src/api/friend.api'
import { queryKeys } from '../../src/constants/queryKeys'
import { useContacts } from '../../src/hooks/useContacts'
import { getConversationsQueryOptions } from '../../src/hooks/useConversations'
import { useIncomingFriendRequests, useOutgoingFriendRequests } from '../../src/hooks/useFriends'
import { cn } from '../../src/lib/cn'
import { getInitials } from '../../src/lib/profile'

import type { FriendRequestSummary } from '../../src/types/friend.types'
import type { PublicUserProfile } from '../../src/types/user.types'

const CARD_ENTERING = FadeInDown.springify().damping(16).stiffness(160)
const ROW_LAYOUT = LinearTransition.springify().damping(18).stiffness(170)

const getHandleLabel = (username?: string | null) => {
  const normalizedUsername = username?.trim().replace(/^@+/, '')
  return normalizedUsername ? `@${normalizedUsername}` : ''
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

function RequestActionButton({
  isPending,
  label,
  onPress,
  tone,
}: {
  isPending: boolean
  label: string
  onPress: () => void
  tone: 'primary' | 'secondary' | 'muted'
}) {
  const spinnerColor = tone === 'primary' ? '#FFFFFF' : '#161616'

  return (
    <Pressable
      className={cn(
        'min-w-[84px] items-center justify-center rounded-full px-4 py-2.5',
        tone === 'primary'
          ? 'bg-brand'
          : tone === 'secondary'
            ? 'border border-border-light bg-surface-card'
            : 'bg-surface-muted',
      )}
      onPress={onPress}
      disabled={isPending}
      style={{ opacity: isPending ? 0.7 : 1 }}
    >
      {isPending ? (
        <ActivityIndicator color={spinnerColor} size="small" />
      ) : (
        <Text
          className={cn('font-medium', tone === 'primary' ? 'text-white' : 'text-text-primary')}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

function SearchResultRow({ onPress, user }: { onPress: () => void; user: PublicUserProfile }) {
  return (
    <Animated.View layout={ROW_LAYOUT} entering={CARD_ENTERING}>
      <Pressable
        className="mx-5 mb-3 flex-row items-center rounded-[24px] border border-border-light bg-surface-card px-4 py-4"
        style={{
          borderCurve: 'continuous',
          shadowColor: '#5D4A35',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.05,
          shadowRadius: 22,
          elevation: 2,
        }}
        onPress={onPress}
      >
        <View
          className="h-14 w-14 items-center justify-center rounded-full bg-surface-muted"
          style={{ overflow: 'hidden' }}
        >
          {user.picture ? (
            <Image
              source={{ uri: user.picture }}
              style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#F1E9E1' }}
            />
          ) : (
            <Text className="font-heading text-lg text-text-primary">
              {getInitials(user.fullName)}
            </Text>
          )}
        </View>

        <View className="ml-4 flex-1">
          <View className="flex-row items-center">
            <Text className="flex-1 font-heading text-md text-text-primary" numberOfLines={1}>
              {user.fullName}
            </Text>
          </View>
          {user.username ? (
            <Text className="mt-1 text-sm2 text-text-secondary" numberOfLines={1}>
              {getHandleLabel(user.username)}
            </Text>
          ) : null}
        </View>

        <MaterialIcons name="chevron-right" size={20} color="#9B958C" />
      </Pressable>
    </Animated.View>
  )
}

function RequestRow({
  actions,
  onPress,
  request,
}: {
  actions: React.ReactNode
  onPress: () => void
  request: FriendRequestSummary
}) {
  return (
    <Animated.View layout={ROW_LAYOUT} entering={CARD_ENTERING}>
      <View
        className="mx-5 mb-3 rounded-[24px] border border-border-light bg-surface-card px-4 py-4"
        style={{
          borderCurve: 'continuous',
          shadowColor: '#5D4A35',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.05,
          shadowRadius: 22,
          elevation: 2,
        }}
      >
        <Pressable className="flex-row items-center" onPress={onPress}>
          <View
            className="h-14 w-14 items-center justify-center rounded-full bg-surface-muted"
            style={{ overflow: 'hidden' }}
          >
            {request.user.picture ? (
              <Image
                source={{ uri: request.user.picture }}
                style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#F1E9E1' }}
              />
            ) : (
              <Text className="font-heading text-lg text-text-primary">
                {getInitials(request.user.fullName)}
              </Text>
            )}
          </View>

          <View className="ml-4 flex-1">
            <Text className="font-heading text-md text-text-primary" numberOfLines={1}>
              {request.user.fullName}
            </Text>
            <Text className="mt-1 text-sm2 text-text-secondary" numberOfLines={1}>
              {getHandleLabel(request.user.username)}
            </Text>
          </View>

          <MaterialIcons name="chevron-right" size={20} color="#9B958C" />
        </Pressable>

        <View className="mt-4 flex-row gap-3">{actions}</View>
      </View>
    </Animated.View>
  )
}

function SectionHeader({ count, title }: { count: number; title: string }) {
  return (
    <Animated.View
      entering={CARD_ENTERING}
      className="flex-row items-center justify-between px-5 pb-3 pt-6"
    >
      <Text className="font-heading text-lg text-text-primary">{title}</Text>
      <Text className="text-xs2 uppercase tracking-[1.1px] text-text-muted">{count}</Text>
    </Animated.View>
  )
}

function LoadMoreButton({ isPending, onPress }: { isPending: boolean; onPress: () => void }) {
  return (
    <View className="px-5 pt-1">
      <Pressable
        className="items-center rounded-full border border-border-light bg-surface-card px-4 py-3"
        onPress={onPress}
        disabled={isPending}
        style={{ opacity: isPending ? 0.75 : 1 }}
      >
        {isPending ? (
          <ActivityIndicator color="#D85A21" size="small" />
        ) : (
          <Text className="font-medium text-text-primary">Load more</Text>
        )}
      </Pressable>
    </View>
  )
}

export default function ContactsScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null)

  const deferredSearch = useDeferredValue(search)
  const normalizedSearch = deferredSearch.trim()

  const { data: discoveredUsers = [], isFetching, isLoading } = useContacts(normalizedSearch)
  const {
    data: incomingRequestsData,
    isLoading: isIncomingLoading,
    isFetchingNextPage: isFetchingNextIncomingPage,
    hasNextPage: hasNextIncomingPage,
    fetchNextPage: fetchNextIncomingPage,
  } = useIncomingFriendRequests()
  const {
    data: outgoingRequestsData,
    isLoading: isOutgoingLoading,
    isFetchingNextPage: isFetchingNextOutgoingPage,
    hasNextPage: hasNextOutgoingPage,
    fetchNextPage: fetchNextOutgoingPage,
  } = useOutgoingFriendRequests()

  const results = useMemo(
    () => discoveredUsers.filter((user) => user.username?.trim()),
    [discoveredUsers],
  )
  const incomingRequests = useMemo(
    () => incomingRequestsData?.pages.flatMap((page) => page.items) ?? [],
    [incomingRequestsData],
  )
  const outgoingRequests = useMemo(
    () => outgoingRequestsData?.pages.flatMap((page) => page.items) ?? [],
    [outgoingRequestsData],
  )
  const isRequestsLoading =
    (isIncomingLoading && !incomingRequestsData) || (isOutgoingLoading && !outgoingRequestsData)

  const runRequestAction = useCallback(
    async (
      actionKey: string,
      task: () => Promise<void>,
      fallbackMessage: string,
      options: { refreshConversations?: boolean } = {},
    ) => {
      setPendingActionKey(actionKey)

      try {
        await task()
        await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all })

        if (options.refreshConversations) {
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
        }
      } catch (error) {
        Alert.alert('Error', getErrorMessage(error, fallbackMessage))
      } finally {
        setPendingActionKey((currentKey) => (currentKey === actionKey ? null : currentKey))
      }
    },
    [queryClient],
  )

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <Animated.View entering={CARD_ENTERING} className="px-5 pt-3">
          <Text className="text-xs2 uppercase tracking-[1.4px] text-text-muted">Velora</Text>
          <Text className="mt-2 font-heading text-[30px] text-text-primary">Contacts</Text>
        </Animated.View>

        <Animated.View entering={CARD_ENTERING.delay(40)} className="px-5 pt-5">
          <View
            className="rounded-[24px] border border-border-light bg-surface-card px-4 py-4"
            style={{
              borderCurve: 'continuous',
              shadowColor: '#5D4A35',
              shadowOffset: { width: 0, height: 12 },
              shadowOpacity: 0.05,
              shadowRadius: 24,
              elevation: 2,
            }}
          >
            <View className="flex-row items-center rounded-full border border-border-light bg-surface-input px-4 py-3">
              <MaterialIcons name="search" size={20} color="#9B958C" />
              <TextInput
                className="ml-3 flex-1 text-base text-text-primary"
                value={search}
                onChangeText={setSearch}
                placeholder="Search"
                placeholderTextColor="#9B958C"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {search.trim() ? (
                <Pressable
                  className="h-8 w-8 items-center justify-center rounded-full bg-surface-muted"
                  onPress={() => setSearch('')}
                >
                  <MaterialIcons name="close" size={18} color="#6F6A64" />
                </Pressable>
              ) : null}
            </View>
          </View>
        </Animated.View>

        {normalizedSearch ? (
          isLoading || isFetching ? (
            <View className="items-center px-5 pt-10">
              <ActivityIndicator color="#D85A21" size="small" />
            </View>
          ) : results.length > 0 ? (
            <View className="pt-4">
              {results.map((user) => (
                <SearchResultRow
                  key={user.id}
                  user={user}
                  onPress={() => {
                    if (!user.username) return
                    router.push(`/users/${user.username}`)
                  }}
                />
              ))}
            </View>
          ) : (
            <View className="items-center px-5 pt-10">
              <Text className="text-sm2 text-text-muted">No users found</Text>
            </View>
          )
        ) : isRequestsLoading ? (
          <View className="items-center px-5 pt-10">
            <ActivityIndicator color="#D85A21" size="small" />
          </View>
        ) : (
          <>
            <SectionHeader count={incomingRequests.length} title="Incoming" />
            {incomingRequests.length > 0 ? (
              incomingRequests.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  actions={
                    <>
                      <RequestActionButton
                        label="Confirm"
                        tone="primary"
                        isPending={pendingActionKey === `accept:${request.id}`}
                        onPress={() => {
                          void runRequestAction(
                            `accept:${request.id}`,
                            async () => {
                              await friendApi.acceptRequest(request.id)
                            },
                            'Could not accept the friend request.',
                            { refreshConversations: true },
                          )
                        }}
                      />
                      <RequestActionButton
                        label="Reject"
                        tone="secondary"
                        isPending={pendingActionKey === `reject:${request.id}`}
                        onPress={() => {
                          void runRequestAction(
                            `reject:${request.id}`,
                            async () => {
                              await friendApi.rejectRequest(request.id)
                            },
                            'Could not reject the friend request.',
                          )
                        }}
                      />
                    </>
                  }
                  onPress={() => {
                    if (!request.user.username) return
                    router.push(`/users/${request.user.username}`)
                  }}
                />
              ))
            ) : (
              <View className="px-5">
                <Text className="text-sm2 text-text-muted">No incoming requests</Text>
              </View>
            )}
            {hasNextIncomingPage ? (
              <LoadMoreButton
                isPending={isFetchingNextIncomingPage}
                onPress={() => {
                  void fetchNextIncomingPage()
                }}
              />
            ) : null}

            <SectionHeader count={outgoingRequests.length} title="Outgoing" />
            {outgoingRequests.length > 0 ? (
              outgoingRequests.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  actions={
                    <RequestActionButton
                      label="Cancel"
                      tone="muted"
                      isPending={pendingActionKey === `cancel:${request.id}`}
                      onPress={() => {
                        void runRequestAction(
                          `cancel:${request.id}`,
                          async () => {
                            await friendApi.cancelRequest(request.id)
                          },
                          'Could not cancel the friend request.',
                        )
                      }}
                    />
                  }
                  onPress={() => {
                    if (!request.user.username) return
                    router.push(`/users/${request.user.username}`)
                  }}
                />
              ))
            ) : (
              <View className="px-5">
                <Text className="text-sm2 text-text-muted">No outgoing requests</Text>
              </View>
            )}
            {hasNextOutgoingPage ? (
              <LoadMoreButton
                isPending={isFetchingNextOutgoingPage}
                onPress={() => {
                  void fetchNextOutgoingPage()
                }}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
