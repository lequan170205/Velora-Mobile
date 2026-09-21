import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { conversationApi } from '../../src/api/conversation.api'
import { AppText } from '../../src/components/base'
import { SafeTouchableOpacity } from '../../src/components/common/SafeTouchableOpacity'
import { ProfileActionsMenu } from '../../src/components/profile/ProfileActionsMenu'
import {
  ReelThumbnailGridSkeleton,
  ReelThumbnailTile,
} from '../../src/components/reels/ReelThumbnailGrid'
import { colors } from '../../src/constants/theme'
import { usePublicProfile } from '../../src/hooks/useContacts'
import { useConversationNavigation } from '../../src/hooks/useConversationNavigation'
import { getConversationsQueryOptions } from '../../src/hooks/useConversations'
import {
  useBlockUser,
  useRemoveFriend,
  useSendFriendRequest,
} from '../../src/hooks/useFriendMutations'
import { useFriends, useFriendshipStatus } from '../../src/hooks/useFriends'
import { useReelsFeed } from '../../src/hooks/useReels'
import { serializeChatReelRouteContext } from '../../src/lib/chatReels'
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
    <View className="items-center px-5 pb-2 pt-7">
      <View className="h-12 w-12 items-center justify-center rounded-[18px] border border-brand-soft bg-surface-accent">
        <MaterialIcons name="play-circle-outline" size={24} color="#D85A21" />
      </View>
      <AppText className="mt-4 text-center font-heading text-lg text-text-primary">
        No public reels yet
      </AppText>
      <AppText className="mt-1.5 text-center text-base2 leading-5 text-text-secondary">
        Public reels from this profile will appear here.
      </AppText>
    </View>
  )
}

function ReelsLoadingGrid({ tileSize, tileHeight }: { tileSize: number; tileHeight: number }) {
  return <ReelThumbnailGridSkeleton tileSize={tileSize} tileHeight={tileHeight} />
}

function FriendHighlight({ friend, onPress }: { friend: FriendSummary; onPress: () => void }) {
  return (
    <SafeTouchableOpacity
      className="mr-[14px] items-center"
      style={{ width: 64 }}
      hitSlop={0}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Open @${friend.user.username}'s profile`}
    >
      <View className="h-[60px] w-[60px] items-center justify-center overflow-hidden rounded-[20px] bg-surface-muted">
        {friend.user.picture ? (
          <Image
            source={{ uri: friend.user.picture }}
            style={{ width: 60, height: 60, borderRadius: 20, backgroundColor: '#F5F5F5' }}
          />
        ) : (
          <View className="h-[60px] w-[60px] items-center justify-center rounded-[20px] bg-surface-muted">
            <AppText className="font-heading text-lg text-text-primary">
              {getInitials(friend.user.fullName)}
            </AppText>
          </View>
        )}
      </View>
      <AppText
        className="mt-2 text-center text-sm2 font-medium text-text-primary"
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{ width: 64 }}
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

export default function PublicProfileScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const tileSize = useMemo(() => (windowWidth - 4) / 3, [windowWidth])
  const tileHeight = useMemo(() => Math.round(tileSize * 1.33), [tileSize])
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
  const blockSubmissionStartedRef = useRef(false)
  const profileActionsSheetRef = useRef<BottomSheetModal>(null)
  const removeSheetRef = useRef<BottomSheetModal>(null)

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
  const removeFriend = useRemoveFriend()
  const blockUser = useBlockUser()
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
    sendFriendRequest.isPending || removeFriend.isPending || blockUser.isPending
  const isPending = pendingAction !== null || isFriendActionPending
  const status = friendshipStatus?.status ?? 'none'
  const currentUserId = useAuthStore((state) => state.user?.id)
  const isOwnProfile = Boolean(profile?.id && currentUserId && profile.id === currentUserId)
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
    }
  }, [])

  const renderRemoveSheetBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        accessibilityLabel="Close remove friend options"
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.44}
        pressBehavior={removeFriend.isPending ? 'none' : 'close'}
      />
    ),
    [removeFriend.isPending],
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

  const openFriendRequests = useCallback(() => {
    router.push('/(tabs)/friends?section=received')
  }, [router])

  const handleOpenRemoveSheet = useCallback(() => {
    if (!profile?.id) return
    setActionErrorMessage(null)
    requestAnimationFrame(() => removeSheetRef.current?.present())
  }, [profile?.id])

  const handleCloseRemoveSheet = useCallback(() => {
    removeSheetRef.current?.dismiss()
  }, [])

  const handleConfirmRemoveFriend = useCallback(() => {
    if (!profile?.id) return

    removeFriend.mutate(profile.id, {
      onSuccess: () => removeSheetRef.current?.dismiss(),
    })
  }, [profile?.id, removeFriend])

  const handleOpenProfileActions = useCallback(() => {
    if (!profile?.id || isOwnProfile || blockUser.isPending) return

    requestAnimationFrame(() => profileActionsSheetRef.current?.present())
  }, [blockUser.isPending, isOwnProfile, profile?.id])

  const handleCloseProfileActions = useCallback(() => {}, [])

  const handleBlockUser = useCallback(() => {
    if (!profile?.id || isOwnProfile || blockUser.isPending || blockSubmissionStartedRef.current) {
      return
    }

    const handleLabel = getHandleLabel(profile.username)

    Alert.alert(`Block ${handleLabel}?`, 'You will no longer see content from this user.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          if (blockUser.isPending || blockSubmissionStartedRef.current) return

          blockSubmissionStartedRef.current = true

          blockUser.mutate(profile.id, {
            onSuccess: () => {
              router.back()
            },
            onSettled: () => {
              blockSubmissionStartedRef.current = false
            },
          })
        },
      },
    ])
  }, [blockUser, isOwnProfile, profile?.id, profile?.username, router])

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

  const renderReelItem = useCallback(
    ({ item, index }: { item: Reel; index: number }) => {
      return (
        <ReelThumbnailTile
          index={index}
          onPress={() => {
            const contextReelsParam = serializeChatReelRouteContext(publicReels)
            router.push({
              pathname: '/reels/[id]',
              params: {
                id: item.id,
                source: 'profile',
                returnTo: 'user-profile',
                returnUsername: normalizedUsername,
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
    [normalizedUsername, publicReels, router, tileHeight, tileSize],
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
        columnWrapperStyle={{ gap: 2, marginBottom: 2 }}
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
          <View className="px-5 pb-5 pt-2">
            <View className="flex-row items-center justify-between pb-3">
              <SafeTouchableOpacity
                accessibilityLabel="Go back"
                accessibilityRole="button"
                activeOpacity={0.75}
                className="h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[18px] bg-surface-muted"
                onPress={() => router.back()}
              >
                <MaterialIcons name="arrow-back" size={22} color={colors.text.primary} />
              </SafeTouchableOpacity>

              <View className="min-w-0 flex-1 items-center px-3">
                <AppText className="font-heading text-lg text-text-primary">Profile</AppText>
              </View>

              {!isOwnProfile ? (
                <SafeTouchableOpacity
                  accessibilityLabel={`More options for ${getHandleLabel(profile.username)}`}
                  accessibilityRole="button"
                  activeOpacity={0.75}
                  className="h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-brand-soft bg-surface-accent"
                  disabled={blockUser.isPending}
                  onPress={handleOpenProfileActions}
                  style={{ opacity: blockUser.isPending ? 0.65 : 1 }}
                >
                  <MaterialIcons name="more-horiz" size={22} color="#D85A21" />
                </SafeTouchableOpacity>
              ) : (
                <View className="h-12 w-12 shrink-0" />
              )}
            </View>

            <View className="mt-3 flex-row items-center">
              {profile.picture ? (
                <Image
                  source={{ uri: profile.picture }}
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
                    {getInitials(profile.fullName)}
                  </AppText>
                </View>
              )}

              <View className="ml-4 min-w-0 flex-1">
                <AppText
                  className="font-heading text-[26px] leading-[30px] text-text-primary"
                  numberOfLines={1}
                >
                  {profile.fullName}
                </AppText>
                <AppText
                  className="mt-1 text-sm2 font-medium text-text-secondary"
                  numberOfLines={1}
                >
                  {getHandleLabel(profile.username)}
                </AppText>
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
                        onPress={handleOpenRemoveSheet}
                        variant="secondary"
                      />
                    </View>
                  </View>
                ) : status === 'request_received' ? (
                  <ActionButton
                    disabled={isStatusLoading || isStatusFetching}
                    isPending={false}
                    label="Respond in Friend Requests"
                    onPress={openFriendRequests}
                    variant="secondary"
                  />
                ) : status === 'request_sent' ? (
                  <View className="items-center rounded-full border border-border-light bg-surface-card px-5 py-3">
                    <Text className="font-medium text-text-secondary">Request sent</Text>
                  </View>
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

            <View className="mt-6">
              <View className="flex-row items-center justify-between">
                <AppText className="text-xs2 font-semibold uppercase tracking-[1.4px] text-text-muted">
                  Friends
                </AppText>
                <AppText className="text-sm2 text-text-muted">{friendsValue}</AppText>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingTop: 10, paddingRight: 20 }}
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
                ) : (
                  <View className="rounded-[18px] bg-surface-accent px-4 py-3">
                    <AppText className="text-sm2 font-medium text-text-primary">
                      No friends yet
                    </AppText>
                    <AppText className="mt-0.5 text-sm2 text-text-secondary">
                      This profile has no friends to show yet.
                    </AppText>
                  </View>
                )}
              </ScrollView>
            </View>

            <View className="mt-6 flex-row items-center justify-between">
              <AppText className="text-xs2 font-semibold uppercase tracking-[1.4px] text-text-muted">
                Public reels
              </AppText>
              <AppText className="text-sm2 text-text-muted">
                {publicReels.length} {publicReels.length === 1 ? 'reel' : 'reels'}
              </AppText>
            </View>
          </View>
        }
        ListEmptyComponent={
          isReelsPending ? (
            <ReelsLoadingGrid tileSize={tileSize} tileHeight={tileHeight} />
          ) : (
            <EmptyReelsState />
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

      <ProfileActionsMenu
        onBlock={handleBlockUser}
        onClose={handleCloseProfileActions}
        sheetRef={profileActionsSheetRef}
        username={getHandleLabel(profile.username)}
      />

      <BottomSheetModal
        ref={removeSheetRef}
        enableDynamicSizing
        enablePanDownToClose={!removeFriend.isPending}
        backdropComponent={renderRemoveSheetBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 18) }}>
          <View className="px-5 pb-1">
            <View className="mt-1 flex-row items-start justify-between">
              <View className="flex-1 pr-4">
                <Text className="font-heading text-xl text-text-primary">Remove friend?</Text>
                <Text className="mt-2 text-base2 leading-6 text-text-secondary">
                  {profile.fullName} will be removed from your friends list. You can add{' '}
                  {getHandleLabel(profile.username)} again later.
                </Text>
              </View>

              <Pressable
                accessibilityLabel="Close remove friend options"
                accessibilityRole="button"
                className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
                disabled={removeFriend.isPending}
                onPress={handleCloseRemoveSheet}
              >
                <MaterialIcons name="close" size={20} color="#161616" />
              </Pressable>
            </View>

            <View className="mt-6 flex-row">
              <Pressable
                accessibilityLabel="Cancel removing friend"
                accessibilityRole="button"
                className="mr-3 flex-1 rounded-full border border-border-light bg-surface-muted py-3"
                disabled={removeFriend.isPending}
                onPress={handleCloseRemoveSheet}
              >
                <Text className="text-center font-medium text-text-primary">Cancel</Text>
              </Pressable>

              <Pressable
                accessibilityLabel={`Remove ${profile.fullName} from friends`}
                accessibilityRole="button"
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
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  handleIndicator: {
    backgroundColor: '#D9D9D9',
    borderRadius: 9999,
    height: 6,
    width: 56,
  },
  sheetBackground: {
    backgroundColor: colors.surface.modal,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    elevation: 18,
    shadowColor: 'rgba(22, 22, 22, 0.18)',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 1,
    shadowRadius: 24,
  },
})
