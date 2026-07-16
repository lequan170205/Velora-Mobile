import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import React, { useCallback, useMemo } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { useUnblockUser } from '../src/hooks/useFriendMutations'
import { useBlockedUsersInfiniteQuery } from '../src/hooks/useFriends'
import { getInitials } from '../src/lib/profile'

import type { BlockedUserSummary } from '../src/types/friend.types'

function Avatar({ user }: { user: BlockedUserSummary['user'] }) {
  return user.picture ? (
    <Image source={{ uri: user.picture }} style={{ width: 48, height: 48, borderRadius: 24 }} />
  ) : (
    <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-muted">
      <Text className="font-heading text-sm2 text-text-primary">{getInitials(user.fullName)}</Text>
    </View>
  )
}

function BlockedAccountSkeleton() {
  return (
    <View className="border-b border-border-light px-5 py-4">
      <View className="flex-row items-center">
        <View className="h-12 w-12 rounded-full bg-surface-muted" />
        <View className="ml-3 flex-1">
          <View className="h-4 w-32 rounded-full bg-surface-muted" />
          <View className="mt-2 h-3 w-20 rounded-full bg-surface-muted" />
        </View>
        <View className="h-9 w-20 rounded-full bg-surface-muted" />
      </View>
    </View>
  )
}

function EmptyState() {
  return (
    <View className="items-center px-8 pt-20">
      <View className="h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
        <MaterialIcons name="block" size={26} color="#D85A21" />
      </View>
      <Text className="mt-4 font-heading text-lg text-text-primary">No blocked accounts</Text>
      <Text className="mt-2 text-center text-sm2 text-text-secondary">
        Accounts you block will appear here.
      </Text>
    </View>
  )
}

export default function BlockedAccountsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const blockedUsersQuery = useBlockedUsersInfiniteQuery()
  const unblockUser = useUnblockUser()
  const blockedUsers = useMemo(
    () => blockedUsersQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [blockedUsersQuery.data],
  )

  const confirmUnblock = useCallback(
    (blockedUser: BlockedUserSummary) => {
      if (unblockUser.isPending) return

      Alert.alert(
        'Unblock account?',
        `You can find ${blockedUser.user.fullName} again after unblocking.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unblock',
            onPress: () => unblockUser.mutate(blockedUser.user.id),
          },
        ],
      )
    },
    [unblockUser],
  )

  const renderItem = useCallback(
    ({ item }: { item: BlockedUserSummary }) => {
      const isUnblocking = unblockUser.isPending && unblockUser.variables === item.user.id
      const username = item.user.username?.trim().replace(/^@+/, '')

      return (
        <View className="border-b border-border-light px-5 py-4">
          <View className="flex-row items-center">
            <View className="flex-1 flex-row items-center">
              <Avatar user={item.user} />
              <View className="ml-3 flex-1 pr-3">
                <Text className="font-medium text-md text-text-primary" numberOfLines={1}>
                  {item.user.fullName}
                </Text>
                {username ? (
                  <Text className="mt-0.5 text-sm2 text-text-secondary" numberOfLines={1}>
                    @{username}
                  </Text>
                ) : null}
              </View>
            </View>
            <Pressable
              accessibilityLabel={`Unblock ${item.user.fullName}`}
              accessibilityRole="button"
              className="min-w-[80px] items-center rounded-full border border-border-light bg-surface-card px-3 py-2"
              disabled={isUnblocking || unblockUser.isPending}
              onPress={() => confirmUnblock(item)}
              style={{ opacity: isUnblocking || unblockUser.isPending ? 0.65 : 1 }}
            >
              {isUnblocking ? (
                <ActivityIndicator color="#161616" size="small" />
              ) : (
                <Text className="font-medium text-sm2 text-text-primary">Unblock</Text>
              )}
            </Pressable>
          </View>
        </View>
      )
    },
    [confirmUnblock, unblockUser.isPending, unblockUser.variables],
  )

  const loadMore = useCallback(() => {
    if (blockedUsersQuery.hasNextPage && !blockedUsersQuery.isFetchingNextPage) {
      void blockedUsersQuery.fetchNextPage()
    }
  }, [blockedUsersQuery])

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <View className="flex-row items-center px-5 pb-4 pt-2">
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          className="mr-3 h-11 w-11 items-center justify-center rounded-full border border-border-light bg-surface-card"
          onPress={() => router.back()}
        >
          <MaterialIcons name="arrow-back" size={22} color="#161616" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-xs2 uppercase tracking-[1.2px] text-text-muted">Privacy</Text>
          <Text className="mt-1 font-heading text-[28px] text-text-primary">Blocked accounts</Text>
        </View>
      </View>

      {blockedUsersQuery.isLoading && blockedUsers.length === 0 ? (
        <View>
          <BlockedAccountSkeleton />
          <BlockedAccountSkeleton />
          <BlockedAccountSkeleton />
        </View>
      ) : blockedUsersQuery.isError && blockedUsers.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center font-medium text-md text-text-primary">
            Could not load blocked accounts
          </Text>
          <Pressable
            accessibilityLabel="Retry loading blocked accounts"
            className="mt-4 rounded-full bg-brand px-4 py-2.5"
            onPress={() => {
              void blockedUsersQuery.refetch()
            }}
          >
            <Text className="font-medium text-sm2 text-white">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 24 }}
          data={blockedUsers}
          keyExtractor={(item) => item.user.id}
          ListEmptyComponent={<EmptyState />}
          ListFooterComponent={
            blockedUsersQuery.isFetchingNextPage ? (
              <View className="py-5">
                <ActivityIndicator color="#D85A21" size="small" />
              </View>
            ) : null
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  )
}
