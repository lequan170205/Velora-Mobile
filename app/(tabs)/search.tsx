import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'

import { friendApi } from '../../src/api/friend.api'
import { AppSearchBar } from '../../src/components/common/AppSearchBar'
import { ReelThumbnailGrid } from '../../src/components/reels/ReelThumbnailGrid'
import { queryKeys } from '../../src/constants/queryKeys'
import { colors } from '../../src/constants/theme'
import { useBotChat } from '../../src/hooks/useBotChat'
import { useConversationNavigation } from '../../src/hooks/useConversationNavigation'
import { getConversationsQueryOptions } from '../../src/hooks/useConversations'
import { useIncomingFriendRequests, useOutgoingFriendRequests } from '../../src/hooks/useFriends'
import { useGlobalSearch } from '../../src/hooks/useGlobalSearch'
import { cn } from '../../src/lib/cn'
import { getInitials } from '../../src/lib/profile'
import { useNetworkStatus } from '../../src/providers/NetworkProvider'

import type { FriendRequestSummary } from '../../src/types/friend.types'
import type { ReelFeedListItem } from '../../src/types/reel.types'
import type { GlobalSearchType, PublicUserProfile } from '../../src/types/search.types'
import type { TextInput } from 'react-native'

const CARD_ENTERING = FadeInDown.springify().damping(16).stiffness(160)
const ROW_LAYOUT = LinearTransition.springify().damping(18).stiffness(170)
const SEARCH_DEBOUNCE_MS = 400
const ALL_CONTACTS_PREVIEW_LIMIT = 5
const ALL_REELS_PREVIEW_LIMIT = 6
const SUGGESTION_CHIPS = ['AI', 'food', 'gym', 'travel'] as const
const SEARCH_LIMITS: Record<GlobalSearchType, number> = {
  all: 18,
  users: 20,
  reels: 24,
}

type SearchTabKey = 'all' | 'reels' | 'contacts'

const getHandleLabel = (username?: string | null) => {
  const normalizedUsername = username?.trim().replace(/^@+/, '')
  return normalizedUsername ? `@${normalizedUsername}` : ''
}

const getNormalizedUsername = (username?: string | null) =>
  username?.trim().replace(/^@+/, '') || null

const getBackendType = (selectedTab: SearchTabKey): GlobalSearchType => {
  if (selectedTab === 'all') {
    return 'all'
  }

  if (selectedTab === 'reels') {
    return 'reels'
  }

  return 'users'
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

function SearchTabButton({
  active,
  label,
  loading = false,
  onPress,
}: {
  active: boolean
  label: string
  loading?: boolean
  onPress: () => void
}) {
  return (
    <Pressable className="flex-1 items-center justify-center px-1 py-2" onPress={onPress}>
      {loading ? (
        <ActivityIndicator color={colors.brand.tertiary} size="small" />
      ) : (
        <Text
          className={cn(
            'font-medium text-sm2',
            active ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          {label}
        </Text>
      )}

      <View className={cn('mt-2 h-0.5 w-8 rounded-full', active ? 'bg-brand' : 'bg-transparent')} />
    </Pressable>
  )
}

function SearchSectionHeader({
  onSeeAll,
  title,
}: {
  onSeeAll?: (() => void) | undefined
  title: string
}) {
  return (
    <View className="flex-row items-center justify-between px-4 pb-2 pt-5">
      <Text className="font-medium text-sm2 uppercase tracking-[0.8px] text-text-muted">
        {title}
      </Text>

      {onSeeAll ? (
        <Pressable onPress={onSeeAll}>
          <Text className="font-medium text-sm2 text-brand">See all</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function SearchMessageState({
  actionLabel,
  description,
  onPress,
  title,
}: {
  actionLabel?: string
  description?: string
  onPress?: (() => void) | undefined
  title: string
}) {
  return (
    <View className="items-center px-8 pt-16">
      <Text className="text-center font-medium text-md text-text-primary">{title}</Text>

      {description ? (
        <Text className="mt-2 text-center text-sm2 text-text-secondary">{description}</Text>
      ) : null}

      {actionLabel && onPress ? (
        <Pressable className="mt-5 rounded-full bg-brand px-4 py-2.5" onPress={onPress}>
          <Text className="font-medium text-sm2 text-white">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function SuggestionChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      className="mb-2 mr-2 rounded-full border border-border-light bg-surface-muted px-4 py-2"
      onPress={onPress}
    >
      <Text className="font-medium text-sm2 text-text-primary">{label}</Text>
    </Pressable>
  )
}

function EmptyQueryState({ onSuggestionPress }: { onSuggestionPress: (value: string) => void }) {
  return (
    <View className="px-4 pt-5">
      <Text className="font-medium text-md text-text-primary">Search reels, contacts, topics</Text>

      <View className="mt-4 flex-row flex-wrap">
        {SUGGESTION_CHIPS.map((chip) => (
          <SuggestionChip key={chip} label={chip} onPress={() => onSuggestionPress(chip)} />
        ))}
      </View>
    </View>
  )
}

function ContactResultRow({
  onPress,
  user,
}: {
  onPress?: (() => void) | undefined
  user: PublicUserProfile
}) {
  return (
    <Pressable className="px-4 py-3" disabled={!onPress} onPress={onPress}>
      <View className="flex-row items-center">
        <View
          className="h-12 w-12 items-center justify-center rounded-full bg-surface-muted"
          style={{ overflow: 'hidden' }}
        >
          {user.picture ? (
            <Image
              source={{ uri: user.picture }}
              style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#F1E9E1' }}
            />
          ) : (
            <Text className="font-heading text-sm2 text-text-primary">
              {getInitials(user.fullName)}
            </Text>
          )}
        </View>

        <View className="ml-3 flex-1">
          <Text className="font-medium text-md text-text-primary" numberOfLines={1}>
            {user.fullName}
          </Text>

          {user.username ? (
            <Text className="mt-0.5 text-sm2 text-text-secondary" numberOfLines={1}>
              {getHandleLabel(user.username)}
            </Text>
          ) : null}
        </View>

        {onPress ? <MaterialIcons color="#9B958C" name="chevron-right" size={18} /> : null}
      </View>
    </Pressable>
  )
}

function ContactResultsList({
  onUserPress,
  users,
}: {
  onUserPress: (user: PublicUserProfile) => void
  users: PublicUserProfile[]
}) {
  return (
    <View>
      {users.map((user, index) => {
        const normalizedUsername = getNormalizedUsername(user.username)

        return (
          <View key={user.id}>
            <ContactResultRow
              user={user}
              onPress={normalizedUsername ? () => onUserPress(user) : undefined}
            />
            {index < users.length - 1 ? <View className="mx-4 h-px bg-border-light" /> : null}
          </View>
        )
      })}
    </View>
  )
}

function SearchResultsPanel({
  backendType,
  debouncedQuery,
  onReelPress,
  onSuggestionPress,
  onSwitchTab,
  onUserPress,
  query,
  selectedTab,
  tileSize,
}: {
  backendType: GlobalSearchType
  debouncedQuery: string
  onReelPress: (reel: ReelFeedListItem) => void
  onSuggestionPress: (value: string) => void
  onSwitchTab: (tab: SearchTabKey) => void
  onUserPress: (user: PublicUserProfile) => void
  query: string
  selectedTab: SearchTabKey
  tileSize: number
}) {
  const normalizedQuery = query.trim()
  const normalizedDebouncedQuery = debouncedQuery.trim()
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const { data, isError, isFetching, isLoading, refetch } = useGlobalSearch({
    q: normalizedDebouncedQuery,
    type: backendType,
    limit: SEARCH_LIMITS[backendType],
  })

  if (!normalizedQuery.length) {
    return <EmptyQueryState onSuggestionPress={onSuggestionPress} />
  }

  if (isNetworkResolved && !isOnline) {
    return (
      <SearchMessageState title="No internet connection. Connect to the internet and try again." />
    )
  }

  if (normalizedQuery !== normalizedDebouncedQuery || (isLoading && !data)) {
    return (
      <View className="items-center px-4 pt-12">
        <ActivityIndicator color={colors.brand.tertiary} size="small" />
      </View>
    )
  }

  if (isError && !data) {
    return (
      <SearchMessageState
        title="Something went wrong"
        actionLabel="Retry"
        onPress={() => {
          void refetch()
        }}
      />
    )
  }

  const contacts = data?.users ?? []
  const reels = data?.reels ?? []
  const previewContacts = contacts.slice(0, ALL_CONTACTS_PREVIEW_LIMIT)
  const previewReels = reels.slice(0, ALL_REELS_PREVIEW_LIMIT)
  const hasResults =
    selectedTab === 'all'
      ? contacts.length > 0 || reels.length > 0
      : selectedTab === 'contacts'
        ? contacts.length > 0
        : reels.length > 0

  if (!hasResults) {
    return <SearchMessageState title="No results found" description="Try another keyword" />
  }

  if (selectedTab === 'contacts') {
    return <ContactResultsList onUserPress={onUserPress} users={contacts} />
  }

  if (selectedTab === 'reels') {
    return <ReelThumbnailGrid onReelPress={onReelPress} reels={reels} tileSize={tileSize} />
  }

  return (
    <View>
      {previewContacts.length > 0 ? (
        <>
          <SearchSectionHeader title="Contacts" onSeeAll={() => onSwitchTab('contacts')} />
          <ContactResultsList onUserPress={onUserPress} users={previewContacts} />
        </>
      ) : null}

      {previewReels.length > 0 ? (
        <>
          <SearchSectionHeader title="Reels" onSeeAll={() => onSwitchTab('reels')} />
          <ReelThumbnailGrid onReelPress={onReelPress} reels={previewReels} tileSize={tileSize} />
        </>
      ) : null}

      {isFetching ? (
        <View className="items-center px-4 pb-2 pt-4">
          <ActivityIndicator color={colors.brand.tertiary} size="small" />
        </View>
      ) : null}
    </View>
  )
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

function RequestSectionHeader({ count, title }: { count: number; title: string }) {
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

export default function SearchScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const inputRef = useRef<TextInput | null>(null)
  const { width: windowWidth } = useWindowDimensions()
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedTab, setSelectedTab] = useState<SearchTabKey>('all')
  const { mutateAsync: startBotChat, isPending: isBotLoading } = useBotChat()
  const { runConversationEntry } = useConversationNavigation()

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

  const normalizedQuery = query.trim()
  const backendType = getBackendType(selectedTab)
  const tileSize = useMemo(() => Math.floor((windowWidth - 4) / 3), [windowWidth])
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
  const isSearchTyping = normalizedQuery.length > 0 && normalizedQuery !== debouncedQuery.trim()
  const shouldShowRequestSections =
    normalizedQuery.length === 0 && (selectedTab === 'all' || selectedTab === 'contacts')

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedQuery(normalizedQuery)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeoutId)
  }, [normalizedQuery])

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
            console.warn('[Search] Failed to refresh conversations cache', error)
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

  const handleSuggestionPress = useCallback((value: string) => {
    setSelectedTab('all')
    setQuery(value)
    inputRef.current?.focus()
  }, [])

  const handleSwitchSearchTab = useCallback((tab: SearchTabKey) => {
    setSelectedTab(tab)
  }, [])

  const handleUserPress = useCallback(
    (user: PublicUserProfile) => {
      const username = getNormalizedUsername(user.username)
      if (!username) {
        return
      }

      router.push(`/users/${username}`)
    },
    [router],
  )

  const handleReelPress = useCallback(
    (reel: ReelFeedListItem) => {
      router.push({
        pathname: '/reels/[id]',
        params: { id: reel.id },
      })
    },
    [router],
  )

  const handleBotChat = useCallback(() => {
    void runConversationEntry('bot-conversation', async () => {
      try {
        await startBotChat()
      } catch (error) {
        Alert.alert(
          'Error',
          getErrorMessage(error, 'Could not open bot conversation. Please try again.'),
        )
      }
    })
  }, [runConversationEntry, startBotChat])

  const renderRequestSections = () => {
    if (isRequestsLoading) {
      return (
        <View className="items-center px-5 pt-10">
          <ActivityIndicator color="#D85A21" size="small" />
        </View>
      )
    }

    if (incomingRequests.length === 0 && outgoingRequests.length === 0) {
      return null
    }

    return (
      <>
        {incomingRequests.length > 0 ? (
          <>
            <RequestSectionHeader count={incomingRequests.length} title="Incoming" />
            {incomingRequests.map((request) => (
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
            ))}
            {hasNextIncomingPage ? (
              <LoadMoreButton
                isPending={isFetchingNextIncomingPage}
                onPress={() => {
                  void fetchNextIncomingPage()
                }}
              />
            ) : null}
          </>
        ) : null}

        {outgoingRequests.length > 0 ? (
          <>
            <RequestSectionHeader count={outgoingRequests.length} title="Outgoing" />
            {outgoingRequests.map((request) => (
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
            ))}
            {hasNextOutgoingPage ? (
              <LoadMoreButton
                isPending={isFetchingNextOutgoingPage}
                onPress={() => {
                  void fetchNextOutgoingPage()
                }}
              />
            ) : null}
          </>
        ) : null}
      </>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <View className="px-4 pb-1 pt-2">
          <AppSearchBar
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Search reels, contacts, topics"
            placeholderTextColor="#9B958C"
            iconColor="#8A8379"
            iconPlacement="left"
            isLoading={isSearchTyping}
            loadingColor={colors.brand.tertiary}
            onClear={() => setQuery('')}
            size="compact"
          />

          <View className="mt-2 flex-row border-b border-border-light">
            <SearchTabButton
              active={selectedTab === 'all'}
              label="All"
              onPress={() => setSelectedTab('all')}
            />
            <SearchTabButton
              active={selectedTab === 'reels'}
              label="Reels"
              onPress={() => setSelectedTab('reels')}
            />
            <SearchTabButton
              active={selectedTab === 'contacts'}
              label="Contacts"
              onPress={() => setSelectedTab('contacts')}
            />
            <SearchTabButton
              active={false}
              label="Velora AI"
              loading={isBotLoading}
              onPress={handleBotChat}
            />
          </View>
        </View>

        {shouldShowRequestSections ? renderRequestSections() : null}

        <SearchResultsPanel
          backendType={backendType}
          debouncedQuery={debouncedQuery}
          onReelPress={handleReelPress}
          onSuggestionPress={handleSuggestionPress}
          onSwitchTab={handleSwitchSearchTab}
          onUserPress={handleUserPress}
          query={query}
          selectedTab={selectedTab}
          tileSize={tileSize}
        />
      </ScrollView>
    </SafeAreaView>
  )
}
