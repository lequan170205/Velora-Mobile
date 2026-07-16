import { MaterialIcons } from '@expo/vector-icons'
import { formatDistanceToNow } from 'date-fns'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  useAcceptFriendRequest,
  useCancelFriendRequest,
  useRejectFriendRequest,
  useRemoveFriend,
} from '../../src/hooks/useFriendMutations'
import {
  useFriends,
  useIncomingFriendRequests,
  useOutgoingFriendRequests,
} from '../../src/hooks/useFriends'
import { getInitials } from '../../src/lib/profile'

import type {
  FriendRequestSummary,
  FriendSummary,
  PublicFriendProfile,
} from '../../src/types/friend.types'

type Section = 'friends' | 'received' | 'sent'
type Item =
  { kind: 'friend'; value: FriendSummary } | { kind: 'request'; value: FriendRequestSummary }

const EMPTY_FRIENDS: FriendSummary[] = []

const getRelativeDate = (date: string) => {
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true })
  } catch {
    return ''
  }
}

function Avatar({ user }: { user: PublicFriendProfile }) {
  return user.picture ? (
    <Image source={{ uri: user.picture }} style={{ width: 48, height: 48, borderRadius: 24 }} />
  ) : (
    <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-muted">
      <Text className="font-heading text-sm2 text-text-primary">{getInitials(user.fullName)}</Text>
    </View>
  )
}

function Action({
  disabled,
  label,
  onPress,
  tone,
}: {
  disabled: boolean
  label: string
  onPress: () => void
  tone: 'primary' | 'secondary' | 'danger'
}) {
  const className =
    tone === 'primary'
      ? 'bg-brand'
      : tone === 'danger'
        ? 'bg-[#FFF2F0]'
        : 'border border-border-light bg-surface-card'
  const textClassName =
    tone === 'primary'
      ? 'text-white'
      : tone === 'danger'
        ? 'text-status-error'
        : 'text-text-primary'

  return (
    <Pressable
      className={`min-w-[80px] items-center rounded-full px-3 py-2 ${className}`}
      disabled={disabled}
      onPress={onPress}
      style={{ opacity: disabled ? 0.65 : 1 }}
    >
      <Text className={`font-medium text-sm2 ${textClassName}`}>{label}</Text>
    </Pressable>
  )
}

function EmptyState({ section }: { section: Section }) {
  const content =
    section === 'friends'
      ? ['No friends yet', 'People you add will appear here.']
      : section === 'received'
        ? ['No new requests', 'Friend requests sent to you will appear here.']
        : ['No sent requests', 'Requests you send will stay here until answered.']

  return (
    <View className="items-center px-8 pt-20">
      <View className="h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
        <MaterialIcons name="people-outline" size={28} color="#D85A21" />
      </View>
      <Text className="mt-4 font-heading text-lg text-text-primary">{content[0]}</Text>
      <Text className="mt-2 text-center text-sm2 text-text-secondary">{content[1]}</Text>
    </View>
  )
}

export default function FriendsScreen() {
  const router = useRouter()
  const { section: sectionParam } = useLocalSearchParams<{ section?: Section }>()
  const insets = useSafeAreaInsets()
  const [section, setSection] = useState<Section>('friends')

  useEffect(() => {
    if (sectionParam === 'received' || sectionParam === 'sent' || sectionParam === 'friends') {
      setSection(sectionParam)
    }
  }, [sectionParam])
  const friendsQuery = useFriends()
  const incomingQuery = useIncomingFriendRequests()
  const outgoingQuery = useOutgoingFriendRequests()
  const accept = useAcceptFriendRequest()
  const reject = useRejectFriendRequest()
  const cancel = useCancelFriendRequest()
  const remove = useRemoveFriend()
  const friends = friendsQuery.data ?? EMPTY_FRIENDS
  const incoming = useMemo(
    () => incomingQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [incomingQuery.data],
  )
  const outgoing = useMemo(
    () => outgoingQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [outgoingQuery.data],
  )
  const items = useMemo<Item[]>(() => {
    if (section === 'friends') return friends.map((value) => ({ kind: 'friend', value }))
    return (section === 'received' ? incoming : outgoing).map((value) => ({
      kind: 'request',
      value,
    }))
  }, [friends, incoming, outgoing, section])
  const activeQuery =
    section === 'friends' ? friendsQuery : section === 'received' ? incomingQuery : outgoingQuery
  const isLoading = activeQuery.isLoading && items.length === 0
  const isFetchingNext =
    section === 'received' ? incomingQuery.isFetchingNextPage : outgoingQuery.isFetchingNextPage
  const hasNextPage = section === 'received' ? incomingQuery.hasNextPage : outgoingQuery.hasNextPage
  const isPendingRequest = useCallback(
    (requestId: string) =>
      (accept.isPending && accept.variables?.requestId === requestId) ||
      (reject.isPending && reject.variables?.requestId === requestId) ||
      (cancel.isPending && cancel.variables?.requestId === requestId),
    [accept, cancel, reject],
  )
  const refresh = useCallback(() => {
    void activeQuery.refetch()
  }, [activeQuery])
  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNext) return
    if (section === 'received') {
      void incomingQuery.fetchNextPage()
      return
    }
    void outgoingQuery.fetchNextPage()
  }, [hasNextPage, incomingQuery, isFetchingNext, outgoingQuery, section])
  const openProfile = useCallback((username: string) => router.push(`/users/${username}`), [router])
  const confirmRemoval = useCallback(
    (friend: FriendSummary) => {
      if (remove.isPending) return
      Alert.alert(
        'Remove friend?',
        `${friend.user.fullName} will be removed from your friends list.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(friend.user.id) },
        ],
      )
    },
    [remove],
  )
  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      const user = item.value.user
      const requestPending = item.kind === 'request' && isPendingRequest(item.value.id)
      const removing = item.kind === 'friend' && remove.isPending && remove.variables === user.id

      return (
        <View className="border-b border-border-light px-5 py-4">
          <View className="flex-row items-center">
            <Pressable
              className="flex-1 flex-row items-center"
              onPress={() => openProfile(user.username)}
            >
              <Avatar user={user} />
              <View className="ml-3 flex-1 pr-3">
                <Text className="font-medium text-md text-text-primary" numberOfLines={1}>
                  {user.fullName}
                </Text>
                <Text className="mt-0.5 text-sm2 text-text-secondary" numberOfLines={1}>
                  @{user.username}
                </Text>
                {item.kind === 'request' ? (
                  <Text className="mt-1 text-xs2 text-text-muted">
                    {getRelativeDate(item.value.requestedAt)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            {item.kind === 'friend' ? (
              <Action
                disabled={removing}
                label={removing ? 'Removing...' : 'Remove'}
                onPress={() => confirmRemoval(item.value)}
                tone="danger"
              />
            ) : section === 'received' ? (
              <View className="flex-row gap-2">
                <Action
                  disabled={requestPending}
                  label={requestPending ? 'Working...' : 'Accept'}
                  onPress={() =>
                    accept.mutate({
                      requestId: item.value.id,
                      userId: user.id,
                      requester: user,
                      requestedAt: item.value.requestedAt,
                    })
                  }
                  tone="primary"
                />
                <Action
                  disabled={requestPending}
                  label="Reject"
                  onPress={() => reject.mutate({ requestId: item.value.id, userId: user.id })}
                  tone="secondary"
                />
              </View>
            ) : (
              <Action
                disabled={requestPending}
                label={requestPending ? 'Working...' : 'Cancel'}
                onPress={() => cancel.mutate({ requestId: item.value.id, userId: user.id })}
                tone="secondary"
              />
            )}
          </View>
        </View>
      )
    },
    [accept, cancel, confirmRemoval, isPendingRequest, openProfile, reject, remove, section],
  )

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <View className="px-5 pb-4 pt-2">
        <Text className="text-xs2 uppercase tracking-[1.2px] text-text-muted">Community</Text>
        <View className="mt-1 flex-row items-center justify-between">
          <Text className="font-heading text-[30px] text-text-primary">Friends</Text>
          {incoming.length > 0 ? (
            <Pressable
              className="flex-row items-center rounded-full bg-brand-soft px-3 py-2"
              onPress={() => setSection('received')}
            >
              <MaterialIcons name="person-add-alt-1" size={16} color="#D85A21" />
              <Text className="ml-1.5 font-medium text-sm2 text-brand">{incoming.length} new</Text>
            </Pressable>
          ) : null}
        </View>
        <Text className="mt-1 text-base2 text-text-secondary">
          Manage your friendships and requests.
        </Text>
      </View>

      <View className="mx-5 flex-row rounded-[20px] bg-surface-muted p-1">
        {(
          [
            ['friends', 'Friends'],
            ['received', 'Received'],
            ['sent', 'Sent'],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            className={`flex-1 rounded-[16px] px-2 py-2.5 ${section === value ? 'bg-white' : ''}`}
            onPress={() => setSection(value)}
          >
            <Text
              className={`text-center font-medium text-sm2 ${
                section === value ? 'text-text-primary' : 'text-text-secondary'
              }`}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#D85A21" size="large" />
        </View>
      ) : activeQuery.isError && items.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center font-medium text-md text-text-primary">
            Could not load friends
          </Text>
          <Pressable className="mt-4 rounded-full bg-brand px-4 py-2.5" onPress={refresh}>
            <Text className="font-medium text-sm2 text-white">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.value.id}
          renderItem={renderItem}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: Math.max(insets.bottom, 20) + 20 }}
          refreshControl={
            <RefreshControl
              refreshing={activeQuery.isRefetching}
              onRefresh={refresh}
              colors={['#D85A21']}
            />
          }
          ListEmptyComponent={<EmptyState section={section} />}
          ListFooterComponent={
            hasNextPage ? (
              <Pressable
                className="mx-5 my-5 items-center rounded-full border border-border-light bg-surface-card py-3"
                disabled={isFetchingNext}
                onPress={loadMore}
              >
                {isFetchingNext ? (
                  <ActivityIndicator color="#D85A21" size="small" />
                ) : (
                  <Text className="font-medium text-sm2 text-text-primary">Load more</Text>
                )}
              </Pressable>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  )
}
