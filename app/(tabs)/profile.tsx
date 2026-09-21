import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import type { BottomSheetModal } from '@gorhom/bottom-sheet'

import { AppPressable, AppText } from '../../src/components/base'
import { SafeTouchableOpacity } from '../../src/components/common/SafeTouchableOpacity'
import { getDockedTabBarHeight } from '../../src/components/navigation/CustomTabBar'
import {
  ReelThumbnailGridSkeleton,
  ReelThumbnailTile,
} from '../../src/components/reels/ReelThumbnailGrid'
import { ReelSeriesPickerSheet } from '../../src/components/reels/series/ReelSeriesPickerSheet'
import { useFriends } from '../../src/hooks/useFriends'
import { useUpdateAvatar } from '../../src/hooks/useProfile'
import { useCreateReelSeries, useOwnedReelSeries, useReelsFeed } from '../../src/hooks/useReels'
import { serializeChatReelRouteContext } from '../../src/lib/chatReels'
import { getDisplayName, getInitials, getProfileHandle } from '../../src/lib/profile'
import { useAuthStore } from '../../src/stores/authStore'

import type { FriendSummary } from '../../src/types/friend.types'
import type { Reel, ReelSeries, ReelVisibility } from '../../src/types/reel.types'

const PROFILE_REELS_LIMIT = 24
type ProfileContentTab = 'public' | 'series' | 'private'
const RFC_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const isRfcUuid = (value?: string | null) => {
  return Boolean(value && RFC_UUID_REGEX.test(value))
}

function FriendHighlight({ friend, onPress }: { friend: FriendSummary; onPress: () => void }) {
  return (
    <SafeTouchableOpacity
      className="mr-[14px] items-center"
      style={{ width: 64 }}
      hitSlop={0}
      activeOpacity={0.78}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open @${friend.user.username}'s profile`}
    >
      <View className="h-16 w-16 overflow-hidden rounded-[22px] bg-surface-muted">
        {friend.user.picture ? (
          <Image
            source={{ uri: friend.user.picture }}
            contentFit="cover"
            style={{ width: 64, height: 64 }}
          />
        ) : (
          <View className="flex-1 items-center justify-center bg-surface-accent">
            <AppText className="font-heading text-base font-semibold text-brand-dark">
              {getInitials(friend.user.fullName || friend.user.username)}
            </AppText>
          </View>
        )}
      </View>
      <AppText
        className="mt-2 text-center text-xs2 font-medium text-text-primary"
        numberOfLines={1}
      >
        @{friend.user.username}
      </AppText>
    </SafeTouchableOpacity>
  )
}

function FriendSkeleton() {
  return (
    <View className="mr-[14px] items-center" style={{ width: 64 }}>
      <View className="h-[60px] w-[60px] rounded-[20px] bg-surface-muted" />
      <View className="mt-2 h-3 w-12 rounded-full bg-surface-muted" />
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
    <View className="items-center px-5 pb-2 pt-7">
      <View className="h-12 w-12 items-center justify-center rounded-[18px] border border-brand-soft bg-surface-accent">
        <MaterialIcons name={isPrivate ? 'lock-outline' : 'grid-on'} size={24} color="#D85A21" />
      </View>
      <AppText className="mt-4 text-center font-heading text-lg text-text-primary">
        {isPrivate ? 'No private reels' : 'No reels yet'}
      </AppText>
      <AppText className="mt-1.5 text-center text-base2 leading-5 text-text-secondary">
        {isPrivate
          ? 'Reels you publish with private visibility will only be visible to you.'
          : 'Capture a moment, add your style, and share your first reel with the Velora community.'}
      </AppText>
      <AppPressable
        className="mt-5 h-11 items-center justify-center overflow-hidden rounded-full bg-brand px-6"
        onPress={onCreate}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel="Create reel"
      >
        <AppText className="text-base2 font-semibold text-white">Create reel</AppText>
      </AppPressable>
    </View>
  )
}

function EmptySeriesState({ onCreate }: { onCreate: () => void }) {
  return (
    <View className="items-center px-5 pb-2 pt-7">
      <View className="h-12 w-12 items-center justify-center rounded-[18px] border border-brand-soft bg-surface-accent">
        <MaterialIcons name="video-library" size={24} color="#D85A21" />
      </View>
      <AppText className="mt-4 text-center font-heading text-lg text-text-primary">
        No series yet
      </AppText>
      <AppText className="mt-1.5 text-center text-base2 leading-5 text-text-secondary">
        Group related reels into episodes to create your first series.
      </AppText>
      <AppPressable
        className="mt-5 h-11 items-center justify-center overflow-hidden rounded-full bg-brand px-6"
        onPress={onCreate}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel="Create series"
      >
        <AppText className="text-base2 font-semibold text-white">Create series</AppText>
      </AppPressable>
    </View>
  )
}

function ReelsLoadingGrid({ tileSize, tileHeight }: { tileSize: number; tileHeight: number }) {
  return <ReelThumbnailGridSkeleton tileSize={tileSize} tileHeight={tileHeight} />
}

function SeriesLoadingList({ cardWidth, cardHeight }: { cardWidth: number; cardHeight: number }) {
  const thumbnailHeight = Math.round(cardWidth * 1.05)
  return (
    <View className="flex-row flex-wrap gap-3 px-5 pb-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <View
          key={`series-skeleton-${index}`}
          className="overflow-hidden border border-[#EDE7E1] bg-white"
          style={{
            width: cardWidth,
            height: cardHeight,
          }}
        >
          <View className="w-full bg-[#EDE9E3]" style={{ height: thumbnailHeight }} />
          <View className="px-3 py-2">
            <View className="h-4 w-3/4 bg-[#EDE9E3]" />
            <View className="mt-1 h-3 w-1/2 bg-[#EDE9E3]" />
          </View>
        </View>
      ))}
    </View>
  )
}

function SeriesHighlight({
  series,
  cardWidth,
  cardHeight,
  onPress,
}: {
  series: ReelSeries
  cardWidth: number
  cardHeight: number
  onPress: () => void
}) {
  const cover = series.reels.find((reel) => reel.thumbnailUrl)?.thumbnailUrl
  const episodeCount = series.reels.length
  const thumbnailHeight = Math.round(cardWidth * 1.05)
  const visibilityLabel = useMemo(() => {
    switch (series.visibility) {
      case 'friends':
        return 'Friends'
      case 'private':
        return 'Private'
      case 'public':
      default:
        return null
    }
  }, [series.visibility])

  return (
    <SafeTouchableOpacity
      style={{
        width: cardWidth,
        height: cardHeight,
        backgroundColor: '#FFFFFF',
        borderColor: '#EDE7E1',
        borderWidth: 1,
      }}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${series.title}`}
      className="overflow-hidden"
    >
      <View className="w-full overflow-hidden bg-[#EDE9E3]" style={{ height: thumbnailHeight }}>
        {cover ? (
          <Image
            source={{ uri: cover }}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
            transition={200}
          />
        ) : (
          <View className="flex-1 items-center justify-center bg-[#EDE9E3]">
            <MaterialIcons name="layers" size={32} color="#8A8379" />
          </View>
        )}

        {visibilityLabel ? (
          <View className="absolute left-3 top-3 bg-black/60 px-2 py-1">
            <Text className="text-[10px] font-semibold uppercase tracking-[1px] text-white">
              {visibilityLabel}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="px-3 py-2">
        <AppText className="font-heading text-[15px] leading-5 text-text-primary" numberOfLines={1}>
          {series.title}
        </AppText>
        <View className="mt-1 flex-row items-center">
          <MaterialIcons name="video-library" size={14} color="#D85A21" />
          <AppText className="ml-1 text-[12px] leading-4 text-text-secondary" numberOfLines={1}>
            {episodeCount === 0
              ? 'No videos yet'
              : `${episodeCount} ${episodeCount === 1 ? 'video' : 'videos'}`}
          </AppText>
        </View>
      </View>
    </SafeTouchableOpacity>
  )
}

export default function ProfileScreen() {
  const router = useRouter()
  const { width: windowWidth } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const tabBarHeight = getDockedTabBarHeight(insets.bottom)
  const tileSize = useMemo(() => (windowWidth - 4) / 3, [windowWidth])
  const tileHeight = useMemo(() => Math.round(tileSize * 1.33), [tileSize])
  const seriesCardWidth = useMemo(() => Math.floor((windowWidth - 40 - 12) / 2), [windowWidth])
  const seriesCardHeight = useMemo(() => {
    const thumbnailHeight = Math.round(seriesCardWidth * 1.05)
    return thumbnailHeight + 60
  }, [seriesCardWidth])
  const createSeriesSheetRef = useRef<BottomSheetModal>(null)
  const createSeries = useCreateReelSeries()

  const { user } = useAuthStore()
  const { mutate: updateAvatar, isPending: isUpdatingAvatar } = useUpdateAvatar()
  const hasValidProfileUserId = isRfcUuid(user?.id)
  const profileUserId = hasValidProfileUserId ? user?.id : undefined
  const [activeContentTab, setActiveContentTab] = useState<ProfileContentTab>('public')
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
  const {
    data: seriesData,
    isPending: isSeriesPending,
    isRefetching: isSeriesRefetching,
    hasNextPage: hasNextSeriesPage,
    fetchNextPage: fetchNextSeriesPage,
    isFetchingNextPage: isFetchingNextSeriesPage,
    refetch: refetchSeries,
  } = useOwnedReelSeries({ limit: 6 }, { enabled: Boolean(user?.id) })

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
  const ownedSeries = useMemo(
    () => seriesData?.pages.flatMap((page) => page.items) ?? [],
    [seriesData],
  )
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

  const handleSettingsPress = useCallback(() => {
    router.push('/settings')
  }, [router])

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

  const handleRefresh = useCallback(() => {
    void Promise.all([refetchFriends(), refetchReels(), refetchSeries()])
  }, [refetchFriends, refetchReels, refetchSeries])

  const isRefreshing = isFriendsRefetching || isReelsRefetching || isSeriesRefetching

  const renderReelItem = useCallback(
    ({ item, index }: { item: Reel; index: number }) => {
      return (
        <ReelThumbnailTile
          index={index}
          onPress={() => {
            const contextReelsParam = serializeChatReelRouteContext(profileReels)
            router.push({
              pathname: '/reels/[id]',
              params: {
                id: item.id,
                source: 'profile',
                returnTo: 'profile',
                ...(contextReelsParam ? { contextReels: contextReelsParam } : {}),
              },
            })
          }}
          reel={item}
          tileSize={tileSize}
          tileHeight={tileHeight}
          disableMargins
        />
      )
    },
    [profileReels, router, tileHeight, tileSize],
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
      <FlatList
        key={activeContentTab === 'series' ? 'series-grid-2col' : 'reels-grid-3col'}
        data={(activeContentTab === 'series' ? ownedSeries : profileReels) as (Reel | ReelSeries)[]}
        numColumns={activeContentTab === 'series' ? 2 : 3}
        columnWrapperStyle={
          activeContentTab === 'series'
            ? { gap: 12, paddingHorizontal: 20, marginBottom: 12 }
            : { gap: 2, marginBottom: 2 }
        }
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => {
          if (activeContentTab === 'series') {
            const series = item as ReelSeries
            return (
              <SeriesHighlight
                series={series}
                cardWidth={seriesCardWidth}
                cardHeight={seriesCardHeight}
                onPress={() =>
                  router.push({
                    pathname: '/series/[id]' as never,
                    params: { id: series.id },
                  })
                }
              />
            )
          }
          return renderReelItem({ item: item as Reel, index })
        }}
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
          <View className="px-5 pb-5 pt-2">
            <View className="flex-row items-end justify-between pb-3">
              <View>
                <AppText className="text-xs2 font-semibold uppercase tracking-[1.8px] text-brand-dark">
                  Velora
                </AppText>
                <AppText className="font-display text-[28px] leading-[34px] tracking-[-0.7px] text-text-primary">
                  Profile
                </AppText>
              </View>

              <SafeTouchableOpacity
                className="h-12 w-12 items-center justify-center overflow-hidden rounded-[18px] border border-brand-soft bg-surface-accent"
                onPress={handleSettingsPress}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Open profile settings"
              >
                <MaterialIcons name="menu" size={21} color="#D85A21" />
              </SafeTouchableOpacity>
            </View>

            <View className="mt-3 flex-row items-center">
              <SafeTouchableOpacity
                className="relative"
                onPress={handlePickImage}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Edit profile photo"
              >
                {user.picture ? (
                  <Image
                    source={{ uri: user.picture }}
                    style={{
                      width: 88,
                      height: 88,
                      borderRadius: 28,
                      backgroundColor: '#F5F5F5',
                    }}
                  />
                ) : (
                  <View className="h-[88px] w-[88px] items-center justify-center rounded-[28px] bg-surface-muted">
                    <AppText className="font-heading text-[28px] text-text-primary">
                      {getInitials(displayName)}
                    </AppText>
                  </View>
                )}

                <View className="absolute -bottom-1 -right-1 h-8 w-8 items-center justify-center rounded-[12px] border-2 border-bg-primary bg-brand">
                  {isUpdatingAvatar ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <MaterialIcons name="photo-camera" size={15} color="#FFFFFF" />
                  )}
                </View>
              </SafeTouchableOpacity>

              <View className="ml-4 min-w-0 flex-1">
                <AppText
                  className="font-heading text-[26px] leading-[30px] text-text-primary"
                  numberOfLines={1}
                >
                  {displayName}
                </AppText>
                <AppText
                  className="mt-1 text-sm2 font-medium text-text-secondary"
                  numberOfLines={1}
                >
                  @{profileHandle}
                </AppText>
              </View>
            </View>

            <View className="mt-6">
              <View className="flex-row items-center justify-between">
                <AppPressable
                  className="flex-row items-center py-1"
                  onPress={() => router.push('/friends')}
                  accessibilityRole="button"
                  accessibilityLabel="Open friends"
                >
                  <AppText className="text-xs2 font-semibold uppercase tracking-[1.4px] text-text-muted">
                    Friends
                  </AppText>
                  <AppText className="ml-2 text-xs2 text-text-muted">{friendsValue}</AppText>
                </AppPressable>
                <AppPressable
                  className="py-1"
                  onPress={() => router.push('/friends')}
                  accessibilityRole="button"
                  accessibilityLabel="Manage friends"
                >
                  <AppText className="text-sm2 font-semibold text-brand">Manage</AppText>
                </AppPressable>
              </View>

              {isFriendsPending || friendHighlights.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingTop: 10, paddingRight: 20 }}
                >
                  {isFriendsPending && friends.length === 0 ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <FriendSkeleton key={`friend-skeleton-${index}`} />
                    ))
                  ) : (
                    <>
                      {friendHighlights.map((friend) => (
                        <FriendHighlight
                          key={friend.id}
                          friend={friend}
                          onPress={() => handleFriendPress(friend.user.username)}
                        />
                      ))}

                      {extraFriendsCount > 0 ? (
                        <View className="mr-[14px] items-center" style={{ width: 64 }}>
                          <View className="h-[60px] w-[60px] items-center justify-center rounded-[20px] bg-surface-muted">
                            <AppText className="font-heading text-base2 text-text-primary">
                              +{extraFriendsCount}
                            </AppText>
                          </View>
                          <AppText className="mt-2 text-sm2 text-text-secondary">More</AppText>
                        </View>
                      ) : null}
                    </>
                  )}
                </ScrollView>
              ) : (
                <View className="min-h-16 items-center justify-center px-4 py-3">
                  <AppText className="text-center text-sm2 font-semibold text-text-primary">
                    No friends yet
                  </AppText>
                  <AppText className="mt-1 text-center text-sm2 text-text-secondary">
                    Friends you add will appear here.
                  </AppText>
                </View>
              )}
            </View>

            <View className="mt-6 min-h-[26px] flex-row items-center justify-between">
              <AppText className="text-xs2 font-semibold uppercase tracking-[1.4px] text-text-muted">
                Content
              </AppText>
              {activeContentTab === 'series' ? (
                <AppPressable
                  className="flex-row items-center py-1"
                  onPress={() => createSeriesSheetRef.current?.present()}
                  accessibilityRole="button"
                  accessibilityLabel="Create series"
                >
                  <MaterialIcons name="add" size={16} color="#FF6B2C" />
                  <AppText className="ml-0.5 text-sm2 font-semibold text-brand">New series</AppText>
                </AppPressable>
              ) : null}
            </View>

            <View className="mt-2 rounded-full border border-border-light bg-bg-primary p-1">
              <View className="flex-row gap-1">
                {(
                  [
                    { icon: 'grid-on', label: 'Public', value: 'public' },
                    { icon: 'video-library', label: 'Series', value: 'series' },
                    { icon: 'lock-outline', label: 'Private', value: 'private' },
                  ] as const
                ).map((tab) => {
                  const isActive = activeContentTab === tab.value

                  return (
                    <Pressable
                      key={tab.value}
                      className="h-11 flex-1 flex-row items-center justify-center rounded-full px-3"
                      onPress={() => {
                        setActiveContentTab(tab.value)
                        if (tab.value !== 'series') {
                          setActiveReelsVisibility(tab.value)
                        }
                      }}
                      collapsable={false}
                      style={({ pressed }) => ({
                        backgroundColor: isActive ? '#FFF4EC' : '#F5F5F5',
                        borderColor: isActive ? '#FFF0E4' : '#F4F4F4',
                        borderWidth: 1,
                        opacity: pressed ? 0.76 : 1,
                      })}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={tab.value === 'series' ? 'Series' : `${tab.label} reels`}
                    >
                      <MaterialIcons
                        name={tab.icon}
                        size={18}
                        color={isActive ? '#D85A21' : '#6F6861'}
                      />
                      <AppText
                        className="ml-2 text-sm2 font-semibold"
                        style={{ color: isActive ? '#D85A21' : '#777777' }}
                      >
                        {tab.label}
                      </AppText>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          activeContentTab === 'series' ? (
            isSeriesPending && ownedSeries.length === 0 ? (
              <SeriesLoadingList cardWidth={seriesCardWidth} cardHeight={seriesCardHeight} />
            ) : (
              <EmptySeriesState onCreate={() => createSeriesSheetRef.current?.present()} />
            )
          ) : isReelsPending ? (
            <ReelsLoadingGrid tileSize={tileSize} tileHeight={tileHeight} />
          ) : (
            <EmptyReelsState onCreate={handleCreateReel} visibility={activeReelsVisibility} />
          )
        }
        ListFooterComponent={
          (activeContentTab === 'series' ? isFetchingNextSeriesPage : isFetchingNextPage) ? (
            <View className="py-5">
              <ActivityIndicator color="#FF6B2C" size="small" />
            </View>
          ) : null
        }
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          if (activeContentTab === 'series') {
            if (hasNextSeriesPage && !isFetchingNextSeriesPage) {
              void fetchNextSeriesPage()
            }
          } else {
            if (hasNextPage && !isFetchingNextPage) {
              void fetchNextPage()
            }
          }
        }}
      />

      <ReelSeriesPickerSheet
        sheetRef={createSeriesSheetRef}
        initialVisibility="public"
        initialMode="create"
        allowNone={false}
        title="Create series"
        subtitle="Group related reels into episodes."
        onSelect={() => {}}
        onCreate={async (payload) => {
          const created = await createSeries.mutateAsync(payload)
          router.push({
            pathname: '/series/[id]/manage' as never,
            params: { id: created.id, openPicker: 'true' },
          })
        }}
      />
    </SafeAreaView>
  )
}
