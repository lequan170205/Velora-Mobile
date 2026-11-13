import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  BackHandler,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppPressable, AppText } from '../../src/components/base'
import { ChatAvatar } from '../../src/components/chat/ChatAvatar'
import { AppSearchBar } from '../../src/components/common/AppSearchBar'
import { getDockedTabBarHeight } from '../../src/components/navigation/CustomTabBar'
import {
  ReelThumbnailGrid,
  ReelThumbnailGridSkeleton,
  ReelThumbnailTile,
} from '../../src/components/reels/ReelThumbnailGrid'
import { SearchResultTabs } from '../../src/components/search/SearchResultTabs'
import { SearchTagChips } from '../../src/components/search/SearchTagChips'
import { SearchTagRow } from '../../src/components/search/SearchTagRow'
import { VeloraAiButton } from '../../src/components/search/VeloraAiButton'
import { colors } from '../../src/constants/theme'
import { useBotChat } from '../../src/hooks/useBotChat'
import { useConversationNavigation } from '../../src/hooks/useConversationNavigation'
import { useFriendshipStatus } from '../../src/hooks/useFriends'
import { useGlobalSearch } from '../../src/hooks/useGlobalSearch'
import { useRecommendedUsers } from '../../src/hooks/useRecommendedUsers'
import { useRecommendedReelsFeed } from '../../src/hooks/useReels'
import { useSearchTags } from '../../src/hooks/useSearchTags'
import { useTagReelsFeed } from '../../src/hooks/useTagReelsFeed'
import { flattenRecommendedReelPages } from '../../src/lib/recommendationFeed'
import { deriveTagsFromReels } from '../../src/lib/searchTags'
import { useNetworkStatus } from '../../src/providers/NetworkProvider'

import type { SearchTabKey } from '../../src/components/search/SearchResultTabs'
import type { FriendshipState } from '../../src/types/friend.types'
import type { ReelFeedListItem } from '../../src/types/reel.types'
import type { GlobalSearchType, PublicUserProfile } from '../../src/types/search.types'
import type { RecommendedPublicUserProfile } from '../../src/types/user.types'
import type { TextInput } from 'react-native'

const SEARCH_DEBOUNCE_MS = 400
const ALL_CONTACTS_PREVIEW_LIMIT = 5
const ALL_REELS_PREVIEW_LIMIT = 9
const ALL_TAGS_PREVIEW_LIMIT = 4
const BROWSE_REELS_LIMIT = 24
const TRENDING_TAGS_LIMIT = 12
const SEARCH_LIMITS: Record<GlobalSearchType, number> = {
  all: 18,
  users: 20,
  reels: 24,
  tags: 20,
}

const getSearchTabParam = (value?: string | string[]): SearchTabKey | null => {
  const normalizedValue = Array.isArray(value) ? value[0] : value

  return normalizedValue === 'all' ||
    normalizedValue === 'reels' ||
    normalizedValue === 'contacts' ||
    normalizedValue === 'tags'
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
  if (selectedTab === 'contacts') {
    return 'users'
  }

  return selectedTab
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

function SearchTopBar({
  inputRef,
  isBotLoading,
  isSearching,
  isSearchTyping,
  onBack,
  onBotChat,
  onChangeQuery,
  onFocus,
  query,
}: {
  inputRef: React.RefObject<TextInput | null>
  isBotLoading: boolean
  isSearching: boolean
  isSearchTyping: boolean
  onBack: () => void
  onBotChat: () => void
  onChangeQuery: (value: string) => void
  onFocus: () => void
  query: string
}) {
  return (
    <View className="flex-row items-center gap-2 px-4 pb-3 pt-2">
      {isSearching ? (
        <AppPressable
          className="h-11 w-11 items-center justify-center rounded-full"
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={4}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text.primary} />
        </AppPressable>
      ) : null}

      <View className="min-w-0 flex-1">
        <AppSearchBar
          ref={inputRef}
          value={query}
          onChangeText={onChangeQuery}
          onFocus={onFocus}
          placeholder="Search"
          placeholderTextColor={colors.text.secondary}
          iconColor={colors.text.secondary}
          iconPlacement="left"
          isLoading={isSearchTyping}
          loadingColor={colors.brand.primary}
          onClear={() => onChangeQuery('')}
          containerClassName="h-12 rounded-full border border-border-default bg-surface-input px-4 py-0"
          size="compact"
        />
      </View>

      {isSearching ? null : <VeloraAiButton isLoading={isBotLoading} onPress={onBotChat} />}
    </View>
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
        <MaterialIcons name={icon} size={22} color={colors.brand.tertiary} />
      </View>
      <AppText className="mt-4 text-center font-heading text-lg text-text-primary" selectable>
        {title}
      </AppText>

      {description ? (
        <AppText
          className="font-sans mt-1.5 text-center text-base2 leading-5 text-text-secondary"
          selectable
        >
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
          <AppText className="font-sans mt-0.5 text-sm2 text-text-secondary" numberOfLines={1}>
            {getHandleLabel(user.username)}
          </AppText>
        ) : null}

        {mutualFriendLabel ? (
          <AppText className="font-sans mt-1 text-xs2 text-text-muted" numberOfLines={1}>
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
              <AppText className="font-sans text-right text-xs2 text-brand">{statusLabel}</AppText>
            </AppPressable>
          ) : (
            <AppText className="font-sans text-right text-xs2 text-text-muted" selectable>
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

function TagRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View pointerEvents="none">
      {Array.from({ length: count }).map((_, index) => (
        <View key={`tag-skeleton-${index}`} className="flex-row items-center px-5 py-3">
          <View className="h-12 w-12 rounded-full bg-surface-muted" />
          <View className="ml-3 flex-1 gap-2.5">
            <View className="h-3.5 w-2/5 rounded-full bg-surface-muted" />
            <View className="h-3 w-1/4 rounded-full bg-surface-muted" />
          </View>
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
        <SearchSectionHeader title={title ?? 'Accounts'} />
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

  if (selectedTab === 'tags') {
    return (
      <View>
        <SearchSectionHeader title={title ?? 'Tags'} />
        <TagRowsSkeleton />
      </View>
    )
  }

  return (
    <View>
      <SearchSectionHeader title="Accounts" />
      <ContactResultsSkeleton count={3} />
      <SearchSectionHeader title="Reels" />
      <ReelThumbnailGridSkeleton tileSize={tileSize} />
    </View>
  )
}

function TagResultsList({
  onTagPress,
  tags,
}: {
  onTagPress: (tag: string) => void
  tags: { tag: string; reelCount: number }[]
}) {
  return (
    <View>
      {tags.map((item) => (
        <SearchTagRow key={item.tag} item={item} onPress={onTagPress} />
      ))}
    </View>
  )
}

function BrowseReelsFeed({
  activeTag,
  bottomPadding,
  hasError,
  isFetchingNextPage,
  isLoading,
  isRefreshing,
  onClearTag,
  onEndReached,
  onReelPress,
  onRefresh,
  onRetry,
  reels,
  tileSize,
}: {
  activeTag: string | null
  bottomPadding: number
  hasError: boolean
  isFetchingNextPage: boolean
  isLoading: boolean
  isRefreshing: boolean
  onClearTag: () => void
  onEndReached: () => void
  onReelPress: (reel: ReelFeedListItem) => void
  onRefresh: () => void
  onRetry: () => void
  reels: ReelFeedListItem[]
  tileSize: number
}) {
  const renderItem = useCallback(
    ({ item, index }: { item: ReelFeedListItem; index: number }) => (
      <ReelThumbnailTile index={index} onPress={onReelPress} reel={item} tileSize={tileSize} />
    ),
    [onReelPress, tileSize],
  )

  const emptyState = isLoading ? (
    <ReelThumbnailGridSkeleton count={12} tileSize={tileSize} />
  ) : hasError ? (
    <SearchMessageState
      actionLabel="Retry"
      description="Check your connection and try again."
      icon="cloud-off"
      onPress={onRetry}
      title="Couldn’t load reels"
    />
  ) : activeTag ? (
    <SearchMessageState
      actionLabel="Back to For you"
      description="Try another tag or come back later."
      icon="movie-filter"
      onPress={onClearTag}
      title={`No reels tagged #${activeTag} yet`}
    />
  ) : (
    <SearchMessageState
      description="Explore a topic and come back for new picks."
      icon="movie-filter"
      title="No recommended reels yet"
    />
  )

  return (
    <FlatList
      // Remount per tag so each topic starts at the top of its own grid.
      key={activeTag ?? 'for-you'}
      data={reels}
      keyExtractor={(reel) => reel.id}
      numColumns={3}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      ListEmptyComponent={emptyState}
      ListFooterComponent={
        isFetchingNextPage ? (
          <View className="items-center py-4">
            <ActivityIndicator color={colors.brand.tertiary} size="small" />
          </View>
        ) : null
      }
      initialNumToRender={12}
      windowSize={7}
    />
  )
}

function SearchResultsPanel({
  backendType,
  debouncedQuery,
  isRecommendedReelsLoading,
  isRecommendedUsersError,
  isRecommendedUsersLoading,
  isTrendingTagsLoading,
  onClearQuery,
  onFriendRequestsPress,
  onRecommendedUsersRetry,
  onReelPress,
  onSwitchTab,
  onTagPress,
  onUserPress,
  query,
  recommendedReels,
  recommendedUsers,
  selectedTab,
  tileSize,
  trendingTags,
}: {
  backendType: GlobalSearchType
  debouncedQuery: string
  isRecommendedReelsLoading: boolean
  isRecommendedUsersError: boolean
  isRecommendedUsersLoading: boolean
  isTrendingTagsLoading: boolean
  onClearQuery: () => void
  onFriendRequestsPress: () => void
  onRecommendedUsersRetry: () => void
  onReelPress: (reel: ReelFeedListItem) => void
  onSwitchTab: (tab: SearchTabKey) => void
  onTagPress: (tag: string) => void
  onUserPress: (user: PublicUserProfile) => void
  query: string
  recommendedReels: ReelFeedListItem[]
  recommendedUsers: RecommendedPublicUserProfile[]
  selectedTab: SearchTabKey
  tileSize: number
  trendingTags: { tag: string; reelCount: number }[]
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
            description="Explore a topic and come back for new picks."
            icon="movie-filter"
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
            title="Suggested accounts"
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
            title="No account suggestions yet"
            description="Try searching for someone"
          />
        )
      }

      return (
        <View>
          <SearchSectionHeader title="Suggested accounts" />
          <ContactResultsList
            mode="recommended"
            onFriendRequestsPress={onFriendRequestsPress}
            onUserPress={onUserPress}
            users={recommendedUsers}
          />
        </View>
      )
    }

    // "For you" and "Tags" share the same first frame: what is trending right now.
    if (isTrendingTagsLoading && trendingTags.length === 0) {
      return <SearchResultsSkeleton selectedTab="tags" tileSize={tileSize} title="Trending tags" />
    }

    if (trendingTags.length === 0) {
      return (
        <SearchMessageState
          icon="tag"
          title="Search Velora"
          description="Try an account name, a tag, or a reel title."
        />
      )
    }

    return (
      <View>
        <SearchSectionHeader title="Trending tags" />
        <TagResultsList onTagPress={onTagPress} tags={trendingTags} />
      </View>
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
  const tags = data?.tags ?? []
  const hasResults =
    selectedTab === 'all'
      ? contacts.length > 0 || reels.length > 0 || tags.length > 0
      : selectedTab === 'contacts'
        ? contacts.length > 0
        : selectedTab === 'reels'
          ? reels.length > 0
          : tags.length > 0

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
        <SearchSectionHeader title="Accounts" />
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

  if (selectedTab === 'tags') {
    return (
      <View>
        <SearchSectionHeader title="Tags" />
        <TagResultsList onTagPress={onTagPress} tags={tags} />
      </View>
    )
  }

  return (
    <View>
      {contacts.length > 0 ? (
        <>
          <SearchSectionHeader title="Accounts" onSeeAll={() => onSwitchTab('contacts')} />
          <ContactResultsList
            mode="search"
            onFriendRequestsPress={onFriendRequestsPress}
            onUserPress={onUserPress}
            users={contacts.slice(0, ALL_CONTACTS_PREVIEW_LIMIT)}
          />
        </>
      ) : null}

      {reels.length > 0 ? (
        <>
          <SearchSectionHeader title="Reels" onSeeAll={() => onSwitchTab('reels')} />
          <ReelThumbnailGrid
            onReelPress={onReelPress}
            reels={reels.slice(0, ALL_REELS_PREVIEW_LIMIT)}
            tileSize={tileSize}
          />
        </>
      ) : null}

      {tags.length > 0 ? (
        <>
          <SearchSectionHeader title="Tags" onSeeAll={() => onSwitchTab('tags')} />
          <TagResultsList onTagPress={onTagPress} tags={tags.slice(0, ALL_TAGS_PREVIEW_LIMIT)} />
        </>
      ) : null}

      {isFetching ? (
        <View className="flex-row items-center justify-center gap-2 px-4 pb-2 pt-4">
          <ActivityIndicator color={colors.brand.tertiary} size="small" />
          <AppText className="font-sans text-sm2 text-text-muted">Updating results…</AppText>
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
  const [isSearching, setIsSearching] = useState(() => routeTab !== null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { mutateAsync: startBotChat, isPending: isBotLoading } = useBotChat()
  const { runConversationEntry } = useConversationNavigation()

  const normalizedQuery = query.trim()
  const backendType = getBackendType(selectedTab)
  const browseTag = isSearching ? null : activeTag
  const shouldLoadRecommendedReels =
    normalizedQuery.length === 0 && (isSearching ? selectedTab === 'reels' : activeTag === null)
  const shouldLoadRecommendedUsers =
    normalizedQuery.length === 0 && isSearching && selectedTab === 'contacts'
  const { data: trendingTags = [], isLoading: isTrendingTagsLoading } = useSearchTags({
    limit: TRENDING_TAGS_LIMIT,
  })
  const tagFeed = useTagReelsFeed({ tag: browseTag, limit: BROWSE_REELS_LIMIT })
  const recommendedFeed = useRecommendedReelsFeed({
    enabled: shouldLoadRecommendedReels,
    limit: BROWSE_REELS_LIMIT,
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
  const tileSize = useMemo(() => (windowWidth - 4) / 3, [windowWidth])
  const recommendedReels = useMemo(
    () => flattenRecommendedReelPages(recommendedFeed.data?.pages ?? []),
    [recommendedFeed.data],
  )
  const chipTags = useMemo(
    () =>
      trendingTags.length > 0
        ? trendingTags
        : deriveTagsFromReels(recommendedReels, TRENDING_TAGS_LIMIT),
    [recommendedReels, trendingTags],
  )
  const isSearchTyping = normalizedQuery.length > 0 && normalizedQuery !== debouncedQuery.trim()
  const bottomPadding = getDockedTabBarHeight(insets.bottom) + 16

  useEffect(() => {
    if (routeTab) {
      setSelectedTab(routeTab)
      setIsSearching(true)
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

  const handleExitSearch = useCallback(() => {
    setQuery('')
    setIsSearching(false)
    setSelectedTab('all')
    inputRef.current?.blur()
    // Clear the route param so the next Friends -> Contacts entry is seen as a change.
    router.setParams({ tab: undefined })
  }, [router])

  useEffect(() => {
    if (!isSearching) {
      return undefined
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleExitSearch()
      return true
    })

    return () => subscription.remove()
  }, [handleExitSearch, isSearching])

  const handleTagPress = useCallback(
    (tag: string) => {
      setActiveTag(tag)
      handleExitSearch()
    },
    [handleExitSearch],
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

  const activeFeed = activeTag ? tagFeed : recommendedFeed
  const handleBrowseEndReached = useCallback(() => {
    if (activeFeed.hasNextPage && !activeFeed.isFetchingNextPage) {
      void activeFeed.fetchNextPage()
    }
  }, [activeFeed])

  const handleBrowseRefresh = useCallback(async () => {
    setIsRefreshing(true)

    try {
      if (activeTag) {
        await tagFeed.refetch()
      } else {
        await recommendedFeed.refreshWithNewSession()
      }
    } finally {
      setIsRefreshing(false)
    }
  }, [activeTag, recommendedFeed, tagFeed])

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <SearchTopBar
        inputRef={inputRef}
        isBotLoading={isBotLoading}
        isSearching={isSearching}
        isSearchTyping={isSearchTyping}
        onBack={handleExitSearch}
        onBotChat={handleBotChat}
        onChangeQuery={setQuery}
        onFocus={() => setIsSearching(true)}
        query={query}
      />

      {isSearching ? (
        <>
          <SearchResultTabs selected={selectedTab} onChange={handleSwitchSearchTab} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: bottomPadding }}
          >
            <SearchResultsPanel
              backendType={backendType}
              debouncedQuery={debouncedQuery}
              isRecommendedReelsLoading={recommendedFeed.isLoading}
              isRecommendedUsersError={isRecommendedUsersError}
              isRecommendedUsersLoading={isRecommendedUsersLoading}
              isTrendingTagsLoading={isTrendingTagsLoading}
              onClearQuery={() => setQuery('')}
              onFriendRequestsPress={handleFriendRequestsPress}
              onRecommendedUsersRetry={() => {
                void refetchRecommendedUsers()
              }}
              onReelPress={handleReelPress}
              onSwitchTab={handleSwitchSearchTab}
              onTagPress={handleTagPress}
              onUserPress={handleUserPress}
              query={query}
              recommendedReels={recommendedReels}
              recommendedUsers={recommendedUsers}
              selectedTab={selectedTab}
              tileSize={tileSize}
              trendingTags={trendingTags}
            />
          </ScrollView>
        </>
      ) : (
        <>
          <SearchTagChips
            activeTag={activeTag}
            isLoading={isTrendingTagsLoading}
            onSelectForYou={() => setActiveTag(null)}
            onSelectTag={setActiveTag}
            tags={chipTags}
          />

          <View className="mt-3 flex-1">
            <BrowseReelsFeed
              activeTag={activeTag}
              bottomPadding={bottomPadding}
              hasError={activeFeed.isError}
              isFetchingNextPage={activeFeed.isFetchingNextPage}
              isLoading={activeFeed.isLoading}
              isRefreshing={isRefreshing}
              onClearTag={() => setActiveTag(null)}
              onEndReached={handleBrowseEndReached}
              onRefresh={() => {
                void handleBrowseRefresh()
              }}
              onReelPress={handleReelPress}
              onRetry={() => {
                void activeFeed.refetch()
              }}
              reels={activeTag ? tagFeed.reels : recommendedReels}
              tileSize={tileSize}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  )
}
