import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { conversationApi } from '../../src/api/conversation.api'
import {
  ReelThumbnailGridSkeleton,
  ReelThumbnailTile,
} from '../../src/components/reels/ReelThumbnailGrid'
import { usePublicProfile } from '../../src/hooks/useContacts'
import { useConversationNavigation } from '../../src/hooks/useConversationNavigation'
import { getConversationsQueryOptions } from '../../src/hooks/useConversations'
import {
  useAcceptFriendRequest,
  useCancelFriendRequest,
  useRejectFriendRequest,
  useRemoveFriend,
  useSendFriendRequest,
} from '../../src/hooks/useFriendMutations'
import { useFriends, useFriendshipStatus } from '../../src/hooks/useFriends'
import { useReelsFeed } from '../../src/hooks/useReels'
import { cn } from '../../src/lib/cn'
import { getInitials } from '../../src/lib/profile'
import { useAuthStore } from '../../src/stores/authStore'

import type { FriendSummary } from '../../src/types/friend.types'
import type { Reel } from '../../src/types/reel.types'

type ActionVariant = 'primary' | 'secondary' | 'muted' | 'danger'
type PendingAction = 'message'
const PROFILE_REELS_LIMIT = 24

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

const getHandleLabel = (username?: string | null) => {
  const normalizedUsername = username?.trim().replace(/^@+/, '')
  return normalizedUsername ? `@${normalizedUsername}` : '@member'
}

function ActionButton({
  disabled,
  isPending,
  label,
  onPress,
  variant,
}: {
  disabled: boolean
  isPending: boolean
  label: string
  onPress: () => void
  variant: ActionVariant
}) {
  const spinnerColor =
    variant === 'primary'
      ? '#FFFFFF'
      : variant === 'danger'
        ? '#E5483B'
        : variant === 'muted'
          ? '#8A8379'
          : '#161616'

  return (
    <Pressable
      className={cn(
        'items-center justify-center rounded-full px-5 py-3',
        variant === 'primary'
          ? 'bg-brand'
          : variant === 'secondary'
            ? 'border border-border-light bg-surface-card'
            : variant === 'danger'
              ? 'border border-[#FFD9D5] bg-[#FFF2F0]'
              : 'bg-surface-muted',
      )}
      onPress={onPress}
      disabled={disabled}
      style={{ opacity: disabled ? 0.65 : 1 }}
    >
      {isPending ? (
        <ActivityIndicator color={spinnerColor} size="small" />
      ) : (
        <Text
          className={cn(
            'font-medium',
            variant === 'primary'
              ? 'text-white'
              : variant === 'danger'
                ? 'text-[#E5483B]'
                : variant === 'muted'
                  ? 'text-text-secondary'
                  : 'text-text-primary',
          )}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

function EmptyReelsState() {
  return (
    <View className="px-5 pt-8">
      <View
        className="items-center rounded-[28px] border border-dashed border-border-default bg-surface-card px-6 py-10"
        style={{ borderCurve: 'continuous' }}
      >
        <View className="h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
          <MaterialIcons name="play-circle-outline" size={28} color="#D85A21" />
        </View>
        <Text className="mt-4 font-heading text-xl text-text-primary">No reels yet</Text>
      </View>
    </View>
  )
}

function ReelsLoadingGrid({ tileSize }: { tileSize: number }) {
  return <ReelThumbnailGridSkeleton tileSize={tileSize} />
}

function FriendHighlight({ friend, onPress }: { friend: FriendSummary; onPress: () => void }) {
  return (
    <Pressable className="mr-4 items-center" onPress={onPress}>
      <View
        className="h-[76px] w-[76px] items-center justify-center rounded-full border border-border-light bg-white"
        style={{
          shadowColor: 'rgba(22, 22, 22, 0.06)',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 1,
          shadowRadius: 20,
          elevation: 2,
        }}
      >
        {friend.user.picture ? (
          <Image
            source={{ uri: friend.user.picture }}
            style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: '#F5F5F5' }}
          />
        ) : (
          <View className="h-[68px] w-[68px] items-center justify-center rounded-full bg-surface-muted">
            <Text className="font-heading text-lg text-text-primary">
              {getInitials(friend.user.fullName)}
            </Text>
          </View>
        )}
      </View>
      <Text className="mt-2 max-w-[78px] text-center text-sm2 text-text-primary" numberOfLines={1}>
        @{friend.user.username}
      </Text>
    </Pressable>
  )
}

function FriendSkeleton() {
  return (
    <View className="mr-4 items-center">
      <View className="h-[76px] w-[76px] rounded-full bg-surface-muted" />
      <View className="mt-2 h-3 w-14 rounded-full bg-surface-muted" />
    </View>
  )
}

export default function PublicProfileScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const tileSize = useMemo(() => Math.floor((windowWidth - 4) / 3), [windowWidth])
  const closeRemoveSheetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const { username } = useLocalSearchParams<{ username?: string }>()
  const normalizedUsername = useMemo(
    () =>
      String(username ?? '')
        .trim()
        .replace(/^@+/, ''),
    [username],
  )
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)
  const [isRemoveSheetVisible, setIsRemoveSheetVisible] = useState(false)
  const removeSheetBackdropOpacity = useSharedValue(0)
  const removeSheetTranslateY = useSharedValue(48)
  const removeSheetScale = useSharedValue(0.985)

  const {
    data: profile,
    isLoading: isProfileLoading,
    isFetching: isProfileFetching,
    refetch: refetchProfile,
  } = usePublicProfile(normalizedUsername)
  const reelsParams = useMemo(
    () => ({
      ...(profile?.id ? { userId: profile.id } : {}),
      visibility: 'public' as const,
      limit: PROFILE_REELS_LIMIT,
    }),
    [profile?.id],
  )
  const {
    data: friendshipStatus,
    isLoading: isStatusLoading,
    isFetching: isStatusFetching,
    refetch: refetchStatus,
  } = useFriendshipStatus(profile?.id ?? '')
  const sendFriendRequest = useSendFriendRequest()
  const acceptFriendRequest = useAcceptFriendRequest()
  const rejectFriendRequest = useRejectFriendRequest()
  const cancelFriendRequest = useCancelFriendRequest()
  const removeFriend = useRemoveFriend()
  const {
    data: friends = [],
    isPending: isFriendsPending,
    isRefetching: isFriendsRefetching,
    refetch: refetchFriends,
  } = useFriends(profile?.id)
  const {
    data: reelsData,
    isPending: isReelsPending,
    isFetchingNextPage,
    isRefetching: isReelsRefetching,
    hasNextPage,
    fetchNextPage,
    refetch: refetchReels,
  } = useReelsFeed(reelsParams, { enabled: Boolean(profile?.id) })
  const { openConversation, runConversationEntry } = useConversationNavigation()

  const isFriendActionPending =
    sendFriendRequest.isPending ||
    acceptFriendRequest.isPending ||
    rejectFriendRequest.isPending ||
    cancelFriendRequest.isPending ||
    removeFriend.isPending
  const isPending = pendingAction !== null || isFriendActionPending
  const status = friendshipStatus?.status ?? 'none'
  const requestId = friendshipStatus?.id
  const isOwnProfile = profile?.id === useAuthStore((state) => state.user?.id)
  const publicReels = useMemo(
    () => reelsData?.pages.flatMap((page) => page.items) ?? [],
    [reelsData],
  )
  const friendsValue = isFriendsPending && friends.length === 0 ? '...' : String(friends.length)
  const friendHighlights = friends.slice(0, 7)
  const extraFriendsCount = Math.max(friends.length - friendHighlights.length, 0)
  const isRefreshing =
    isProfileFetching || isStatusFetching || isFriendsRefetching || isReelsRefetching

  useEffect(() => {
    return () => {
      isMountedRef.current = false

      if (closeRemoveSheetTimeoutRef.current) {
        clearTimeout(closeRemoveSheetTimeoutRef.current)
      }
    }
  }, [])

  const animateRemoveSheetIn = useCallback(() => {
    removeSheetBackdropOpacity.value = withTiming(1, {
      duration: 160,
      easing: Easing.out(Easing.quad),
    })
    removeSheetTranslateY.value = withTiming(0, {
      duration: 190,
      easing: Easing.out(Easing.cubic),
    })
    removeSheetScale.value = withTiming(1, {
      duration: 190,
      easing: Easing.out(Easing.cubic),
    })
  }, [removeSheetBackdropOpacity, removeSheetScale, removeSheetTranslateY])

  const closeRemoveSheet = useCallback(
    (options: { force?: boolean } = {}) => {
      if (removeFriend.isPending && !options.force) {
        return
      }

      removeSheetBackdropOpacity.value = withTiming(0, {
        duration: 120,
        easing: Easing.out(Easing.quad),
      })
      removeSheetTranslateY.value = withTiming(56, {
        duration: 145,
        easing: Easing.inOut(Easing.cubic),
      })
      removeSheetScale.value = withTiming(0.985, {
        duration: 145,
        easing: Easing.out(Easing.cubic),
      })

      if (closeRemoveSheetTimeoutRef.current) {
        clearTimeout(closeRemoveSheetTimeoutRef.current)
      }

      closeRemoveSheetTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) {
          return
        }

        setIsRemoveSheetVisible(false)
      }, 150)
    },
    [removeFriend.isPending, removeSheetBackdropOpacity, removeSheetScale, removeSheetTranslateY],
  )

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
        console.warn('[PublicProfile] Failed to refresh conversations cache', error)
        void queryClient.invalidateQueries({
          queryKey: conversationsQueryOptions.queryKey,
        })
      }

      openConversation(conversation.id)
    },
    [openConversation, queryClient],
  )

  const handleMessage = useCallback(() => {
    if (!profile?.id) return

    const entryKey = `message:${profile.id}`

    void runConversationEntry(entryKey, async () => {
      setActionErrorMessage(null)
      setPendingAction('message')

      try {
        await createAndOpenConversation(profile.id)
      } catch (error) {
        setActionErrorMessage(getErrorMessage(error, 'Could not open the conversation.'))
      } finally {
        setPendingAction(null)
      }
    })
  }, [createAndOpenConversation, profile?.id, runConversationEntry])

  const handleOpenRemoveSheet = useCallback(() => {
    if (!profile?.id) return

    if (closeRemoveSheetTimeoutRef.current) {
      clearTimeout(closeRemoveSheetTimeoutRef.current)
    }

    setActionErrorMessage(null)
    setIsRemoveSheetVisible(true)
    requestAnimationFrame(() => {
      animateRemoveSheetIn()
    })
  }, [animateRemoveSheetIn, profile?.id])

  const handleCloseRemoveSheet = useCallback(() => {
    closeRemoveSheet()
  }, [closeRemoveSheet])

  const handleConfirmRemoveFriend = useCallback(() => {
    if (!profile?.id) return

    removeFriend.mutate(profile.id, {
      onSuccess: () => closeRemoveSheet({ force: true }),
    })
  }, [closeRemoveSheet, profile?.id, removeFriend])

  const handleFriendPress = useCallback(
    (username?: string | null) => {
      const nextUsername = username?.trim().replace(/^@+/, '')

      if (!nextUsername) {
        return
      }

      router.push(`/users/${nextUsername}`)
    },
    [router],
  )

  const handleRefresh = useCallback(() => {
    void Promise.all([refetchProfile(), refetchStatus(), refetchFriends(), refetchReels()])
  }, [refetchFriends, refetchProfile, refetchReels, refetchStatus])

  const removeSheetBackdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: removeSheetBackdropOpacity.value,
  }))

  const removeSheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: removeSheetTranslateY.value }, { scale: removeSheetScale.value }],
  }))

  const renderReelItem = useCallback(
    ({ item, index }: { item: Reel; index: number }) => {
      return (
        <ReelThumbnailTile
          index={index}
          onPress={() => {
            router.push({
              pathname: '/reels/[id]',
              params: {
                id: item.id,
                source: 'profile',
                returnTo: 'user-profile',
                returnUsername: normalizedUsername,
              },
            })
          }}
          reel={item}
          tileSize={tileSize}
        />
      )
    },
    [normalizedUsername, router, tileSize],
  )

  if (isProfileLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg-primary">
        <ActivityIndicator color="#FF6B2C" size="large" />
      </SafeAreaView>
    )
  }

  if (!profile) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg-primary">
        <Text className="text-sm2 text-text-muted">User not found</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <FlatList
        data={publicReels}
        numColumns={3}
        keyExtractor={(item) => item.id}
        renderItem={renderReelItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={['#FF6B2C']}
            tintColor="#FF6B2C"
          />
        }
        ListHeaderComponent={
          <View className="px-5 pb-6 pt-2">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-xs2 uppercase tracking-[1.2px] text-text-muted">Profile</Text>
                <Text className="mt-1 font-heading text-xl text-text-primary">
                  {getHandleLabel(profile.username)}
                </Text>
              </View>

              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full border border-border-light bg-surface-card"
                onPress={() => router.back()}
              >
                <MaterialIcons name="arrow-back" size={22} color="#161616" />
              </Pressable>
            </View>

            <LinearGradient
              colors={['#FFF7EF', '#FFFFFF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              className="mt-5 overflow-hidden rounded-[34px] border border-border-light px-5 py-5"
              style={{
                borderCurve: 'continuous',
                shadowColor: 'rgba(22, 22, 22, 0.08)',
                shadowOffset: { width: 0, height: 18 },
                shadowOpacity: 1,
                shadowRadius: 30,
                elevation: 4,
              }}
            >
              <View
                pointerEvents="none"
                className="absolute -right-7 -top-9 h-28 w-28 rounded-full"
                style={{ backgroundColor: 'rgba(255, 107, 44, 0.10)' }}
              />
              <View
                pointerEvents="none"
                className="absolute -left-7 bottom-4 h-20 w-20 rounded-full"
                style={{ backgroundColor: 'rgba(255, 107, 44, 0.06)' }}
              />

              <View className="flex-row items-center">
                {profile.picture ? (
                  <Image
                    source={{ uri: profile.picture }}
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: 48,
                      backgroundColor: '#F5F5F5',
                    }}
                  />
                ) : (
                  <View className="h-24 w-24 items-center justify-center rounded-full bg-surface-muted">
                    <Text className="font-heading text-[30px] text-text-primary">
                      {getInitials(profile.fullName)}
                    </Text>
                  </View>
                )}

                <View className="ml-4 flex-1">
                  <Text className="font-heading text-[30px] leading-[34px] text-text-primary">
                    {profile.fullName}
                  </Text>
                  <View className="mt-2 flex-row flex-wrap items-center">
                    <View className="rounded-full border border-border-light bg-white px-3 py-1.5">
                      <Text className="text-xs2 uppercase tracking-[1.1px] text-text-secondary">
                        {getHandleLabel(profile.username)}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {!isOwnProfile ? (
                <View className="mt-5">
                  {status === 'friends' ? (
                    <View className="flex-row gap-3">
                      <View className="flex-1">
                        <ActionButton
                          disabled={isPending || isStatusLoading || isStatusFetching}
                          isPending={pendingAction === 'message'}
                          label="Message"
                          onPress={handleMessage}
                          variant="secondary"
                        />
                      </View>
                      <View className="flex-1">
                        <ActionButton
                          disabled={isPending || isStatusLoading || isStatusFetching}
                          isPending={false}
                          label="Friends"
                          onPress={() => {
                            Alert.alert('Friends', undefined, [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Remove friend',
                                style: 'destructive',
                                onPress: handleOpenRemoveSheet,
                              },
                            ])
                          }}
                          variant="secondary"
                        />
                      </View>
                    </View>
                  ) : status === 'request_received' && requestId ? (
                    <View className="flex-row gap-3">
                      <View className="flex-1">
                        <ActionButton
                          disabled={isPending || isStatusLoading || isStatusFetching}
                          isPending={acceptFriendRequest.isPending}
                          label="Accept"
                          onPress={() =>
                            acceptFriendRequest.mutate({
                              requestId: requestId ?? '',
                              userId: profile.id,
                              requester: {
                                id: profile.id,
                                fullName: profile.fullName,
                                username: profile.username ?? '',
                                picture: profile.picture,
                              },
                            })
                          }
                          variant="primary"
                        />
                      </View>
                      <View className="flex-1">
                        <ActionButton
                          disabled={isPending || isStatusLoading || isStatusFetching}
                          isPending={rejectFriendRequest.isPending}
                          label="Reject"
                          onPress={() =>
                            rejectFriendRequest.mutate({ requestId, userId: profile.id })
                          }
                          variant="secondary"
                        />
                      </View>
                    </View>
                  ) : status === 'request_sent' && requestId ? (
                    <ActionButton
                      disabled={isPending || isStatusLoading || isStatusFetching}
                      isPending={cancelFriendRequest.isPending}
                      label="Cancel request"
                      onPress={() => cancelFriendRequest.mutate({ requestId, userId: profile.id })}
                      variant="secondary"
                    />
                  ) : (
                    <ActionButton
                      disabled={isPending || isStatusLoading || isStatusFetching || !profile.id}
                      isPending={sendFriendRequest.isPending}
                      label="Add friend"
                      onPress={() => sendFriendRequest.mutate(profile.id)}
                      variant="primary"
                    />
                  )}

                  {actionErrorMessage ? (
                    <View className="mt-3 flex-row rounded-[22px] border border-[#FFD9D5] bg-[#FFF5F3] px-4 py-3">
                      <MaterialIcons name="error-outline" size={18} color="#E5483B" />
                      <Text className="ml-2 flex-1 text-sm2 leading-5 text-[#B2453C]">
                        {actionErrorMessage}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </LinearGradient>

            <View className="mt-5">
              <View className="flex-row items-center">
                <Text className="font-heading text-lg text-text-primary">Friends</Text>
                <View className="ml-2 rounded-full bg-surface-muted px-3 py-1.5">
                  <Text className="text-xs2 uppercase tracking-[1px] text-text-secondary">
                    {friendsValue}
                  </Text>
                </View>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingTop: 16, paddingRight: 20 }}
              >
                {isFriendsPending && friends.length === 0 ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <FriendSkeleton key={`friend-skeleton-${index}`} />
                  ))
                ) : friendHighlights.length > 0 ? (
                  <>
                    {friendHighlights.map((friend) => (
                      <FriendHighlight
                        key={friend.id}
                        friend={friend}
                        onPress={() => handleFriendPress(friend.user.username)}
                      />
                    ))}

                    {extraFriendsCount > 0 ? (
                      <View className="mr-4 items-center">
                        <View className="h-[76px] w-[76px] items-center justify-center rounded-full border border-dashed border-border-strong bg-white">
                          <Text className="font-heading text-lg text-text-primary">
                            +{extraFriendsCount}
                          </Text>
                        </View>
                        <Text className="mt-2 text-sm2 text-text-secondary">More</Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <View
                    className="rounded-[24px] border border-dashed border-border-default bg-surface-card px-5 py-4"
                    style={{ borderCurve: 'continuous' }}
                  >
                    <Text className="font-medium text-text-primary">No friends yet</Text>
                    <Text className="mt-1 text-sm2 text-text-secondary">
                      This profile has no friends to show yet.
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>

            <View className="mt-6 border-y border-border-light">
              <View className="items-center py-3">
                <View
                  className="absolute top-0 h-[2px] w-14 bg-brand"
                  style={{ alignSelf: 'center' }}
                />
                <MaterialIcons name="grid-on" size={20} color="#161616" />
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          isReelsPending ? <ReelsLoadingGrid tileSize={tileSize} /> : <EmptyReelsState />
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View className="py-5">
              <ActivityIndicator color="#FF6B2C" size="small" />
            </View>
          ) : null
        }
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            void fetchNextPage()
          }
        }}
      />

      <Modal
        visible={isRemoveSheetVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={handleCloseRemoveSheet}
      >
        <View className="flex-1 justify-end">
          <Animated.View
            className="absolute inset-0 bg-black/40"
            style={removeSheetBackdropAnimatedStyle}
          >
            <Pressable
              className="flex-1"
              disabled={removeFriend.isPending}
              onPress={handleCloseRemoveSheet}
            />
          </Animated.View>

          <Animated.View
            className="rounded-t-[32px] bg-white px-5 pt-3"
            style={[
              removeSheetAnimatedStyle,
              {
                paddingBottom: Math.max(insets.bottom, 18),
                shadowColor: 'rgba(22, 22, 22, 0.18)',
                shadowOffset: { width: 0, height: -8 },
                shadowOpacity: 1,
                shadowRadius: 24,
                elevation: 18,
              },
            ]}
          >
            <View className="items-center pb-2">
              <View className="h-1.5 w-14 rounded-full bg-[#D9D9D9]" />
            </View>

            <View className="mt-3 flex-row items-start justify-between">
              <View className="flex-1 pr-4">
                <Text className="font-heading text-xl text-text-primary">Remove friend?</Text>
                <Text className="mt-2 text-base2 leading-6 text-text-secondary">
                  {profile.fullName} will be removed from your friends list. You can add{' '}
                  {getHandleLabel(profile.username)} again later.
                </Text>
              </View>

              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
                disabled={removeFriend.isPending}
                onPress={handleCloseRemoveSheet}
              >
                <MaterialIcons name="close" size={20} color="#161616" />
              </Pressable>
            </View>

            <View className="mt-6 flex-row">
              <Pressable
                className="mr-3 flex-1 rounded-full border border-border-light bg-surface-muted py-3"
                disabled={removeFriend.isPending}
                onPress={handleCloseRemoveSheet}
              >
                <Text className="text-center font-medium text-text-primary">Cancel</Text>
              </Pressable>

              <Pressable
                className="flex-1 rounded-full bg-[#FF3B30] py-3"
                disabled={removeFriend.isPending}
                onPress={handleConfirmRemoveFriend}
                style={{ opacity: removeFriend.isPending ? 0.7 : 1 }}
              >
                {removeFriend.isPending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text className="text-center font-medium text-white">Remove</Text>
                )}
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}
