import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { useFocusEffect } from '@react-navigation/native'
import { formatDistanceToNow } from 'date-fns'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppPressable, AppText } from '../../src/components/base'
import { ChatAvatar } from '../../src/components/chat/ChatAvatar'
import { SafeTouchableOpacity } from '../../src/components/common/SafeTouchableOpacity'
import { getDockedTabBarHeight } from '../../src/components/navigation/CustomTabBar'
import { colors } from '../../src/constants/theme'
import {
  useAcceptFriendRequest,
  useBlockUser,
  useCancelFriendRequest,
  useRejectFriendRequest,
  useRemoveFriend,
} from '../../src/hooks/useFriendMutations'
import {
  useFriends,
  useIncomingFriendRequests,
  useOutgoingFriendRequests,
} from '../../src/hooks/useFriends'

import type { FriendRequestSummary, FriendSummary } from '../../src/types/friend.types'

type Section = 'friends' | 'received' | 'sent'
type Item =
  | { kind: 'friend'; value: FriendSummary }
  | {
      kind: 'request'
      value: FriendRequestSummary
    }

const EMPTY_FRIENDS: FriendSummary[] = []

const getRelativeDate = (date: string) => {
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true })
  } catch {
    return ''
  }
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
  tone: 'primary' | 'secondary'
}) {
  return (
    <AppPressable
      className={`h-9 min-w-[72px] items-center justify-center overflow-hidden rounded-full px-3 ${
        tone === 'primary' ? 'bg-brand' : 'border border-border-light bg-bg-primary'
      }`}
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.8}
      style={{ opacity: disabled ? 0.6 : 1 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <AppText
        className={`text-sm2 font-semibold ${
          tone === 'primary' ? 'text-white' : 'text-text-primary'
        }`}
      >
        {label}
      </AppText>
    </AppPressable>
  )
}

function FriendRowSkeleton() {
  return (
    <View className="flex-row items-center px-5 py-3.5">
      <View className="h-[52px] w-[52px] rounded-[18px] bg-surface-muted" />
      <View className="ml-3 flex-1 gap-2.5">
        <View className="h-3.5 w-2/5 rounded-full bg-surface-muted" />
        <View className="h-3 w-1/3 rounded-full bg-surface-muted" />
      </View>
      <View className="h-9 w-[72px] rounded-full bg-surface-muted" />
    </View>
  )
}

function FriendsListSkeleton() {
  return (
    <View pointerEvents="none">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <FriendRowSkeleton key={row} />
      ))}
    </View>
  )
}

function EmptyState({ section, onFindPeople }: { section: Section; onFindPeople: () => void }) {
  const iconName: React.ComponentProps<typeof MaterialIcons>['name'] =
    section === 'friends'
      ? 'people-outline'
      : section === 'received'
        ? 'person-add-alt-1'
        : 'schedule'
  const content =
    section === 'friends'
      ? ['No friends yet', 'Find people you know and start connecting.']
      : section === 'received'
        ? ['No new requests', 'Friend requests sent to you will appear here.']
        : ['No sent requests', 'Requests you send will stay here until answered.']

  return (
    <View className="items-center px-8 pb-6 pt-16">
      <View className="h-12 w-12 items-center justify-center rounded-[18px] border border-brand-soft bg-surface-accent">
        <MaterialIcons name={iconName} size={22} color="#D85A21" />
      </View>
      <AppText className="mt-4 text-center font-heading text-lg text-text-primary">
        {content[0]}
      </AppText>
      <AppText className="mt-1.5 text-center text-base2 leading-5 text-text-secondary">
        {content[1]}
      </AppText>
      {section === 'friends' ? (
        <AppPressable
          className="mt-5 h-11 items-center justify-center overflow-hidden rounded-full bg-brand px-6"
          onPress={onFindPeople}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel="Find people"
        >
          <AppText className="text-base2 font-semibold text-white">Find people</AppText>
        </AppPressable>
      ) : null}
    </View>
  )
}

export function FriendActionsSheet({
  friend: selectedFriend,
  isBlocking,
  isRemoving,
  onBlock,
  onClose,
  onRemove,
  onViewProfile,
  sheetRef: externalSheetRef,
}: {
  friend: FriendSummary | null
  isBlocking: boolean
  isRemoving: boolean
  onBlock: (friend: FriendSummary, onSuccess: () => void) => void
  onClose: () => void
  onRemove: (friend: FriendSummary, onSuccess: () => void) => void
  onViewProfile: (friend: FriendSummary) => void
  sheetRef?: React.RefObject<BottomSheetModal | null>
}) {
  const insets = useSafeAreaInsets()
  const internalRef = useRef<BottomSheetModal | null>(null)
  const resolvedRef = externalSheetRef ?? internalRef
  const [displayedFriend, setDisplayedFriend] = useState<FriendSummary | null>(selectedFriend)
  const [confirmation, setConfirmation] = useState<'block' | 'remove' | null>(null)
  const [isClosing, setIsClosing] = useState(false)
  const pendingActionRef = useRef<(() => void) | null>(null)

  const isActionPending = isBlocking || isRemoving
  const actionsDisabled = isActionPending || isClosing

  useEffect(() => {
    if (selectedFriend) {
      setDisplayedFriend(selectedFriend)
      setIsClosing(false)
      if (!externalSheetRef) {
        resolvedRef.current?.present()
      }
    }
  }, [externalSheetRef, resolvedRef, selectedFriend])

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        accessibilityLabel="Close friend options"
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.44}
        pressBehavior={actionsDisabled ? 'none' : 'close'}
      />
    ),
    [actionsDisabled],
  )

  const handleDismiss = useCallback(() => {
    setIsClosing(false)
    setConfirmation(null)
    setDisplayedFriend(null)
    const nextAction = pendingActionRef.current
    pendingActionRef.current = null
    onClose()
    nextAction?.()
  }, [onClose])

  const close = useCallback(
    (afterClose?: () => void, options: { force?: boolean } = {}) => {
      if (actionsDisabled && !options.force) return

      setIsClosing(true)
      pendingActionRef.current = afterClose ?? null
      resolvedRef.current?.dismiss()
    },
    [actionsDisabled, resolvedRef],
  )

  const friend = selectedFriend ?? displayedFriend
  const user = friend?.user
  const confirmationTitle =
    confirmation === 'remove'
      ? 'Remove friend?'
      : confirmation === 'block'
        ? 'Block account?'
        : (user?.fullName ?? '')

  const isConfirmationPending =
    (confirmation === 'remove' && isRemoving) || (confirmation === 'block' && isBlocking)

  const confirmDestructiveAction = () => {
    if (!confirmation || actionsDisabled) return
    if (!friend) return

    const closeAfterSuccess = () => close(undefined, { force: true })
    if (confirmation === 'remove') {
      onRemove(friend, closeAfterSuccess)
      return
    }

    onBlock(friend, closeAfterSuccess)
  }

  return (
    <BottomSheetModal
      ref={resolvedRef}
      enableDynamicSizing
      enablePanDownToClose={!actionsDisabled}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      onDismiss={handleDismiss}
    >
      <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 18) }}>
        {friend && user ? (
          <View className="px-5 pb-1">
            <View className="mt-1 flex-row items-start justify-between">
              <View className="min-w-0 flex-1 flex-row items-center pr-4">
                <ChatAvatar name={user.fullName} picture={user.picture} size={52} />
                <View className="ml-3 min-w-0 flex-1">
                  <AppText className="font-heading text-xl text-text-primary" numberOfLines={1}>
                    {confirmationTitle}
                  </AppText>
                  <AppText className="mt-1 text-base2 text-text-secondary" numberOfLines={1}>
                    @{user.username}
                  </AppText>
                </View>
              </View>

              <AppPressable
                accessibilityLabel="Close friend options"
                accessibilityRole="button"
                className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
                disabled={actionsDisabled}
                onPress={() => close()}
              >
                <MaterialIcons name="close" size={20} color="#161616" />
              </AppPressable>
            </View>

            {confirmation ? (
              <>
                <AppText className="mt-5 text-base2 leading-6 text-text-secondary">
                  {confirmation === 'remove'
                    ? `${user.fullName} will be removed from your friends list. You can add @${user.username} again later.`
                    : `${user.fullName} will be blocked. You will no longer see content from this account.`}
                </AppText>
                <View className="mt-6 flex-row gap-3">
                  <AppPressable
                    accessibilityLabel={
                      confirmation === 'remove'
                        ? 'Cancel removing friend'
                        : `Cancel blocking ${user.fullName}`
                    }
                    accessibilityRole="button"
                    className="h-12 flex-1 items-center justify-center rounded-full border border-border-light bg-surface-muted"
                    disabled={actionsDisabled}
                    onPress={() => setConfirmation(null)}
                  >
                    <AppText className="font-semibold text-text-primary">Cancel</AppText>
                  </AppPressable>
                  <AppPressable
                    accessibilityLabel={
                      confirmation === 'remove'
                        ? `Remove ${user.fullName} from friends`
                        : `Block ${user.fullName}`
                    }
                    accessibilityRole="button"
                    className="h-12 flex-1 items-center justify-center rounded-full bg-[#FF3B30]"
                    disabled={actionsDisabled}
                    onPress={confirmDestructiveAction}
                    style={{ opacity: actionsDisabled ? 0.7 : 1 }}
                  >
                    {isConfirmationPending ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <AppText className="font-semibold text-white">
                        {confirmation === 'remove' ? 'Remove' : 'Block'}
                      </AppText>
                    )}
                  </AppPressable>
                </View>
              </>
            ) : (
              <View className="mt-5 gap-3">
                <AppPressable
                  accessibilityHint="Opens this friend's public profile"
                  accessibilityLabel={`View ${user.fullName}'s profile`}
                  accessibilityRole="button"
                  className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
                  disabled={actionsDisabled}
                  onPress={() => close(() => onViewProfile(friend))}
                >
                  <View className="h-12 w-12 items-center justify-center rounded-full bg-bg-primary">
                    <MaterialIcons name="person-outline" size={21} color="#161616" />
                  </View>
                  <View className="ml-3 flex-1">
                    <AppText className="font-semibold text-md text-text-primary">
                      View profile
                    </AppText>
                    <AppText className="mt-1 text-sm2 text-text-secondary">
                      See posts and profile details
                    </AppText>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#8A8379" />
                </AppPressable>

                <AppPressable
                  accessibilityHint="Opens a confirmation before removing this friend"
                  accessibilityLabel={`Remove ${user.fullName} from friends`}
                  accessibilityRole="button"
                  className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
                  disabled={actionsDisabled}
                  onPress={() => setConfirmation('remove')}
                >
                  <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-error">
                    <MaterialIcons name="person-remove" size={21} color="#E5483B" />
                  </View>
                  <View className="ml-3 flex-1">
                    <AppText className="font-semibold text-md text-status-error">
                      Remove friend
                    </AppText>
                    <AppText className="mt-1 text-sm2 text-text-secondary">
                      Stop showing this account as a friend
                    </AppText>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#8A8379" />
                </AppPressable>

                <AppPressable
                  accessibilityHint="Opens a confirmation before blocking this account"
                  accessibilityLabel={`Block ${user.fullName}`}
                  accessibilityRole="button"
                  className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
                  disabled={actionsDisabled}
                  onPress={() => setConfirmation('block')}
                >
                  <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-error">
                    <MaterialIcons name="block" size={21} color="#E5483B" />
                  </View>
                  <View className="ml-3 flex-1">
                    <AppText className="font-semibold text-md text-status-error">
                      Block account
                    </AppText>
                    <AppText className="mt-1 text-sm2 text-text-secondary">
                      Stop this account from interacting with you
                    </AppText>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#8A8379" />
                </AppPressable>
              </View>
            )}
          </View>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  )
}

export default function FriendsScreen() {
  const router = useRouter()
  const { section: sectionParam } = useLocalSearchParams<{ section?: Section }>()
  const insets = useSafeAreaInsets()
  const [section, setSection] = useState<Section>('friends')
  const [selectedFriend, setSelectedFriend] = useState<FriendSummary | null>(null)
  const friendActionsSheetRef = useRef<BottomSheetModal>(null)
  const friendActionStartedRef = useRef(false)

  useEffect(() => {
    if (sectionParam === 'received' || sectionParam === 'sent' || sectionParam === 'friends') {
      setSection(sectionParam)
    }
  }, [sectionParam])

  const friendsQuery = useFriends()
  const incomingQuery = useIncomingFriendRequests()
  const outgoingQuery = useOutgoingFriendRequests({ enabled: section === 'sent' })
  const { refetch: refetchFriends } = friendsQuery
  const { refetch: refetchIncoming } = incomingQuery
  const { refetch: refetchOutgoing } = outgoingQuery
  const staleQueriesRef = useRef({ friends: false, incoming: false, outgoing: false })

  staleQueriesRef.current = {
    friends: friendsQuery.data !== undefined && friendsQuery.isStale,
    incoming: incomingQuery.data !== undefined && incomingQuery.isStale,
    outgoing: outgoingQuery.data !== undefined && outgoingQuery.isStale,
  }

  useFocusEffect(
    useCallback(() => {
      const requests: Promise<unknown>[] = []

      if (staleQueriesRef.current.friends) requests.push(refetchFriends())
      if (staleQueriesRef.current.incoming) requests.push(refetchIncoming())
      if (section === 'sent' && staleQueriesRef.current.outgoing) requests.push(refetchOutgoing())

      if (requests.length > 0) {
        void Promise.all(requests)
      }
    }, [refetchFriends, refetchIncoming, refetchOutgoing, section]),
  )

  const accept = useAcceptFriendRequest()
  const reject = useRejectFriendRequest()
  const cancel = useCancelFriendRequest()
  const remove = useRemoveFriend()
  const block = useBlockUser()
  const friendActionPending = remove.isPending || block.isPending
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
    section === 'received'
      ? incomingQuery.isFetchingNextPage
      : section === 'sent'
        ? outgoingQuery.isFetchingNextPage
        : false
  const hasNextPage =
    section === 'received'
      ? incomingQuery.hasNextPage
      : section === 'sent'
        ? outgoingQuery.hasNextPage
        : false
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
    if (section === 'sent') {
      void outgoingQuery.fetchNextPage()
    }
  }, [hasNextPage, incomingQuery, isFetchingNext, outgoingQuery, section])
  const openProfile = useCallback((username: string) => router.push(`/users/${username}`), [router])
  const openContactsSearch = useCallback(
    () => router.push({ pathname: '/(tabs)/search', params: { tab: 'contacts' } }),
    [router],
  )
  const closeFriendActions = useCallback(() => {
    setSelectedFriend(null)
  }, [])
  const removeSelectedFriend = useCallback(
    (friend: FriendSummary, onSuccess: () => void) => {
      if (friendActionStartedRef.current || remove.isPending || block.isPending) return

      friendActionStartedRef.current = true
      remove.mutate(friend.user.id, {
        onSuccess,
        onSettled: () => {
          friendActionStartedRef.current = false
        },
      })
    },
    [block.isPending, remove],
  )
  const blockSelectedFriend = useCallback(
    (friend: FriendSummary, onSuccess: () => void) => {
      if (friendActionStartedRef.current || remove.isPending || block.isPending) return

      friendActionStartedRef.current = true
      block.mutate(friend.user.id, {
        onSuccess,
        onSettled: () => {
          friendActionStartedRef.current = false
        },
      })
    },
    [block, remove.isPending],
  )
  const openFriendActions = useCallback(
    (friend: FriendSummary) => {
      if (friendActionStartedRef.current || friendActionPending) return
      setSelectedFriend(friend)
      requestAnimationFrame(() => friendActionsSheetRef.current?.present())
    },
    [friendActionPending],
  )
  const viewSelectedFriendProfile = useCallback(
    (friend: FriendSummary) => {
      openProfile(friend.user.username)
    },
    [openProfile],
  )
  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      const user = item.value.user
      const requestPending = item.kind === 'request' && isPendingRequest(item.value.id)
      const removing = item.kind === 'friend' && remove.isPending && remove.variables === user.id

      return (
        <View className="px-5 py-3.5">
          <View className="flex-row items-center">
            <AppPressable
              className="min-w-0 flex-1 flex-row items-center"
              onPress={() => openProfile(user.username)}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={`Open ${user.fullName}'s profile`}
            >
              <ChatAvatar name={user.fullName} picture={user.picture} size={52} />
              <View className="ml-3 min-w-0 flex-1 pr-3">
                <AppText className="font-medium text-md text-text-primary" numberOfLines={1}>
                  {user.fullName}
                </AppText>
                <AppText className="mt-0.5 text-sm2 text-text-secondary" numberOfLines={1}>
                  @{user.username}
                </AppText>
                {item.kind === 'request' ? (
                  <AppText className="mt-1 text-xs2 text-text-muted">
                    {getRelativeDate(item.value.requestedAt)}
                  </AppText>
                ) : null}
              </View>
            </AppPressable>

            {item.kind === 'friend' ? (
              <SafeTouchableOpacity
                className="h-11 w-11 items-center justify-center overflow-hidden rounded-[16px] bg-surface-muted"
                onPress={() => openFriendActions(item.value)}
                activeOpacity={0.75}
                disabled={removing}
                accessibilityRole="button"
                accessibilityLabel={`Actions for ${user.fullName}`}
              >
                {removing ? (
                  <ActivityIndicator color="#8A8379" size="small" />
                ) : (
                  <MaterialIcons name="more-horiz" size={20} color="#6F6861" />
                )}
              </SafeTouchableOpacity>
            ) : section === 'received' ? (
              <View className="flex-row gap-2">
                <Action
                  disabled={requestPending}
                  label={requestPending ? '...' : 'Accept'}
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
              <View className="items-end gap-1.5">
                <AppText className="text-xs2 font-medium text-text-muted">Pending</AppText>
                <Action
                  disabled={requestPending}
                  label={requestPending ? '...' : 'Cancel'}
                  onPress={() => cancel.mutate({ requestId: item.value.id, userId: user.id })}
                  tone="secondary"
                />
              </View>
            )}
          </View>
        </View>
      )
    },
    [accept, cancel, isPendingRequest, openFriendActions, openProfile, reject, remove, section],
  )

  const sectionTitle =
    section === 'friends' ? 'Your friends' : section === 'received' ? 'Requests' : 'Sent requests'
  const sectionCountLabel =
    section === 'friends'
      ? `${items.length} ${items.length === 1 ? 'friend' : 'friends'}`
      : `${items.length} ${items.length === 1 ? 'request' : 'requests'}`

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <View className="flex-row items-end justify-between px-5 pb-3 pt-2">
        <View>
          <AppText className="text-xs2 font-semibold uppercase tracking-[1.8px] text-brand-dark">
            Velora
          </AppText>
          <AppText className="font-display text-[28px] leading-[34px] tracking-[-0.7px] text-text-primary">
            Friends
          </AppText>
        </View>
        <View className="relative">
          <SafeTouchableOpacity
            className="h-12 w-12 items-center justify-center overflow-hidden rounded-[18px] border border-brand-soft bg-surface-accent"
            onPress={openContactsSearch}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Find people in contacts"
          >
            <MaterialIcons name="person-add-alt-1" size={21} color="#D85A21" />
          </SafeTouchableOpacity>
        </View>
      </View>

      <View className="mx-5 mt-1 flex-row rounded-full bg-surface-muted p-1">
        {(
          [
            ['friends', 'Friends'],
            ['received', 'Requests'],
            ['sent', 'Sent'],
          ] as const
        ).map(([value, label]) => {
          const isActive = section === value
          const count =
            value === 'friends' ? friends.length : value === 'received' ? incoming.length : null

          return (
            <Pressable
              key={value}
              className="h-11 flex-1 flex-row items-center justify-center rounded-full px-2"
              onPress={() => setSection(value)}
              collapsable={false}
              style={({ pressed }) => ({
                backgroundColor: isActive ? '#FFFFFF' : 'transparent',
                borderColor: '#F4F4F4',
                borderWidth: isActive ? 1 : 0,
                opacity: pressed ? 0.76 : 1,
              })}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${label} section`}
            >
              <AppText
                className="text-sm2 font-semibold"
                style={{ color: isActive ? '#161616' : '#777777' }}
              >
                {label}
              </AppText>
              {count !== null && count > 0 ? (
                <AppText className="ml-1.5 text-xs2" style={{ color: '#A6A6A6' }}>
                  {count}
                </AppText>
              ) : null}
            </Pressable>
          )
        })}
      </View>

      <View className="flex-row items-center justify-between px-5 pb-1.5 pt-5">
        <AppText className="font-heading text-lg text-text-primary">{sectionTitle}</AppText>
        <AppText className="text-sm2 text-text-muted">{sectionCountLabel}</AppText>
      </View>

      {isLoading ? (
        <FriendsListSkeleton />
      ) : activeQuery.isError && items.length === 0 ? (
        <View className="mx-5 mt-4 items-center rounded-[24px] border border-brand-soft bg-surface-accent px-6 py-9">
          <View className="h-12 w-12 items-center justify-center rounded-[18px] border border-brand-soft bg-bg-primary">
            <MaterialIcons name="cloud-off" size={22} color="#D85A21" />
          </View>
          <AppText className="mt-4 text-center font-heading text-lg text-text-primary">
            Could not load friends
          </AppText>
          <AppText className="mt-1.5 text-center text-base2 leading-5 text-text-secondary">
            Check your connection and try again.
          </AppText>
          <AppPressable
            className="mt-5 h-11 items-center justify-center overflow-hidden rounded-full bg-brand px-6"
            onPress={refresh}
            accessibilityRole="button"
            accessibilityLabel="Retry loading friends"
          >
            <AppText className="text-base2 font-semibold text-white">Try again</AppText>
          </AppPressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.value.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom: getDockedTabBarHeight(insets.bottom) + 20,
          }}
          refreshControl={
            <RefreshControl
              refreshing={activeQuery.isRefetching && !isFetchingNext}
              onRefresh={refresh}
              colors={['#D85A21']}
              tintColor="#D85A21"
            />
          }
          ListEmptyComponent={<EmptyState section={section} onFindPeople={openContactsSearch} />}
          ListFooterComponent={
            isFetchingNext ? (
              <View className="py-5">
                <ActivityIndicator color="#D85A21" size="small" />
              </View>
            ) : null
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
        />
      )}

      <FriendActionsSheet
        friend={selectedFriend}
        isBlocking={block.isPending}
        isRemoving={
          Boolean(selectedFriend) &&
          remove.isPending &&
          remove.variables === selectedFriend?.user.id
        }
        onBlock={blockSelectedFriend}
        onClose={closeFriendActions}
        onRemove={removeSelectedFriend}
        onViewProfile={viewSelectedFriendProfile}
        sheetRef={friendActionsSheetRef}
      />
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
