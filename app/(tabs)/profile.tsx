import { MaterialIcons } from '@expo/vector-icons'
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs'
import { format } from 'date-fns'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  ReelThumbnailGridSkeleton,
  ReelThumbnailTile,
} from '../../src/components/reels/ReelThumbnailGrid'
import { useFriends } from '../../src/hooks/useFriends'
import { useUpdateAvatar } from '../../src/hooks/useProfile'
import { useReelsFeed } from '../../src/hooks/useReels'
import { getDisplayName, getInitials, getProfileHandle } from '../../src/lib/profile'
import { useAuthStore } from '../../src/stores/authStore'

import type { FriendSummary } from '../../src/types/friend.types'
import type { Reel, ReelVisibility } from '../../src/types/reel.types'

const PROFILE_REELS_LIMIT = 24
const RFC_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const getMemberSince = (createdAt?: string) => {
  if (!createdAt) return 'Recently joined'

  try {
    return format(new Date(createdAt), 'MMM yyyy')
  } catch {
    return 'Recently joined'
  }
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
  return <ReelThumbnailGridSkeleton tileSize={tileSize} />
}

export default function ProfileScreen() {
  const router = useRouter()
  const { width: windowWidth } = useWindowDimensions()
  const tabBarHeight = useBottomTabBarHeight()
  const tileSize = useMemo(() => Math.floor((windowWidth - 4) / 3), [windowWidth])

  const { user } = useAuthStore()
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

  const renderReelItem = useCallback(
    ({ item, index }: { item: Reel; index: number }) => {
      return (
        <ReelThumbnailTile
          index={index}
          onPress={() => {
            router.push({
              pathname: '/reels/[id]',
              params: { id: item.id, source: 'profile', returnTo: 'profile' },
            })
          }}
          reel={item}
          tileSize={tileSize}
        />
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
              <View className="flex-row items-center justify-between">
                <Pressable
                  className="flex-row items-center"
                  onPress={() => router.push('/friends')}
                >
                  <Text className="font-heading text-lg text-text-primary">Friends</Text>
                  <View className="ml-2 rounded-full bg-surface-muted px-3 py-1.5">
                    <Text className="text-xs2 uppercase tracking-[1px] text-text-secondary">
                      {friendsValue}
                    </Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => router.push('/friends')}>
                  <Text className="font-medium text-sm2 text-brand">Manage</Text>
                </Pressable>
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
    </SafeAreaView>
  )
}
