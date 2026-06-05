import { MaterialIcons } from '@expo/vector-icons'
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs'
import { useFocusEffect } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { authApi } from '../../src/api/auth.api'
import { queryKeys } from '../../src/constants/queryKeys'
import { resetLocalDatabase } from '../../src/database/DatabaseManager'
import { useFriends } from '../../src/hooks/useFriends'
import { useUpdateAvatar } from '../../src/hooks/useProfile'
import { useReelsFeed } from '../../src/hooks/useReels'
import { getDisplayName, getInitials, getProfileHandle } from '../../src/lib/profile'
import { useAuthStore } from '../../src/stores/authStore'
import { useChatStore } from '../../src/stores/chatStore'
import { useProfileUiStore } from '../../src/stores/profileUiStore'

import type { FriendSummary } from '../../src/types/friend.types'
import type { Reel, ReelVisibility } from '../../src/types/reel.types'

const PROFILE_REELS_LIMIT = 24
type SheetMode = 'settings' | 'clear-cache' | 'clear-local-database' | 'sign-out' | null
type DeferredSheetAction =
  | 'clear-cache'
  | 'clear-local-database'
  | 'edit-profile'
  | 'sign-out'
  | null
const RFC_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const getMemberSince = (createdAt?: string) => {
  if (!createdAt) return 'Recently joined'

  try {
    return format(new Date(createdAt), 'MMM yyyy')
  } catch {
    return 'Recently joined'
  }
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

const isRfcUuid = (value?: string | null) => {
  return Boolean(value && RFC_UUID_REGEX.test(value))
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

function EmptyReelsState({
  onCreate,
  visibility,
}: {
  onCreate: () => void
  visibility: ReelVisibility
}) {
  const isPrivate = visibility === 'private'

  return (
    <View className="px-5 pt-8">
      <View
        className="items-center rounded-[28px] border border-dashed border-border-default bg-surface-card px-6 py-10"
        style={{ borderCurve: 'continuous' }}
      >
        <View className="h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
          <MaterialIcons name="play-circle-outline" size={28} color="#D85A21" />
        </View>
        <Text className="mt-4 font-heading text-xl text-text-primary">
          {isPrivate ? 'No private reels yet' : 'No public reels yet'}
        </Text>
        <Text className="mt-2 text-center text-base2 text-text-secondary">
          {isPrivate
            ? 'Private reels are visible only to you from this profile.'
            : 'Publish a public reel to start building the grid.'}
        </Text>
        <Pressable
          className="mt-5 rounded-full bg-brand px-5 py-3"
          onPress={onCreate}
          android_ripple={{ color: 'rgba(255,255,255,0.16)', borderless: false }}
        >
          <Text className="font-medium text-white">Create reel</Text>
        </Pressable>
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

function SheetActionRow({
  description,
  icon,
  isDestructive = false,
  label,
  onPress,
}: {
  label: string
  description: string
  icon: keyof typeof MaterialIcons.glyphMap
  isDestructive?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
      onPress={onPress}
    >
      <View
        className={
          isDestructive
            ? 'h-12 w-12 items-center justify-center rounded-full bg-[#FFF1EE]'
            : 'h-12 w-12 items-center justify-center rounded-full bg-white'
        }
      >
        <MaterialIcons name={icon} size={20} color={isDestructive ? '#FF3B30' : '#161616'} />
      </View>
      <View className="ml-3 flex-1">
        <Text
          className={
            isDestructive
              ? 'font-medium text-md text-status-error'
              : 'font-medium text-md text-text-primary'
          }
        >
          {label}
        </Text>
        <Text className="mt-1 text-sm2 text-text-secondary">{description}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={20} color="#BEBEBE" />
    </Pressable>
  )
}

export default function ProfileScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const tabBarHeight = useBottomTabBarHeight()
  const tileSize = useMemo(() => Math.floor((windowWidth - 4) / 3), [windowWidth])
  const closeSheetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  const { user, clearAuth } = useAuthStore()
  const { clearCache } = useChatStore()
  const clearPendingFeedbackMessage = useProfileUiStore(
    (state) => state.clearPendingFeedbackMessage,
  )
  const pendingFeedbackMessage = useProfileUiStore((state) => state.pendingFeedbackMessage)
  const { mutate: updateAvatar, isPending: isUpdatingAvatar } = useUpdateAvatar()
  const hasValidProfileUserId = isRfcUuid(user?.id)
  const profileUserId = hasValidProfileUserId ? user?.id : undefined
  const [activeReelsVisibility, setActiveReelsVisibility] = useState<ReelVisibility>('public')
  const {
    data: friends = [],
    isPending: isFriendsPending,
    isRefetching: isFriendsRefetching,
    refetch: refetchFriends,
  } = useFriends()
  const profileReelsParams = useMemo(
    () =>
      profileUserId
        ? {
            userId: profileUserId,
            limit: PROFILE_REELS_LIMIT,
            visibility: activeReelsVisibility,
          }
        : {
            limit: PROFILE_REELS_LIMIT,
            visibility: activeReelsVisibility,
          },
    [activeReelsVisibility, profileUserId],
  )
  const {
    data: reelsData,
    isPending: isReelsPending,
    isFetchingNextPage,
    isRefetching: isReelsRefetching,
    hasNextPage,
    fetchNextPage,
    refetch: refetchReels,
  } = useReelsFeed(profileReelsParams, {
    enabled: Boolean(user?.id),
  })
  const [sheetMode, setSheetMode] = useState<SheetMode>(null)
  const [isSheetVisible, setIsSheetVisible] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [isClearingLocalDatabase, setIsClearingLocalDatabase] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const sheetBackdropOpacity = useSharedValue(0)
  const sheetTranslateY = useSharedValue(48)
  const sheetScale = useSharedValue(0.985)

  const profileFeedItems = useMemo(
    () => reelsData?.pages.flatMap((page) => page.items) ?? [],
    [reelsData],
  )
  const profileReels = useMemo(() => {
    if (hasValidProfileUserId) {
      return profileFeedItems
    }

    return profileFeedItems.filter((reel) => reel.userId === user?.id)
  }, [hasValidProfileUserId, profileFeedItems, user?.id])
  const friendsValue = isFriendsPending && friends.length === 0 ? '...' : String(friends.length)
  const friendHighlights = friends.slice(0, 7)
  const extraFriendsCount = Math.max(friends.length - friendHighlights.length, 0)
  const profileHandle = getProfileHandle(user?.email, user?.username)
  const displayName = getDisplayName({
    email: user?.email,
    firstName: user?.firstName,
    fullName: user?.fullName,
    lastName: user?.lastName,
  })
  const memberSinceLabel = getMemberSince(user?.createdAt)
  const isSheetBusy = isClearingCache || isClearingLocalDatabase || isSigningOut

  useEffect(() => {
    return () => {
      isMountedRef.current = false

      if (closeSheetTimeoutRef.current) {
        clearTimeout(closeSheetTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!feedbackMessage) {
      return
    }

    const timeoutId = setTimeout(() => {
      setFeedbackMessage(null)
    }, 2200)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [feedbackMessage])

  useFocusEffect(
    useCallback(() => {
      if (!pendingFeedbackMessage) {
        return
      }

      setFeedbackMessage(pendingFeedbackMessage)
      clearPendingFeedbackMessage()
    }, [clearPendingFeedbackMessage, pendingFeedbackMessage]),
  )

  const handleCreateReel = useCallback(() => {
    router.push('/reels/create')
  }, [router])

  const handleFriendPress = useCallback(
    (username?: string | null) => {
      const normalizedUsername = username?.trim().replace(/^@+/, '')

      if (!normalizedUsername) {
        return
      }

      router.push(`/users/${normalizedUsername}`)
    },
    [router],
  )

  const animateSheetIn = useCallback(() => {
    sheetBackdropOpacity.value = withTiming(1, {
      duration: 160,
      easing: Easing.out(Easing.quad),
    })
    sheetTranslateY.value = withTiming(0, {
      duration: 190,
      easing: Easing.out(Easing.cubic),
    })
    sheetScale.value = withTiming(1, {
      duration: 190,
      easing: Easing.out(Easing.cubic),
    })
  }, [sheetBackdropOpacity, sheetScale, sheetTranslateY])

  const executeDeferredSheetAction = useCallback(
    async (action: DeferredSheetAction) => {
      if (action === 'clear-cache') {
        try {
          await clearCache()
          queryClient.clear()

          if (isMountedRef.current) {
            setFeedbackMessage('Cache cleared')
          }
        } finally {
          if (isMountedRef.current) {
            setIsClearingCache(false)
          }
        }

        return
      }

      if (action === 'edit-profile') {
        router.push('/account')
        return
      }

      if (action === 'clear-local-database') {
        try {
          queryClient.removeQueries({ queryKey: queryKeys.conversations.all })
          await resetLocalDatabase()

          if (isMountedRef.current) {
            setFeedbackMessage('Local database cleared')
          }
        } catch (error) {
          console.error('[Profile] Failed to clear local database', error)

          if (isMountedRef.current) {
            setFeedbackMessage('Failed to clear local database')
          }
        } finally {
          if (isMountedRef.current) {
            setIsClearingLocalDatabase(false)
          }
        }

        return
      }

      if (action === 'sign-out') {
        try {
          const logoutPromise = authApi.logout().catch((error) => {
            console.error(error)
          })

          await clearCache()
          queryClient.clear()
          void logoutPromise

          if (isMountedRef.current) {
            setIsSigningOut(false)
          }
        } finally {
          clearAuth()
        }
      }
    },
    [clearAuth, clearCache, queryClient, router],
  )

  const closeSheet = useCallback(
    (action: DeferredSheetAction = null) => {
      if (isSheetVisible && isSheetBusy && action === null) {
        return
      }

      sheetBackdropOpacity.value = withTiming(0, {
        duration: 120,
        easing: Easing.out(Easing.quad),
      })
      sheetTranslateY.value = withTiming(56, {
        duration: 145,
        easing: Easing.inOut(Easing.cubic),
      })
      sheetScale.value = withTiming(0.985, {
        duration: 145,
        easing: Easing.out(Easing.cubic),
      })

      if (closeSheetTimeoutRef.current) {
        clearTimeout(closeSheetTimeoutRef.current)
      }

      closeSheetTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) {
          return
        }

        setIsSheetVisible(false)
        setSheetMode(null)

        if (action) {
          void executeDeferredSheetAction(action)
        }
      }, 150)
    },
    [
      executeDeferredSheetAction,
      isSheetBusy,
      isSheetVisible,
      sheetBackdropOpacity,
      sheetScale,
      sheetTranslateY,
    ],
  )

  const handleSettingsPress = useCallback(() => {
    if (closeSheetTimeoutRef.current) {
      clearTimeout(closeSheetTimeoutRef.current)
    }

    setSheetMode('settings')
    setIsSheetVisible(true)

    requestAnimationFrame(() => {
      animateSheetIn()
    })
  }, [animateSheetIn])

  const handlePickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.82,
    })

    if (!result.canceled && result.assets[0]?.uri) {
      updateAvatar(result.assets[0].uri)
    }
  }, [updateAvatar])

  const handleShareProfile = useCallback(async () => {
    try {
      await Share.share({
        title: displayName,
        message: `${displayName}\n@${profileHandle}\n${user?.email ?? ''}`,
      })
    } catch (error) {
      console.error(error)
    }
  }, [displayName, profileHandle, user?.email])

  const handleRefresh = useCallback(() => {
    void Promise.all([refetchFriends(), refetchReels()])
  }, [refetchFriends, refetchReels])

  const isRefreshing = isFriendsRefetching || isReelsRefetching

  const handleClearCacheConfirmed = useCallback(() => {
    if (isSheetBusy) {
      return
    }

    setIsClearingCache(true)
    closeSheet('clear-cache')
  }, [closeSheet, isSheetBusy])

  const handleClearLocalDatabaseConfirmed = useCallback(() => {
    if (isSheetBusy) {
      return
    }

    setIsClearingLocalDatabase(true)
    closeSheet('clear-local-database')
  }, [closeSheet, isSheetBusy])

  const handleSignOutConfirmed = useCallback(() => {
    if (isSheetBusy) {
      return
    }

    setIsSigningOut(true)
    closeSheet('sign-out')
  }, [closeSheet, isSheetBusy])

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: sheetBackdropOpacity.value,
  }))

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }, { scale: sheetScale.value }],
  }))

  const renderReelItem = useCallback(
    ({ item, index }: { item: Reel; index: number }) => {
      const playbackBadge = getPlaybackBadge(item.status)
      const thumbnailUri = item.thumbnailUrl ?? item.localThumbnailUri

      return (
        <Pressable
          className="mb-[2px] overflow-hidden bg-surface-muted"
          onPress={() => {
            router.push({
              pathname: '/reels/[id]',
              params: { id: item.id, source: 'profile', returnTo: 'profile' },
            })
          }}
          style={{
            width: tileSize,
            height: tileSize,
            marginRight: (index + 1) % 3 === 0 ? 0 : 2,
          }}
        >
          {thumbnailUri ? (
            <Image
              source={{ uri: thumbnailUri }}
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

  if (!user) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg-primary">
        <ActivityIndicator color="#FF6B2C" size="large" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      {feedbackMessage ? (
        <View
          pointerEvents="none"
          className="absolute inset-x-0 z-20 items-center"
          style={{ top: Math.max(insets.top, 12) }}
        >
          <View className="rounded-full px-4 py-2" style={{ backgroundColor: '#161616' }}>
            <Text className="text-sm2 text-white">{feedbackMessage}</Text>
          </View>
        </View>
      ) : null}

      <FlatList
        data={profileReels}
        numColumns={3}
        keyExtractor={(item) => item.id}
        renderItem={renderReelItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBarHeight + 28 }}
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
                  @{profileHandle}
                </Text>
              </View>

              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full border border-border-light bg-surface-card"
                onPress={handleSettingsPress}
              >
                <MaterialIcons name="menu" size={22} color="#161616" />
              </Pressable>
            </View>

            <View
              className="mt-5 rounded-[34px]"
              style={{
                shadowColor: 'rgba(22, 22, 22, 0.08)',
                shadowOffset: { width: 0, height: 18 },
                shadowOpacity: 1,
                shadowRadius: 30,
                elevation: 4,
              }}
            >
              <View className="overflow-hidden rounded-[34px] border border-border-light">
                <LinearGradient
                  colors={['#FFF7EF', '#FFFFFF']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  className="absolute inset-0"
                />

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

                <View className="px-5 py-5">
                  <View className="flex-row items-center">
                    <Pressable onPress={handlePickImage} className="relative">
                      {user.picture ? (
                        <Image
                          source={{ uri: user.picture }}
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
                            {getInitials(displayName)}
                          </Text>
                        </View>
                      )}

                      <View className="absolute bottom-0 right-0 h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-brand">
                        {isUpdatingAvatar ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <MaterialIcons name="photo-camera" size={16} color="#FFFFFF" />
                        )}
                      </View>
                    </Pressable>

                    <View className="ml-4 flex-1">
                      <Text className="font-heading text-[30px] leading-[34px] text-text-primary">
                        {displayName}
                      </Text>
                      <View className="mt-2 flex-row flex-wrap items-center">
                        <View className="rounded-full border border-border-light bg-white px-3 py-1.5">
                          <Text className="text-xs2 uppercase tracking-[1.1px] text-text-secondary">
                            @{profileHandle}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View className="mt-5">
                    <Text className="text-base2 leading-6 text-text-secondary">
                      Velora member since {memberSinceLabel}
                    </Text>
                  </View>

                  <View className="mt-5 flex-row">
                    <Pressable
                      className="mr-3 flex-1 rounded-full border border-border-light bg-white py-3"
                      onPress={handlePickImage}
                    >
                      <Text className="text-center font-medium text-text-primary">
                        {isUpdatingAvatar ? 'Updating...' : 'Edit photo'}
                      </Text>
                    </Pressable>

                    <Pressable
                      className="flex-1 rounded-full border border-border-light bg-surface-card py-3"
                      onPress={handleShareProfile}
                    >
                      <Text className="text-center font-medium text-text-primary">Share</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>

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
                      Friends you add will appear here.
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>

            <View className="mt-6 rounded-[24px] border border-border-light bg-surface-muted p-1">
              <View className="flex-row gap-1">
                {(
                  [
                    { icon: 'grid-on', label: 'Public', value: 'public' },
                    { icon: 'lock-outline', label: 'Private', value: 'private' },
                  ] as const
                ).map((tab) => {
                  const isActive = activeReelsVisibility === tab.value

                  return (
                    <Pressable
                      key={tab.value}
                      className={`flex-1 flex-row items-center justify-center rounded-[20px] px-3 py-3 ${
                        isActive ? 'bg-white' : ''
                      }`}
                      onPress={() => {
                        setActiveReelsVisibility(tab.value)
                      }}
                      style={
                        isActive
                          ? {
                              shadowColor: 'rgba(22, 22, 22, 0.08)',
                              shadowOffset: { width: 0, height: 8 },
                              shadowOpacity: 1,
                              shadowRadius: 16,
                              elevation: 2,
                            }
                          : undefined
                      }
                    >
                      <MaterialIcons
                        name={tab.icon}
                        size={19}
                        color={isActive ? '#161616' : '#8A8379'}
                      />
                      <Text
                        className={`ml-2 text-sm2 font-bold ${
                          isActive ? 'text-text-primary' : 'text-text-secondary'
                        }`}
                      >
                        {tab.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          isReelsPending ? (
            <ReelsLoadingGrid tileSize={tileSize} />
          ) : (
            <EmptyReelsState onCreate={handleCreateReel} visibility={activeReelsVisibility} />
          )
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
        visible={isSheetVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => {
          if (!isSheetBusy) {
            closeSheet()
          }
        }}
      >
        <View style={StyleSheet.absoluteFillObject} className="justify-end">
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: 'rgba(8, 8, 10, 0.44)' },
              backdropAnimatedStyle,
            ]}
          >
            <Pressable
              disabled={isSheetBusy}
              onPress={() => {
                closeSheet()
              }}
              style={StyleSheet.absoluteFillObject}
            />
          </Animated.View>

          <Animated.View
            style={[
              sheetAnimatedStyle,
              {
                paddingBottom: Math.max(insets.bottom, 18),
                shadowColor: 'rgba(22, 22, 22, 0.18)',
                shadowOffset: { width: 0, height: -8 },
                shadowOpacity: 1,
                shadowRadius: 24,
                elevation: 18,
              },
            ]}
            className="rounded-t-[32px] bg-white px-5 pb-8 pt-3"
          >
            <View className="items-center pb-2">
              <View className="h-1.5 w-14 rounded-full bg-[#D9D9D9]" />
            </View>

            <Animated.View
              key={sheetMode ?? 'settings'}
              entering={FadeInDown.springify().damping(18).stiffness(220)}
              layout={LinearTransition.springify().damping(18).stiffness(220)}
            >
              {sheetMode === 'settings' ? (
                <>
                  <View className="mt-3 flex-row items-start justify-between">
                    <View className="flex-1 pr-4">
                      <Text className="font-heading text-xl text-text-primary">
                        Profile options
                      </Text>
                      <Text className="mt-1 text-base2 text-text-secondary">
                        Focus actions for @{profileHandle}
                      </Text>
                    </View>

                    <Pressable
                      className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
                      disabled={isSheetBusy}
                      onPress={() => {
                        closeSheet()
                      }}
                    >
                      <MaterialIcons name="close" size={20} color="#161616" />
                    </Pressable>
                  </View>

                  <View className="mt-5">
                    <Text className="mb-3 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                      Account
                    </Text>
                    <View className="gap-3">
                      <SheetActionRow
                        icon="person-outline"
                        label="Edit profile"
                        description="Update your name and username."
                        onPress={() => {
                          closeSheet('edit-profile')
                        }}
                      />
                    </View>
                  </View>

                  <View className="mt-5">
                    <Text className="mb-3 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                      System
                    </Text>
                    <View className="gap-3">
                      <SheetActionRow
                        icon="delete-sweep"
                        label="Clear cache"
                        description="Remove local chat data from this device."
                        onPress={() => {
                          setSheetMode('clear-cache')
                        }}
                      />
                      <SheetActionRow
                        icon="storage"
                        label="Clear local database"
                        description="Delete the on-device message database."
                        isDestructive
                        onPress={() => {
                          setSheetMode('clear-local-database')
                        }}
                      />
                      <SheetActionRow
                        icon="logout"
                        label="Sign out"
                        description="End the current session on this device."
                        isDestructive
                        onPress={() => {
                          setSheetMode('sign-out')
                        }}
                      />
                    </View>
                  </View>
                </>
              ) : null}

              {sheetMode === 'clear-cache' ? (
                <>
                  <View className="mt-3 flex-row items-start justify-between">
                    <View className="flex-1 pr-4">
                      <Text className="font-heading text-xl text-text-primary">Clear cache?</Text>
                      <Text className="mt-2 text-base2 leading-6 text-text-secondary">
                        Messages will sync again from the server the next time you open the
                        conversation.
                      </Text>
                    </View>

                    <Pressable
                      className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
                      disabled={isSheetBusy}
                      onPress={() => {
                        closeSheet()
                      }}
                    >
                      <MaterialIcons name="close" size={20} color="#161616" />
                    </Pressable>
                  </View>

                  <View className="mt-6 flex-row">
                    <Pressable
                      className="mr-3 flex-1 rounded-full border border-border-light bg-surface-muted py-3"
                      disabled={isSheetBusy}
                      onPress={() => {
                        setSheetMode('settings')
                      }}
                    >
                      <Text className="text-center font-medium text-text-primary">Back</Text>
                    </Pressable>

                    <Pressable
                      className="flex-1 rounded-full bg-brand py-3"
                      disabled={isSheetBusy}
                      onPress={() => {
                        void handleClearCacheConfirmed()
                      }}
                    >
                      <Text className="text-center font-medium text-white">
                        {isClearingCache ? 'Clearing...' : 'Clear'}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : null}

              {sheetMode === 'clear-local-database' ? (
                <>
                  <View className="mt-3 flex-row items-start justify-between">
                    <View className="flex-1 pr-4">
                      <Text className="font-heading text-xl text-text-primary">
                        Clear local database?
                      </Text>
                      <Text className="mt-2 text-base2 leading-6 text-text-secondary">
                        This deletes the on-device message database. Conversations will sync again
                        from the server when you reopen them.
                      </Text>
                    </View>

                    <Pressable
                      className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
                      disabled={isSheetBusy}
                      onPress={() => {
                        closeSheet()
                      }}
                    >
                      <MaterialIcons name="close" size={20} color="#161616" />
                    </Pressable>
                  </View>

                  <View className="mt-6 flex-row">
                    <Pressable
                      className="mr-3 flex-1 rounded-full border border-border-light bg-surface-muted py-3"
                      disabled={isSheetBusy}
                      onPress={() => {
                        setSheetMode('settings')
                      }}
                    >
                      <Text className="text-center font-medium text-text-primary">Back</Text>
                    </Pressable>

                    <Pressable
                      className="flex-1 rounded-full bg-[#FF3B30] py-3"
                      disabled={isSheetBusy}
                      onPress={() => {
                        void handleClearLocalDatabaseConfirmed()
                      }}
                    >
                      <Text className="text-center font-medium text-white">
                        {isClearingLocalDatabase ? 'Clearing...' : 'Delete'}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : null}

              {sheetMode === 'sign-out' ? (
                <>
                  <View className="mt-3 flex-row items-start justify-between">
                    <View className="flex-1 pr-4">
                      <Text className="font-heading text-xl text-text-primary">Sign out?</Text>
                      <Text className="mt-2 text-base2 leading-6 text-text-secondary">
                        This ends the current session on this device and clears the local cache.
                      </Text>
                    </View>

                    <Pressable
                      className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
                      disabled={isSheetBusy}
                      onPress={() => {
                        closeSheet()
                      }}
                    >
                      <MaterialIcons name="close" size={20} color="#161616" />
                    </Pressable>
                  </View>

                  <View className="mt-6 flex-row">
                    <Pressable
                      className="mr-3 flex-1 rounded-full border border-border-light bg-surface-muted py-3"
                      disabled={isSheetBusy}
                      onPress={() => {
                        setSheetMode('settings')
                      }}
                    >
                      <Text className="text-center font-medium text-text-primary">Back</Text>
                    </Pressable>

                    <Pressable
                      className="flex-1 rounded-full bg-[#FF3B30] py-3"
                      disabled={isSheetBusy}
                      onPress={() => {
                        void handleSignOutConfirmed()
                      }}
                    >
                      <Text className="text-center font-medium text-white">
                        {isSigningOut ? 'Signing out...' : 'Sign out'}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
            </Animated.View>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}
