import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppPressable, AppText } from '../../src/components/base'
import { ChatAvatar } from '../../src/components/chat/ChatAvatar'
import { AppSearchBar } from '../../src/components/common/AppSearchBar'
import { SafeTouchableOpacity } from '../../src/components/common/SafeTouchableOpacity'
import { getDockedTabBarHeight } from '../../src/components/navigation/CustomTabBar'
import {
  ReelThumbnailGrid,
  ReelThumbnailGridSkeleton,
} from '../../src/components/reels/ReelThumbnailGrid'
import { colors } from '../../src/constants/theme'
import { useBotChat } from '../../src/hooks/useBotChat'
import { useConversationNavigation } from '../../src/hooks/useConversationNavigation'
import { useFriendshipStatus } from '../../src/hooks/useFriends'
import { useGlobalSearch } from '../../src/hooks/useGlobalSearch'
import { useRecommendedUsers } from '../../src/hooks/useRecommendedUsers'
import { useRecommendedReelsFeed } from '../../src/hooks/useReels'
import { useSearchSuggestions } from '../../src/hooks/useSearchSuggestions'
import { flattenRecommendedReelPages } from '../../src/lib/recommendationFeed'
import { useNetworkStatus } from '../../src/providers/NetworkProvider'

import type { FriendshipState } from '../../src/types/friend.types'
import type { ReelFeedListItem } from '../../src/types/reel.types'
import type { GlobalSearchType, PublicUserProfile } from '../../src/types/search.types'
import type { RecommendedPublicUserProfile } from '../../src/types/user.types'
import type { TextInput } from 'react-native'

const SEARCH_DEBOUNCE_MS = 400
const ALL_CONTACTS_PREVIEW_LIMIT = 5
const ALL_REELS_PREVIEW_LIMIT = 6
const SEARCH_LIMITS: Record<GlobalSearchType, number> = {
  all: 18,
  users: 20,
  reels: 24,
}

type SearchTabKey = 'all' | 'reels' | 'contacts'

const getSearchTabParam = (value?: string | string[]): SearchTabKey | null => {
  const normalizedValue = Array.isArray(value) ? value[0] : value

  return normalizedValue === 'all' || normalizedValue === 'reels' || normalizedValue === 'contacts'
    ? normalizedValue
    : null
}

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

function SearchHeader({
  isBotLoading,
  onBotChat,
}: {
  isBotLoading: boolean
  onBotChat: () => void
}) {
  return (
    <View className="flex-row items-end justify-between px-5 pb-3 pt-2">
      <View>
        <AppText className="text-xs2 font-semibold uppercase tracking-[1.8px] text-brand-dark">
          Velora
        </AppText>
        <AppText className="font-display text-[28px] leading-[34px] tracking-[-0.7px] text-text-primary">
          Search
        </AppText>
      </View>

      <SafeTouchableOpacity
        className="h-12 w-12 items-center justify-center overflow-hidden rounded-[18px] border border-brand-soft bg-surface-accent"
        onPress={onBotChat}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Open Velora AI"
        accessibilityHint="Start a chat with Velora AI"
      >
        {isBotLoading ? (
          <ActivityIndicator color={colors.brand.tertiary} size="small" />
        ) : (
          <MaterialIcons name="auto-awesome" size={21} color="#D85A21" />
        )}
      </SafeTouchableOpacity>
    </View>
  )
}

function SearchTabButton({
  active,
  label,
  onPress,
}: {
  active: boolean
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      className="h-11 flex-1 flex-row items-center justify-center rounded-full px-2"
      onPress={onPress}
      collapsable={false}
      style={({ pressed }) => ({
        backgroundColor: active ? '#FFFFFF' : 'transparent',
        borderColor: '#F4F4F4',
        borderWidth: active ? 1 : 0,
        opacity: pressed ? 0.76 : 1,
      })}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} search results`}
    >
      <AppText className="text-sm2 font-semibold" style={{ color: active ? '#161616' : '#777777' }}>
        {label}
      </AppText>
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
    <View className="flex-row items-center justify-between px-5 pb-2 pt-6">
      <AppText className="font-heading text-lg text-text-primary" selectable>
        {title}
      </AppText>

      {onSeeAll ? (
        <AppPressable
          className="min-h-11 justify-center"
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={`See all ${title.toLowerCase()}`}
        >
          <AppText className="font-medium text-sm2 text-brand">See all</AppText>
        </AppPressable>
      ) : null}
    </View>
  )
}

function SearchMessageState({
  actionLabel,
  description,
  icon = 'search-off',
  onPress,
  title,
}: {
  actionLabel?: string
  description?: string
  icon?: React.ComponentProps<typeof MaterialIcons>['name']
  onPress?: (() => void) | undefined
  title: string
}) {
  return (
    <View className="mx-5 mt-5 items-center rounded-[24px] border border-brand-soft bg-surface-accent px-6 py-9">
      <View className="h-12 w-12 items-center justify-center rounded-[18px] border border-brand-soft bg-bg-primary">
        <MaterialIcons name={icon} size={22} color="#D85A21" />
      </View>
      <AppText className="mt-4 text-center font-heading text-lg text-text-primary" selectable>
        {title}
      </AppText>

      {description ? (
        <AppText className="mt-1.5 text-center text-base2 leading-5 text-text-secondary" selectable>
          {description}
        </AppText>
      ) : null}

      {actionLabel && onPress ? (
        <AppPressable
          className="mt-5 h-11 items-center justify-center overflow-hidden rounded-full bg-brand px-6"
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <AppText className="text-base2 font-semibold text-white">{actionLabel}</AppText>
        </AppPressable>
      ) : null}
    </View>
  )
}

function SuggestionChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <AppPressable
      className="mb-2 mr-2 min-h-11 items-center justify-center rounded-full border border-brand-soft bg-bg-primary px-4"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Search for ${label}`}
    >
      <AppText className="font-medium text-sm2 text-text-primary">{label}</AppText>
    </AppPressable>
  )
}

function SuggestionChipSkeleton({ width }: { width: number }) {
  return <View className="mb-2 mr-2 h-11 rounded-full bg-bg-primary" style={{ width }} />
}

function EmptyQueryState({
  hasResolvedSuggestions,
  isLoadingSuggestions,
  onSuggestionPress,
  showSuggestions,
  suggestions,
}: {
  hasResolvedSuggestions: boolean
  isLoadingSuggestions: boolean
  onSuggestionPress: (value: string) => void
  showSuggestions: boolean
  suggestions: { label: string; query: string }[]
}) {
  if (!showSuggestions) {
    return null
  }

  const chips = hasResolvedSuggestions ? suggestions : []

  return (
    <View className="mx-5 mt-5 rounded-[24px] border border-brand-soft bg-surface-accent px-4 py-5">
      <View className="flex-row items-start">
        <View className="h-11 w-11 items-center justify-center rounded-[16px] border border-brand-soft bg-bg-primary">
          <MaterialIcons name="explore" size={21} color="#D85A21" />
        </View>
        <View className="ml-3 min-w-0 flex-1">
          <AppText className="font-heading text-lg text-text-primary" selectable>
            Explore
          </AppText>
          <AppText className="mt-1 text-base2 leading-5 text-text-secondary" selectable>
            Search reels, contacts, or topics
          </AppText>
        </View>
      </View>

      <View className="mt-5 flex-row flex-wrap">
        {chips.map((chip) => (
          <SuggestionChip
            key={`${chip.query}:${chip.label}`}
            label={chip.label}
            onPress={() => onSuggestionPress(chip.query)}
          />
        ))}

        {isLoadingSuggestions ? (
          <>
            <SuggestionChipSkeleton width={96} />
            <SuggestionChipSkeleton width={124} />
            <SuggestionChipSkeleton width={104} />
          </>
        ) : chips.length === 0 ? (
          <AppText className="text-sm2 text-text-secondary" selectable>
            Try a name, a topic, or a reel title to get started.
          </AppText>
        ) : null}
      </View>
    </View>
  )
}

const getFriendshipStatusLabel = (status?: FriendshipState | undefined) =>
  status === 'friends'
    ? 'Friends'
    : status === 'request_sent'
      ? 'Request sent'
      : status === 'request_received'
        ? 'Respond in Friend Requests'
        : null

function ContactRow({
  mutualFriendLabel,
  onFriendRequestsPress,
  onPress,
  status,
  user,
}: {
  mutualFriendLabel?: string | null
  onFriendRequestsPress: () => void
  onPress?: (() => void) | undefined
  user: PublicUserProfile
  status?: FriendshipState | undefined
}) {
  const statusLabel = getFriendshipStatusLabel(status)

  return (
    <AppPressable
      className="flex-row items-center px-5 py-3.5"
      disabled={!onPress}
      onPress={onPress}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={onPress ? `Open ${user.fullName}'s profile` : user.fullName}
    >
      <ChatAvatar name={user.fullName} picture={user.picture} size={52} />

      <View className="ml-3 min-w-0 flex-1 pr-3">
        <AppText className="font-medium text-md text-text-primary" numberOfLines={1}>
          {user.fullName}
        </AppText>

        {user.username ? (
          <AppText className="mt-0.5 text-sm2 text-text-secondary" numberOfLines={1}>
            {getHandleLabel(user.username)}
          </AppText>
        ) : null}

        {mutualFriendLabel ? (
          <AppText className="mt-1 text-xs2 text-text-muted" numberOfLines={1}>
            {mutualFriendLabel}
          </AppText>
        ) : null}
      </View>

      <View className="items-end">
        {statusLabel ? (
          status === 'request_received' ? (
            <AppPressable
              className="min-h-11 min-w-[44px] items-end justify-center"
              accessibilityLabel="Open Friend Requests"
              accessibilityRole="button"
              accessibilityHint="Review incoming friend requests"
              onPress={onFriendRequestsPress}
            >
              <AppText className="text-right text-xs2 text-brand">{statusLabel}</AppText>
            </AppPressable>
          ) : (
            <AppText className="text-right text-xs2 text-text-muted" selectable>
              {statusLabel}
            </AppText>
          )
        ) : null}
        {onPress ? <MaterialIcons color="#9B958C" name="chevron-right" size={20} /> : null}
      </View>
    </AppPressable>
  )
}

function ContactResultRow({
  onFriendRequestsPress,
  onPress,
  user,
}: {
  onFriendRequestsPress: () => void
  onPress?: (() => void) | undefined
  user: PublicUserProfile
}) {
  const { data: friendshipStatus } = useFriendshipStatus(user.id)

  return (
    <ContactRow
      onFriendRequestsPress={onFriendRequestsPress}
      onPress={onPress}
      status={friendshipStatus?.status}
      user={user}
    />
  )
}

const getMutualFriendLabel = (user: RecommendedPublicUserProfile) => {
  const count = user.mutualFriendCount

  if (
    user.recommendation.candidateSource !== 'GRAPH_TWO_HOP' ||
    typeof count !== 'number' ||
    !Number.isFinite(count) ||
    count <= 0
  ) {
    return null
  }

  return `${count} mutual friend${count === 1 ? '' : 's'}`
}

function RecommendedContactRow({
  onFriendRequestsPress,
  onPress,
  user,
}: {
  onFriendRequestsPress: () => void
  onPress?: (() => void) | undefined
  user: RecommendedPublicUserProfile
}) {
  return (
    <ContactRow
      mutualFriendLabel={getMutualFriendLabel(user)}
      onFriendRequestsPress={onFriendRequestsPress}
      onPress={onPress}
      user={user}
    />
  )
}

type ContactResultsListProps = {
  onFriendRequestsPress: () => void
  onUserPress: (user: PublicUserProfile) => void
} & (
  | { mode: 'search'; users: PublicUserProfile[] }
  | { mode: 'recommended'; users: RecommendedPublicUserProfile[] }
)

function ContactResultsList({
  onFriendRequestsPress,
  onUserPress,
  mode,
  users,
}: ContactResultsListProps) {
  return (
    <View>
      {users.map((user, index) => {
        const normalizedUsername = getNormalizedUsername(user.username)

        return (
          <View key={user.id}>
            {mode === 'recommended' ? (
              <RecommendedContactRow
                onFriendRequestsPress={onFriendRequestsPress}
                user={user as RecommendedPublicUserProfile}
                onPress={normalizedUsername ? () => onUserPress(user) : undefined}
              />
            ) : (
              <ContactResultRow
                onFriendRequestsPress={onFriendRequestsPress}
                user={user}
                onPress={normalizedUsername ? () => onUserPress(user) : undefined}
              />
            )}
            {index < users.length - 1 ? <View className="mx-5 h-px bg-border-light" /> : null}
          </View>
        )
      })}
    </View>
  )
}

function ContactRowSkeleton() {
  return (
    <View className="flex-row items-center px-5 py-3.5" pointerEvents="none">
      <View className="h-[52px] w-[52px] rounded-[18px] bg-surface-muted" />
      <View className="ml-3 flex-1 gap-2.5 overflow-hidden">
        <View className="h-3.5 w-2/5 rounded-full bg-surface-muted" />
        <View className="h-3 w-3/5 rounded-full bg-surface-muted" />
      </View>
      <View className="h-11 w-11 rounded-[16px] bg-surface-muted" />
    </View>
  )
}

function ContactResultsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View pointerEvents="none">
      {Array.from({ length: count }).map((_, index) => (
        <View key={`contact-skeleton-${index}`}>
          <ContactRowSkeleton />
          {index < count - 1 ? <View className="mx-5 h-px bg-border-light" /> : null}
        </View>
      ))}
    </View>
  )
}

function SearchResultsSkeleton({
  selectedTab,
  tileSize,
  title,
}: {
  selectedTab: SearchTabKey
  tileSize: number
  title?: string
}) {
  if (selectedTab === 'contacts') {
    return (
      <View>
        <SearchSectionHeader title={title ?? 'Contacts'} />
        <ContactResultsSkeleton />
      </View>
    )
  }

  if (selectedTab === 'reels') {
    return (
      <View>
        <SearchSectionHeader title={title ?? 'Reels'} />
        <ReelThumbnailGridSkeleton tileSize={tileSize} />
      </View>
    )
  }

  return (
    <View>
      <SearchSectionHeader title="Contacts" />
      <ContactResultsSkeleton count={3} />
      <SearchSectionHeader title="Reels" />
      <ReelThumbnailGridSkeleton tileSize={tileSize} />
    </View>
  )
}

function SearchResultsPanel({
  backendType,
  debouncedQuery,
  hasResolvedSuggestions,
  isLoadingSuggestions,
  onReelPress,
  onFriendRequestsPress,
  onClearQuery,
  onSuggestionPress,
  onRecommendedUsersRetry,
  onSwitchTab,
  onUserPress,
  query,
  recommendedReels,
  recommendedUsers,
  selectedTab,
  showSuggestions,
  suggestions,
  tileSize,
  isRecommendedReelsLoading,
  isRecommendedUsersError,
  isRecommendedUsersLoading,
}: {
  backendType: GlobalSearchType
  debouncedQuery: string
  hasResolvedSuggestions: boolean
  isLoadingSuggestions: boolean
  isRecommendedReelsLoading: boolean
  isRecommendedUsersError: boolean
  isRecommendedUsersLoading: boolean
  onReelPress: (reel: ReelFeedListItem) => void
  onFriendRequestsPress: () => void
  onClearQuery: () => void
  onRecommendedUsersRetry: () => void
  onSuggestionPress: (value: string) => void
  onSwitchTab: (tab: SearchTabKey) => void
  onUserPress: (user: PublicUserProfile) => void
  query: string
  recommendedReels: ReelFeedListItem[]
  recommendedUsers: RecommendedPublicUserProfile[]
  selectedTab: SearchTabKey
  showSuggestions: boolean
  suggestions: { label: string; query: string }[]
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
    if (selectedTab === 'reels') {
      if (isRecommendedReelsLoading && recommendedReels.length === 0) {
        return (
          <SearchResultsSkeleton
            selectedTab="reels"
            tileSize={tileSize}
            title="Recommended reels"
          />
        )
      }

      if (recommendedReels.length === 0) {
        return (
          <SearchMessageState
            actionLabel="Explore suggestions"
            description="Explore a topic and come back for new picks."
            icon="movie-filter"
            onPress={() => onSwitchTab('all')}
            title="No recommended reels yet"
          />
        )
      }

      return (
        <View>
          <SearchSectionHeader title="Recommended reels" />
          <ReelThumbnailGrid
            onReelPress={onReelPress}
            reels={recommendedReels}
            tileSize={tileSize}
          />
        </View>
      )
    }

    if (selectedTab === 'contacts') {
      if (isRecommendedUsersLoading && recommendedUsers.length === 0) {
        return (
          <SearchResultsSkeleton
            selectedTab="contacts"
            tileSize={tileSize}
            title="Suggested contacts"
          />
        )
      }

      if (isRecommendedUsersError) {
        return (
          <SearchMessageState
            title="Couldn’t load suggestions"
            description="Check your connection and try again."
            icon="cloud-off"
            actionLabel="Retry"
            onPress={onRecommendedUsersRetry}
          />
        )
      }

      if (recommendedUsers.length === 0) {
        return (
          <SearchMessageState
            icon="people-outline"
            title="No contact suggestions yet"
            description="Try searching for someone"
          />
        )
      }

      return (
        <View>
          <SearchSectionHeader title="Suggested contacts" />
          <ContactResultsList
            mode="recommended"
            onFriendRequestsPress={onFriendRequestsPress}
            onUserPress={onUserPress}
            users={recommendedUsers}
          />
        </View>
      )
    }

    return (
      <EmptyQueryState
        hasResolvedSuggestions={hasResolvedSuggestions}
        suggestions={suggestions}
        isLoadingSuggestions={isLoadingSuggestions}
        onSuggestionPress={onSuggestionPress}
        showSuggestions={showSuggestions}
      />
    )
  }

  if (isNetworkResolved && !isOnline) {
    return (
      <SearchMessageState
        description="No internet connection. Connect to the internet and try again."
        icon="cloud-off"
        title="You’re offline"
      />
    )
  }

  if (normalizedQuery !== normalizedDebouncedQuery || (isLoading && !data)) {
    return <SearchResultsSkeleton selectedTab={selectedTab} tileSize={tileSize} />
  }

  if (isError && !data) {
    return (
      <SearchMessageState
        title="Something went wrong"
        description="Check your connection and try again."
        icon="cloud-off"
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
    return (
      <SearchMessageState
        actionLabel="Clear search"
        description="Try another keyword"
        onPress={onClearQuery}
        title="No results found"
      />
    )
  }

  if (selectedTab === 'contacts') {
    return (
      <View>
        <SearchSectionHeader title="Contacts" />
        <ContactResultsList
          mode="search"
          onFriendRequestsPress={onFriendRequestsPress}
          onUserPress={onUserPress}
          users={contacts}
        />
      </View>
    )
  }

  if (selectedTab === 'reels') {
    return (
      <View>
        <SearchSectionHeader title="Reels" />
        <ReelThumbnailGrid onReelPress={onReelPress} reels={reels} tileSize={tileSize} />
      </View>
    )
  }

  return (
    <View>
      {previewContacts.length > 0 ? (
        <>
          <SearchSectionHeader title="Contacts" onSeeAll={() => onSwitchTab('contacts')} />
          <ContactResultsList
            mode="search"
            onFriendRequestsPress={onFriendRequestsPress}
            onUserPress={onUserPress}
            users={previewContacts}
          />
        </>
      ) : null}

      {previewReels.length > 0 ? (
        <>
          <SearchSectionHeader title="Reels" onSeeAll={() => onSwitchTab('reels')} />
          <ReelThumbnailGrid onReelPress={onReelPress} reels={previewReels} tileSize={tileSize} />
        </>
      ) : null}

      {isFetching ? (
        <View className="flex-row items-center justify-center gap-2 px-4 pb-2 pt-4">
          <ActivityIndicator color={colors.brand.tertiary} size="small" />
          <AppText className="text-sm2 text-text-muted">Updating results…</AppText>
        </View>
      ) : null}
    </View>
  )
}

export default function SearchScreen() {
  const router = useRouter()
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string | string[] }>()
  const routeTab = getSearchTabParam(tabParam)
  const insets = useSafeAreaInsets()
  const inputRef = useRef<TextInput | null>(null)
  const { width: windowWidth } = useWindowDimensions()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedTab, setSelectedTab] = useState<SearchTabKey>(() => routeTab ?? 'all')
  const { mutateAsync: startBotChat, isPending: isBotLoading } = useBotChat()
  const { runConversationEntry } = useConversationNavigation()

  const normalizedQuery = query.trim()
  const backendType = getBackendType(selectedTab)
  const shouldShowSuggestionChips = selectedTab === 'all'
  const shouldLoadRecommendedReels = normalizedQuery.length === 0 && selectedTab === 'reels'
  const shouldLoadRecommendedUsers = normalizedQuery.length === 0 && selectedTab === 'contacts'
  const { data: searchSuggestionsData, isLoading: isSearchSuggestionsLoading } =
    useSearchSuggestions(
      {
        type: backendType,
        limit: 8,
      },
      { enabled: shouldShowSuggestionChips },
    )
  const { data: recommendedReelsData, isLoading: isRecommendedReelsLoading } =
    useRecommendedReelsFeed({
      enabled: shouldLoadRecommendedReels,
      limit: 24,
    })
  const {
    data: recommendedUsers = [],
    isError: isRecommendedUsersError,
    isLoading: isRecommendedUsersLoading,
    refetch: refetchRecommendedUsers,
  } = useRecommendedUsers({
    enabled: shouldLoadRecommendedUsers,
    limit: 20,
  })
  const tileSize = useMemo(() => Math.floor((windowWidth - 4) / 3), [windowWidth])
  const searchSuggestionChips = useMemo(
    () =>
      (searchSuggestionsData?.suggestions ?? []).map((suggestion) => ({
        label: suggestion.label,
        query: suggestion.query,
      })),
    [searchSuggestionsData?.suggestions],
  )
  const recommendedReels = useMemo(
    () => flattenRecommendedReelPages(recommendedReelsData?.pages ?? []),
    [recommendedReelsData],
  )
  const hasResolvedSearchSuggestions =
    shouldShowSuggestionChips &&
    (searchSuggestionsData !== undefined || !isSearchSuggestionsLoading)
  const isSearchTyping = normalizedQuery.length > 0 && normalizedQuery !== debouncedQuery.trim()

  useEffect(() => {
    if (routeTab) {
      setSelectedTab(routeTab)
    }
  }, [routeTab])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedQuery(normalizedQuery)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeoutId)
  }, [normalizedQuery])

  const handleSwitchSearchTab = useCallback(
    (tab: SearchTabKey) => {
      setSelectedTab(tab)
      router.setParams({ tab })
    },
    [router],
  )

  const handleSuggestionPress = useCallback(
    (value: string) => {
      handleSwitchSearchTab('all')
      setQuery(value)
      inputRef.current?.focus()
    },
    [handleSwitchSearchTab],
  )

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
        params: { id: reel.id, source: 'search' },
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

  const handleFriendRequestsPress = useCallback(() => {
    router.push('/(tabs)/friends?section=received')
  }, [router])

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: getDockedTabBarHeight(insets.bottom) + 16 }}
      >
        <SearchHeader isBotLoading={isBotLoading} onBotChat={handleBotChat} />

        <View className="px-5 pt-1">
          <AppSearchBar
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Search reels, contacts, topics"
            placeholderTextColor={colors.text.tertiary}
            iconColor={colors.brand.secondary}
            iconPlacement="left"
            isLoading={isSearchTyping}
            loadingColor={colors.brand.primary}
            onClear={() => setQuery('')}
            containerClassName="h-[52px] rounded-full px-4 py-0"
            size="compact"
          />
        </View>

        <View className="mx-5 mt-3 flex-row rounded-full bg-surface-muted p-1">
          <SearchTabButton
            active={selectedTab === 'all'}
            label="All"
            onPress={() => handleSwitchSearchTab('all')}
          />
          <SearchTabButton
            active={selectedTab === 'reels'}
            label="Reels"
            onPress={() => handleSwitchSearchTab('reels')}
          />
          <SearchTabButton
            active={selectedTab === 'contacts'}
            label="Contacts"
            onPress={() => handleSwitchSearchTab('contacts')}
          />
        </View>

        <SearchResultsPanel
          backendType={backendType}
          debouncedQuery={debouncedQuery}
          hasResolvedSuggestions={hasResolvedSearchSuggestions}
          isLoadingSuggestions={isSearchSuggestionsLoading}
          isRecommendedReelsLoading={isRecommendedReelsLoading}
          isRecommendedUsersError={isRecommendedUsersError}
          isRecommendedUsersLoading={isRecommendedUsersLoading}
          onReelPress={handleReelPress}
          onFriendRequestsPress={handleFriendRequestsPress}
          onClearQuery={() => setQuery('')}
          onRecommendedUsersRetry={() => {
            void refetchRecommendedUsers()
          }}
          onSuggestionPress={handleSuggestionPress}
          onSwitchTab={handleSwitchSearchTab}
          onUserPress={handleUserPress}
          query={query}
          recommendedReels={recommendedReels}
          recommendedUsers={recommendedUsers}
          selectedTab={selectedTab}
          showSuggestions={shouldShowSuggestionChips}
          suggestions={searchSuggestionChips}
          tileSize={tileSize}
        />
      </ScrollView>
    </SafeAreaView>
  )
}
