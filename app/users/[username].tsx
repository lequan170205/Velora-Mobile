import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
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
import { friendApi } from '../../src/api/friend.api'
import { queryKeys } from '../../src/constants/queryKeys'
import { usePublicProfile } from '../../src/hooks/useContacts'
import { useConversationNavigation } from '../../src/hooks/useConversationNavigation'
import { getConversationsQueryOptions } from '../../src/hooks/useConversations'
import { useFriendshipStatus } from '../../src/hooks/useFriends'
import { useReelsFeed } from '../../src/hooks/useReels'
import { cn } from '../../src/lib/cn'
import { getInitials } from '../../src/lib/profile'

import type { FriendshipState } from '../../src/types/friend.types'
import type { Reel } from '../../src/types/reel.types'

type ActionVariant = 'primary' | 'secondary' | 'muted' | 'danger'
type PendingAction = FriendshipState | 'message' | 'remove'
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

const getPlaybackBadge = (status?: string | null) => {
  const normalized = status?.trim().toLowerCase()

  if (
    !normalized ||
    normalized === 'ready' ||
    normalized === 'completed' ||
    normalized === 'published'
  ) {
    return null
  }

  if (normalized === 'processing') {
    return 'Processing'
  }

  if (normalized === 'pending') {
    return 'Queued'
  }

  if (normalized === 'failed') {
    return 'Unavailable'
  }

  return null
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
  return (
    <View className="flex-row flex-wrap px-[1px] pt-[2px]">
      {Array.from({ length: 6 }).map((_, index) => (
        <View
          key={`reel-skeleton-${index}`}
          className="mb-[2px] bg-surface-muted"
          style={{
            width: tileSize,
            height: tileSize,
            marginRight: (index + 1) % 3 === 0 ? 0 : 2,
          }}
        />
      ))}
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

  const isPending = pendingAction !== null
  const status = friendshipStatus?.status ?? 'none'
  const requestId = friendshipStatus?.id
  const publicReels = useMemo(
    () => reelsData?.pages.flatMap((page) => page.items) ?? [],
    [reelsData],
  )
  const isRefreshing = isProfileFetching || isStatusFetching || isReelsRefetching

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
      if (pendingAction === 'remove' && !options.force) {
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
    [pendingAction, removeSheetBackdropOpacity, removeSheetScale, removeSheetTranslateY],
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

  const runFriendAction = useCallback(
    async (
      nextAction: PendingAction,
      task: () => Promise<void>,
      fallbackMessage: string,
      options: { refreshConversations?: boolean } = {},
    ) => {
      setActionErrorMessage(null)
      setPendingAction(nextAction)

      try {
        await task()
        await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all })

        if (nextAction === 'remove') {
          closeRemoveSheet({ force: true })
        }

        if (options.refreshConversations) {
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
        }
      } catch (error) {
        setActionErrorMessage(getErrorMessage(error, fallbackMessage))
      } finally {
        setPendingAction(null)
      }
    },
    [closeRemoveSheet, queryClient],
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

    void runFriendAction(
      'remove',
      async () => {
        await friendApi.removeFriend(profile.id)
      },
      'Could not remove this friend.',
    )
  }, [profile?.id, runFriendAction])

  const action = useMemo(() => {
    if (!profile?.id) {
      return {
        disabled: true,
        label: 'Add',
        onPress: () => {},
        variant: 'primary' as ActionVariant,
      }
    }

    if (status === 'friends') {
      return {
        disabled: false,
        label: 'Message',
        onPress: handleMessage,
        variant: 'secondary' as ActionVariant,
      }
    }

    if (status === 'request_received' && requestId) {
      return {
        disabled: false,
        label: 'Confirm',
        onPress: () => {
          void runFriendAction(
            'request_received',
            async () => {
              await friendApi.acceptRequest(requestId)
            },
            'Could not accept the friend request.',
            { refreshConversations: true },
          )
        },
        variant: 'primary' as ActionVariant,
      }
    }

    if (status === 'request_sent' && requestId) {
      return {
        disabled: false,
        label: 'Cancel request',
        onPress: () => {
          void runFriendAction(
            'request_sent',
            async () => {
              await friendApi.cancelRequest(requestId)
            },
            'Could not cancel the friend request.',
          )
        },
        variant: 'secondary' as ActionVariant,
      }
    }

    return {
      disabled: false,
      label: 'Add',
      onPress: () => {
        void runFriendAction(
          'none',
          async () => {
            await friendApi.sendRequest(profile.id)
          },
          'Could not send the friend request.',
        )
      },
      variant: 'primary' as ActionVariant,
    }
  }, [handleMessage, profile?.id, requestId, runFriendAction, status])

  const handleRefresh = useCallback(() => {
    void Promise.all([refetchProfile(), refetchStatus(), refetchReels()])
  }, [refetchProfile, refetchReels, refetchStatus])

  const removeSheetBackdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: removeSheetBackdropOpacity.value,
  }))

  const removeSheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: removeSheetTranslateY.value }, { scale: removeSheetScale.value }],
  }))

  const renderReelItem = useCallback(
    ({ item, index }: { item: Reel; index: number }) => {
      const playbackBadge = getPlaybackBadge(item.status)

      return (
        <Pressable
          className="mb-[2px] overflow-hidden bg-surface-muted"
          onPress={() => {
            router.push({
              pathname: '/reels',
              params: { reelId: item.id },
            })
          }}
          style={{
            width: tileSize,
            height: tileSize,
            marginRight: (index + 1) % 3 === 0 ? 0 : 2,
          }}
        >
          {item.thumbnailUrl ? (
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : (
            <View className="flex-1 items-center justify-center bg-[#141414]">
              <MaterialIcons name="play-arrow" size={28} color="#FFFFFF" />
            </View>
          )}

          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.62)']}
            className="absolute inset-x-0 bottom-0 h-16"
          />

          <View className="absolute bottom-2 left-2 right-2 flex-row items-end justify-between">
            <Text className="flex-1 text-xs2 font-medium text-white" numberOfLines={1}>
              {item.title}
            </Text>
            <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
          </View>

          {playbackBadge ? (
            <View className="absolute left-2 top-2 rounded-full bg-black/58 px-2.5 py-1">
              <Text className="text-xs2 font-medium text-white">{playbackBadge}</Text>
            </View>
          ) : null}
        </Pressable>
      )
    },
    [router, tileSize],
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
                        isPending={pendingAction === 'remove'}
                        label="Remove"
                        onPress={handleOpenRemoveSheet}
                        variant="danger"
                      />
                    </View>
                  </View>
                ) : (
                  <ActionButton
                    disabled={isPending || isStatusLoading || isStatusFetching || action.disabled}
                    isPending={isPending}
                    label={action.label}
                    onPress={action.onPress}
                    variant={action.variant}
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
            </LinearGradient>

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
              disabled={pendingAction === 'remove'}
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
                disabled={pendingAction === 'remove'}
                onPress={handleCloseRemoveSheet}
              >
                <MaterialIcons name="close" size={20} color="#161616" />
              </Pressable>
            </View>

            <View className="mt-6 flex-row">
              <Pressable
                className="mr-3 flex-1 rounded-full border border-border-light bg-surface-muted py-3"
                disabled={pendingAction === 'remove'}
                onPress={handleCloseRemoveSheet}
              >
                <Text className="text-center font-medium text-text-primary">Cancel</Text>
              </Pressable>

              <Pressable
                className="flex-1 rounded-full bg-[#FF3B30] py-3"
                disabled={pendingAction === 'remove'}
                onPress={handleConfirmRemoveFriend}
                style={{ opacity: pendingAction === 'remove' ? 0.7 : 1 }}
              >
                {pendingAction === 'remove' ? (
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
