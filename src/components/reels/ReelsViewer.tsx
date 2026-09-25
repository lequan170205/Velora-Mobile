import { Ionicons, MaterialIcons } from '@expo/vector-icons'
import { useIsFocused } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AppState,
  ActivityIndicator,
  InteractionManager,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageScrollEvent,
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view'
import Animated, {
  Extrapolation,
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import { useReelAnalyticsTracker } from '@/hooks/useReelAnalyticsTracker'
import { useReelPlaybackPreferences } from '@/hooks/useReelPlaybackPreferences'
import { useReelSavingMode } from '@/hooks/useReelSavingMode'
import {
  cancelQueuedTemporaryReelVideoCacheExcept,
  getCachedTemporaryReelVideo,
} from '@/lib/offlineReelVideoCache'
import { prefetchReelAssets, prefetchReelsForTemporaryOfflinePlayback } from '@/lib/reel-prefetch'
import { getReelCachePolicyForNetworkState } from '@/lib/reelCachePolicy'
import { readCachedReelFeedPage } from '@/lib/reelOfflineCache'
import {
  deduplicateReelsById,
  ReelPlaybackCoordinator,
  resolveReelIndexByIdentity,
} from '@/lib/reelPlaybackCoordinator'
import { useAuthStore } from '@/stores/authStore'

import { reelsApi } from '../../api/reels.api'
import { DEFAULT_REELS_LIMIT } from '../../constants/reels'
import { useFriends } from '../../hooks/useFriends'
import { useFriendsReelsFeed, useRecommendedReelsFeed, useReelContext } from '../../hooks/useReels'
import { flattenRecommendedReelPages } from '../../lib/recommendationFeed'
import { useNetworkStatus } from '../../providers/NetworkProvider'

import { ReelFeedItem } from './ReelFeedItem'
import { ReelLoadingRail } from './ReelLoadingRail'
import { ReelOfflineAlert } from './ReelOfflineAlert'
import { ReelOfflineSkeleton } from './ReelOfflineSkeleton'

import type { ReelVideoHandle, ReelVideoProgress } from './ReelVideo'
import type { Reel, ReelContextSource, ReelEventSource } from '../../types/reel.types'
import type { LayoutChangeEvent } from 'react-native'

type ReelsViewerMode = 'public' | 'context'
type FeedTab = 'friends' | 'for-you'

interface FeedTabState {
  activeReelId: string | null
  activeIndex: number
  scrollOffset: number
}

interface FeedFallbackState {
  viewerId: string
  feeds: Record<FeedTab, Reel[]>
}

const PRELOAD_RADIUS = 1
// ponytail: cap native pages at four batches; widen if a single fling skips beyond the window.
const PAGER_WINDOW_RADIUS = DEFAULT_REELS_LIMIT * 2
const PAGER_WINDOW_SIZE = PAGER_WINDOW_RADIUS * 2 + 1
const PAGE_RENDER_RADIUS = PRELOAD_RADIUS + 1
const PAGER_WINDOW_EDGE_THRESHOLD = 4
const PULL_TO_REFRESH_DISTANCE = 74
const OFFLINE_ALERT_DURATION_MS = 2000
const OFFLINE_END_PULL_DISTANCE = 88
const OFFLINE_END_REVEAL_HEIGHT = 72
const OFFLINE_END_TRIGGER_PROGRESS = 0.64
const OFFLINE_END_LOADING_DURATION_MS = 920
const INITIAL_FEED_TAB_STATE: FeedTabState = { activeIndex: 0, activeReelId: null, scrollOffset: 0 }
const EMPTY_FEED_FALLBACKS: Record<FeedTab, Reel[]> = { friends: [], 'for-you': [] }
const shouldShowRecommendationDebugOverlay =
  __DEV__ && process.env.EXPO_PUBLIC_ENABLE_RECOMMENDATION_DEBUG === 'true'

const getPagerWindowStart = (index: number, reelCount: number) =>
  Math.max(0, Math.min(Math.max(0, reelCount - PAGER_WINDOW_SIZE), index - PAGER_WINDOW_RADIUS))

type PagerViewRef = React.ElementRef<typeof PagerView>

interface ReelsViewerProps {
  bottomContentInset?: number
  contextItems?: Reel[]
  contextSource?: ReelContextSource
  eventSource?: ReelEventSource
  hideDescriptions?: boolean
  mode: ReelsViewerMode
  reelId?: string | undefined
  routeContextParam?: string | undefined
  returnConversationId?: string | undefined
  returnTo?: string | undefined
  returnUsername?: string | undefined
  headerTitle?: string
  headerRight?: React.ReactNode
  isSeriesPlayback?: boolean | undefined
  onOpenSeriesEpisodes?: (() => void) | undefined
  seriesEpisodeCount?: number | undefined
  disablePagerSwipe?: boolean | undefined
  hasPreviousContextPage?: boolean | undefined
  hasNextContextPage?: boolean | undefined
  isFetchingContextPage?: boolean | undefined
  onContextPageRequest?: ((direction: 'previous' | 'next') => void) | undefined
  onActiveReelChange?: (reel: Reel, index: number) => void
  tabBarHeight?: number
}

const areStringArraysEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

const buildReelVideoPrefetchPlan = (
  reels: Reel[],
  activeIndex: number,
  policy: ReturnType<typeof getReelCachePolicyForNetworkState>,
) => {
  if (activeIndex < 0 || reels.length === 0) {
    return []
  }

  const plannedReels: (Reel & { priority: number })[] = []
  const seenIds = new Set<string>()

  const appendReel = (reel: Reel | undefined, priority: number) => {
    if (!reel || seenIds.has(reel.id)) {
      return
    }

    seenIds.add(reel.id)
    plannedReels.push({
      ...reel,
      priority,
    })
  }

  if (policy.preloadCurrent) {
    appendReel(reels[activeIndex], 0)
  }

  for (let offset = 1; offset <= policy.preloadAheadCount; offset += 1) {
    appendReel(reels[activeIndex + offset], offset * 10)
  }

  if (policy.preloadPrevious) {
    appendReel(reels[activeIndex - 1], 30)
  }

  return plannedReels
}

export function ReelsViewer({
  bottomContentInset = 0,
  contextItems = [],
  contextSource = 'profile',
  eventSource,
  hideDescriptions = false,
  mode,
  reelId,
  routeContextParam,
  returnConversationId,
  returnTo,
  returnUsername,
  headerTitle,
  headerRight,
  isSeriesPlayback = false,
  onOpenSeriesEpisodes,
  seriesEpisodeCount,
  disablePagerSwipe = false,
  hasPreviousContextPage = false,
  hasNextContextPage = false,
  isFetchingContextPage = false,
  onContextPageRequest,
  onActiveReelChange,
}: ReelsViewerProps) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const isFocused = useIsFocused()
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')
  const { fontScale, height: windowHeight } = useWindowDimensions()
  const { isOnline, networkState } = useNetworkStatus()
  const { isReelSavingModeHydrated, reelSavingModeEnabled } = useReelSavingMode()
  const { liveTranscriptionEnabled, playbackSpeed, setLiveTranscriptionEnabled, setPlaybackSpeed } =
    useReelPlaybackPreferences()
  const {
    startReelSession,
    endCurrentReelSession,
    updateActiveMutedState,
    updateIntentionalPauseState,
    updatePlaybackProgress,
    flushReelEvents,
  } = useReelAnalyticsTracker()

  const pagerRef = useRef<PagerViewRef | null>(null)
  const playbackCoordinatorRef = useRef(new ReelPlaybackCoordinator())
  const handledRequestedReelIdRef = useRef<string | null>(null)
  const currentPageIndexRef = useRef(0)
  const pagerCurrentIndexRef = useRef<number | null>(null)
  const pagerScrollStateRef = useRef<'idle' | 'dragging' | 'settling'>('idle')
  const contextPageRequestInFlightRef = useRef(false)
  const pagerWindowStartRef = useRef(0)
  const pagerWindowInitializedRef = useRef(false)
  const pendingPagerWindowIndexRef = useRef<number | null>(null)
  const pendingPagerSelectionReelIdRef = useRef<string | null>(null)
  const isPagerWindowRebasingRef = useRef(false)
  const shouldUseLocalContextRef = useRef(false)
  const pagerScrollPositionRef = useRef<{ offset: number; position: number } | null>(null)
  const selectedPageIndexRef = useRef<number | null>(null)
  const pageCommitFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const offlineAlertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const offlineBoundaryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasFocusedRef = useRef(isFocused)
  const activeReelIdRef = useRef<string | null>(null)
  const reelsRef = useRef<Reel[]>([])
  const feedTabStatesRef = useRef<Record<FeedTab, FeedTabState>>({
    friends: { ...INITIAL_FEED_TAB_STATE },
    'for-you': { ...INITIAL_FEED_TAB_STATE },
  })
  const previousSelectedReelIdRef = useRef<string | undefined>(reelId)
  const hasShownOfflineFocusAlertRef = useRef(false)

  const [viewportHeight, setViewportHeight] = useState(windowHeight)
  const [pagerWindowStart, setPagerWindowStart] = useState(0)
  const videoViewportHeight = Math.max(0, viewportHeight - Math.max(0, bottomContentInset))
  const [activeReelId, setActiveReelId] = useState<string | null>(null)
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active')
  const [deletedReelIds, setDeletedReelIds] = useState<Set<string>>(() => new Set())
  const [isOfflineAlertVisible, setIsOfflineAlertVisible] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [clearDisplay, setClearDisplay] = useState(false)
  const [offlineReadyReelIds, setOfflineReadyReelIds] = useState<string[]>([])
  const [isTimelineInteracting, setIsTimelineInteracting] = useState(false)
  const [isActiveReelPausedByUser, setIsActiveReelPausedByUser] = useState(false)
  const [contextExtraItems, setContextExtraItems] = useState<Reel[]>([])
  const [contextNextCursor, setContextNextCursor] = useState<string | null>(null)
  const [isFetchingContextNextPage, setIsFetchingContextNextPage] = useState(false)
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)
  const [isSwitchingFeedTab, setIsSwitchingFeedTab] = useState(false)
  const [selectedFeedTab, setSelectedFeedTab] = useState<FeedTab>('for-you')
  const [feedFallbackReels, setFeedFallbackReels] = useState<FeedFallbackState>(() => ({
    viewerId,
    feeds: EMPTY_FEED_FALLBACKS,
  }))
  const visibleFeedFallbackReels =
    feedFallbackReels.viewerId === viewerId ? feedFallbackReels.feeds : EMPTY_FEED_FALLBACKS

  useEffect(() => {
    let isMounted = true
    const hydrateCachedFeed = async () => {
      try {
        const cachedParams = {
          recommended: true,
          excludeRecentlySeen: true,
          viewerId,
          visibility: 'public',
          limit: DEFAULT_REELS_LIMIT,
        } as const
        const cachedRecommended =
          (await readCachedReelFeedPage(cachedParams)) ??
          (await readCachedReelFeedPage({ ...cachedParams, excludeRecentlySeen: false }))

        if (!isMounted) return

        setFeedFallbackReels((current) => {
          const currentFeeds = current.viewerId === viewerId ? current.feeds : EMPTY_FEED_FALLBACKS
          const nextForYou =
            currentFeeds['for-you'].length > 0
              ? currentFeeds['for-you']
              : (cachedRecommended?.items ?? [])
          const nextFriends = currentFeeds.friends

          if (
            current.viewerId === viewerId &&
            nextForYou === currentFeeds['for-you'] &&
            nextFriends === currentFeeds.friends
          ) {
            return current
          }

          return {
            viewerId,
            feeds: { 'for-you': nextForYou, friends: nextFriends },
          }
        })
      } catch {
        // Non-blocking offline cache hydration
      }
    }

    void hydrateCachedFeed()

    return () => {
      isMounted = false
    }
  }, [viewerId])

  const scrollToReelIndex = useCallback((index: number) => {
    const reelCount = reelsRef.current.length
    const nextIndex = Math.max(0, Math.min(Math.max(0, reelCount - 1), index))
    const pager = pagerRef.current

    if (!pager || reelCount === 0) {
      return
    }

    const nextWindowStart = shouldUseLocalContextRef.current
      ? 0
      : getPagerWindowStart(nextIndex, reelCount)
    if (nextWindowStart !== pagerWindowStartRef.current) {
      pagerWindowInitializedRef.current = true
      pendingPagerSelectionReelIdRef.current = reelsRef.current[nextIndex]?.id ?? null
      pagerWindowStartRef.current = nextWindowStart
      pendingPagerWindowIndexRef.current = nextIndex
      isPagerWindowRebasingRef.current = true
      pagerCurrentIndexRef.current = nextIndex
      setPagerWindowStart(nextWindowStart)
      return
    }

    const localIndex = nextIndex - nextWindowStart
    if (
      pagerCurrentIndexRef.current === nextIndex &&
      pagerScrollStateRef.current === 'idle' &&
      selectedPageIndexRef.current === null
    ) {
      return
    }

    pagerScrollPositionRef.current = null
    selectedPageIndexRef.current = null
    if (pageCommitFrameRef.current !== null) {
      cancelAnimationFrame(pageCommitFrameRef.current)
      pageCommitFrameRef.current = null
    }

    pagerCurrentIndexRef.current = nextIndex
    pendingPagerSelectionReelIdRef.current = reelsRef.current[nextIndex]?.id ?? null
    pager.setPageWithoutAnimation(localIndex)
  }, [])
  const pauseAllReelPlayers = useCallback(() => {
    playbackCoordinatorRef.current.pauseAll()
  }, [])
  const handlePlayerChange = useCallback((reelId: string, player: ReelVideoHandle | null) => {
    playbackCoordinatorRef.current.register(reelId, player)
  }, [])

  const pullProgress = useSharedValue(0)
  const refreshSpin = useSharedValue(0)
  const refreshTriggered = useSharedValue(false)
  const offlineBoundaryProgress = useSharedValue(0)
  const offlineBoundaryLoading = useSharedValue(0)

  const shouldUseReelContext = mode === 'context' && Boolean(reelId)
  const shouldUseLocalContext = shouldUseReelContext && contextItems.length > 0
  shouldUseLocalContextRef.current = shouldUseLocalContext
  const shouldFetchReelContext = shouldUseReelContext && !shouldUseLocalContext
  const shouldLoadPublicFeed = !shouldUseReelContext
  const shouldAllowRefresh = mode === 'public'
  const emptyStateTextSpacing = 8 * fontScale
  const emptyStateTitleLineHeight = 36 * fontScale
  const emptyStateDescriptionLineHeight = 24 * fontScale
  const { data: viewerFriends } = useFriends(undefined, { enabled: shouldLoadPublicFeed })
  const shouldShowFriendsTab = Boolean(viewerFriends?.length)

  const handleTimelineInteractionChange = useCallback((isInteracting: boolean) => {
    setIsTimelineInteracting(isInteracting)
  }, [])

  const handleToggleMuted = useCallback(() => {
    setIsMuted((current) => !current)
  }, [])

  const handleClearDisplay = useCallback(() => {
    setClearDisplay(true)
  }, [])

  const handleRestoreDisplay = useCallback(() => {
    setClearDisplay(false)
  }, [])

  useEffect(() => {
    if (!isFocused) {
      setClearDisplay(false)
    }
  }, [isFocused])

  const {
    data: recommendedData,
    isPending: isRecommendedPending,
    isError: isRecommendedError,
    error: recommendedError,
    fetchNextPage: fetchRecommendedNextPage,
    hasNextPage: hasRecommendedNextPage,
    isFetchingNextPage: isFetchingRecommendedNextPage,
    isRefetching: isRefetchingRecommended,
    feedSessionId: recommendedFeedSessionId,
    algorithmVersion: recommendedAlgorithmVersion,
    refreshWithNewSession,
  } = useRecommendedReelsFeed({
    limit: DEFAULT_REELS_LIMIT,
    enabled: shouldLoadPublicFeed && selectedFeedTab === 'for-you',
  })
  const {
    reels: friendReels,
    isPending: isFriendsPending,
    isError: isFriendsError,
    error: friendsError,
    fetchNextPage: fetchFriendsNextPage,
    hasNextPage: hasFriendsNextPage,
    isFetchingNextPage: isFetchingFriendsNextPage,
    isRefetching: isRefetchingFriends,
    refetch: refetchFriends,
  } = useFriendsReelsFeed({
    limit: DEFAULT_REELS_LIMIT,
    enabled: shouldLoadPublicFeed && selectedFeedTab === 'friends',
  })
  const isPublicFeedPending =
    selectedFeedTab === 'friends' ? isFriendsPending : isRecommendedPending
  const isPublicFeedError = selectedFeedTab === 'friends' ? isFriendsError : isRecommendedError
  const publicFeedError = selectedFeedTab === 'friends' ? friendsError : recommendedError
  const fetchPublicNextPage =
    selectedFeedTab === 'friends' ? fetchFriendsNextPage : fetchRecommendedNextPage
  const hasPublicNextPage =
    selectedFeedTab === 'friends' ? hasFriendsNextPage : hasRecommendedNextPage
  const isFetchingPublicNextPage =
    selectedFeedTab === 'friends' ? isFetchingFriendsNextPage : isFetchingRecommendedNextPage
  const isRefetchingPublicFeed =
    selectedFeedTab === 'friends' ? isRefetchingFriends : isRefetchingRecommended

  const {
    data: reelContext,
    isPending: isContextPending,
    isError: isContextError,
    error: contextError,
    refetch: refetchContext,
  } = useReelContext(
    reelId,
    {
      source: contextSource,
      before: Math.max(1, DEFAULT_REELS_LIMIT - 1),
      after: Math.max(1, DEFAULT_REELS_LIMIT - 1),
    },
    {
      enabled: shouldFetchReelContext,
    },
  )

  const publicFeedReels = useMemo(
    () =>
      (selectedFeedTab === 'friends'
        ? friendReels
        : flattenRecommendedReelPages(recommendedData?.pages ?? [])
      ).filter((item) => !deletedReelIds.has(item.id)),
    [deletedReelIds, friendReels, recommendedData, selectedFeedTab],
  )

  useEffect(() => {
    if (!shouldLoadPublicFeed) {
      return
    }

    if (publicFeedReels.length === 0 && (isPublicFeedPending || isRefetchingPublicFeed)) {
      return
    }

    setFeedFallbackReels((current) => {
      const currentFeeds = current.viewerId === viewerId ? current.feeds : EMPTY_FEED_FALLBACKS
      const currentIds = currentFeeds[selectedFeedTab].map((reel) => reel.id)
      const nextIds = publicFeedReels.map((reel) => reel.id)

      if (current.viewerId === viewerId && areStringArraysEqual(currentIds, nextIds)) {
        return current
      }

      return {
        viewerId,
        feeds: { ...currentFeeds, [selectedFeedTab]: publicFeedReels },
      }
    })
  }, [
    isPublicFeedPending,
    isRefetchingPublicFeed,
    publicFeedReels,
    selectedFeedTab,
    shouldLoadPublicFeed,
    viewerId,
  ])

  const rawReels = useMemo(() => {
    if (shouldUseReelContext) {
      if (shouldUseLocalContext) {
        return contextItems.filter((item) => !deletedReelIds.has(item.id))
      }

      const fetchedContextItems = reelContext?.items ?? []
      const seenIds = new Set(fetchedContextItems.map((item) => item.id))

      const appendedItems = contextExtraItems.filter((item) => {
        if (seenIds.has(item.id)) {
          return false
        }

        seenIds.add(item.id)
        return true
      })

      return [...fetchedContextItems, ...appendedItems].filter(
        (item) => !deletedReelIds.has(item.id),
      )
    }

    if (publicFeedReels.length > 0) {
      return publicFeedReels
    }

    if (isPublicFeedPending || isRefetchingPublicFeed) {
      return visibleFeedFallbackReels[selectedFeedTab].filter(
        (item) => !deletedReelIds.has(item.id),
      )
    }

    return publicFeedReels
  }, [
    contextExtraItems,
    contextItems,
    deletedReelIds,
    isPublicFeedPending,
    isRefetchingPublicFeed,
    publicFeedReels,
    reelContext,
    selectedFeedTab,
    shouldUseLocalContext,
    shouldUseReelContext,
    visibleFeedFallbackReels,
  ])

  const reels = useMemo(() => deduplicateReelsById(rawReels), [rawReels])
  const reelContextSelectedId = reelContext?.selectedId
  const reelContextInitialNextCursor = reelContext?.nextCursor ?? null

  const requestedReelIndex = useMemo(() => {
    if (!shouldUseReelContext || !reelId) {
      return -1
    }

    return reels.findIndex((item) => item.id === reelId)
  }, [reels, reelId, shouldUseReelContext])

  const initialPageIndex = shouldUseReelContext
    ? requestedReelIndex > 0
      ? requestedReelIndex
      : 0
    : feedTabStatesRef.current[selectedFeedTab].activeIndex

  const safeInitialPageIndex = useMemo(() => {
    if (reels.length === 0) {
      return 0
    }

    return Math.max(0, Math.min(reels.length - 1, initialPageIndex))
  }, [initialPageIndex, reels.length])

  const initialPagerWindowStart = shouldUseLocalContext
    ? 0
    : getPagerWindowStart(safeInitialPageIndex, reels.length)
  const pagerWindowMaxStart = Math.max(0, reels.length - PAGER_WINDOW_SIZE)
  const statePagerWindowStart = Math.max(0, Math.min(pagerWindowMaxStart, pagerWindowStart))
  const currentGlobalPageIndex = Math.max(
    0,
    Math.min(
      Math.max(0, reels.length - 1),
      pagerCurrentIndexRef.current ?? currentPageIndexRef.current,
    ),
  )
  const currentWindowLength = Math.min(PAGER_WINDOW_SIZE, reels.length - statePagerWindowStart)
  const currentPageIsInWindow =
    currentGlobalPageIndex >= statePagerWindowStart &&
    currentGlobalPageIndex < statePagerWindowStart + currentWindowLength
  const visiblePagerWindowStart = shouldUseLocalContext
    ? 0
    : pagerWindowInitializedRef.current && activeReelIdRef.current
      ? currentPageIsInWindow
        ? statePagerWindowStart
        : getPagerWindowStart(currentGlobalPageIndex, reels.length)
      : initialPagerWindowStart
  if (!pagerWindowInitializedRef.current && reels.length > 0) {
    pagerWindowStartRef.current = visiblePagerWindowStart
  }
  const pagerWindowReels = useMemo(
    () =>
      shouldUseLocalContext
        ? reels
        : reels.slice(visiblePagerWindowStart, visiblePagerWindowStart + PAGER_WINDOW_SIZE),
    [reels, shouldUseLocalContext, visiblePagerWindowStart],
  )
  const initialPagerPage = Math.max(
    0,
    Math.min(pagerWindowReels.length - 1, safeInitialPageIndex - visiblePagerWindowStart),
  )

  useLayoutEffect(() => {
    if (reels.length === 0) {
      return
    }

    if (shouldUseLocalContext) {
      pagerWindowInitializedRef.current = true
      pagerWindowStartRef.current = 0
      pendingPagerWindowIndexRef.current = null
      isPagerWindowRebasingRef.current = false
      if (pagerWindowStart !== 0) setPagerWindowStart(0)
      return
    }

    pagerWindowInitializedRef.current = true
    if (pagerWindowStart !== visiblePagerWindowStart) {
      setPagerWindowStart(visiblePagerWindowStart)
    }
    if (pagerWindowStartRef.current !== visiblePagerWindowStart) {
      const currentActiveReelId = activeReelIdRef.current
      const activeIndexIsValid = Boolean(
        currentActiveReelId && reels.some((item) => item.id === currentActiveReelId),
      )
      const currentIndex =
        pendingPagerWindowIndexRef.current ??
        (activeIndexIsValid ? pagerCurrentIndexRef.current : null)
      pagerWindowStartRef.current = visiblePagerWindowStart

      if (currentIndex !== null) {
        pendingPagerWindowIndexRef.current = Math.min(reels.length - 1, currentIndex)
        pendingPagerSelectionReelIdRef.current =
          reels[pendingPagerWindowIndexRef.current]?.id ?? null
        isPagerWindowRebasingRef.current = true
      }
    }

    const pendingIndex = pendingPagerWindowIndexRef.current
    if (pendingIndex !== null && pagerRef.current) {
      pendingPagerWindowIndexRef.current = null
      pagerScrollPositionRef.current = { offset: 0, position: pendingIndex }
      selectedPageIndexRef.current = pendingIndex
      pagerRef.current.setPageWithoutAnimation(pendingIndex - visiblePagerWindowStart)
      pagerCurrentIndexRef.current = pendingIndex
      currentPageIndexRef.current = pendingIndex
      requestAnimationFrame(() => {
        isPagerWindowRebasingRef.current = false
      })
    }
  }, [pagerWindowStart, reels, shouldUseLocalContext, visiblePagerWindowStart])

  const effectiveActiveReelId = useMemo(() => {
    if (activeReelId) {
      return activeReelId
    }

    if (reels.length === 0) {
      return null
    }

    return reels[safeInitialPageIndex]?.id ?? reels[0]?.id ?? null
  }, [activeReelId, reels, safeInitialPageIndex])

  const activeIndex = useMemo(
    () => reels.findIndex((reel) => reel.id === effectiveActiveReelId),
    [effectiveActiveReelId, reels],
  )
  const activeTelemetryReel = useMemo(
    () => reels.find((reel) => reel.id === effectiveActiveReelId) ?? null,
    [effectiveActiveReelId, reels],
  )
  const canPlayActiveReel =
    Boolean(effectiveActiveReelId) &&
    isFocused &&
    isAppActive &&
    !isManualRefreshing &&
    !isSwitchingFeedTab &&
    !isActiveReelPausedByUser

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      setIsAppActive(nextAppState === 'active')
    })

    return () => subscription.remove()
  }, [])

  useEffect(() => {
    playbackCoordinatorRef.current.transition(
      canPlayActiveReel ? effectiveActiveReelId : null,
      isMuted,
    )
  }, [canPlayActiveReel, effectiveActiveReelId, isMuted])

  useEffect(
    () => () => {
      pauseAllReelPlayers()
    },
    [pauseAllReelPlayers],
  )
  const telemetrySource =
    eventSource ??
    (mode === 'public' ? (selectedFeedTab === 'friends' ? 'FRIENDS' : 'RECOMMENDED') : 'DIRECT')
  const routeEventSource =
    telemetrySource === 'PROFILE'
      ? 'profile'
      : telemetrySource === 'SEARCH'
        ? 'search'
        : telemetrySource === 'SHARED'
          ? 'chat'
          : undefined
  const activeTelemetryReelRef = useRef<Reel | null>(activeTelemetryReel)
  const mutedRef = useRef(isMuted)
  activeTelemetryReelRef.current = activeTelemetryReel
  mutedRef.current = isMuted
  const reelCachePolicy = useMemo(
    () => getReelCachePolicyForNetworkState(networkState, { isOnline }),
    [isOnline, networkState],
  )
  const reelVideoPrefetchPlan = useMemo(
    () => buildReelVideoPrefetchPlan(reels, activeIndex, reelCachePolicy),
    [activeIndex, reelCachePolicy, reels],
  )
  const shouldSaveNearbyReelVideos = isReelSavingModeHydrated && reelSavingModeEnabled
  const offlineVideoCachePriorities = useMemo(
    () =>
      new Map(
        (reelCachePolicy.shouldCacheVideo && shouldSaveNearbyReelVideos
          ? reelVideoPrefetchPlan
          : []
        ).map((reel) => [reel.id, reel.priority]),
      ),
    [reelCachePolicy.shouldCacheVideo, reelVideoPrefetchPlan, shouldSaveNearbyReelVideos],
  )
  const reelIdsKey = useMemo(() => reels.map((reel) => reel.id).join('|'), [reels])
  const offlineReadyReelIdSet = useMemo(() => new Set(offlineReadyReelIds), [offlineReadyReelIds])
  const lastOfflineReadyIndex = useMemo(
    () =>
      reels.reduce(
        (lastReadyIndex, reel, index) =>
          offlineReadyReelIdSet.has(reel.id) ? index : lastReadyIndex,
        -1,
      ),
    [offlineReadyReelIdSet, reels],
  )
  const isAtOfflineBoundary =
    !isOnline &&
    reels.length > 0 &&
    activeIndex >= 0 &&
    lastOfflineReadyIndex >= 0 &&
    lastOfflineReadyIndex === reels.length - 1 &&
    activeIndex === lastOfflineReadyIndex

  const hideOfflineAlert = useCallback(() => {
    if (offlineAlertTimeoutRef.current) {
      clearTimeout(offlineAlertTimeoutRef.current)
      offlineAlertTimeoutRef.current = null
    }

    setIsOfflineAlertVisible(false)
  }, [])

  const showOfflineAlert = useCallback(() => {
    if (offlineAlertTimeoutRef.current) {
      clearTimeout(offlineAlertTimeoutRef.current)
    }

    setIsOfflineAlertVisible(true)
    offlineAlertTimeoutRef.current = setTimeout(() => {
      setIsOfflineAlertVisible(false)
      offlineAlertTimeoutRef.current = null
    }, OFFLINE_ALERT_DURATION_MS)
  }, [])

  const resetOfflineBoundaryFeedback = useCallback(() => {
    if (offlineBoundaryTimeoutRef.current) {
      clearTimeout(offlineBoundaryTimeoutRef.current)
      offlineBoundaryTimeoutRef.current = null
    }

    offlineBoundaryLoading.value = 0
    offlineBoundaryProgress.value = withTiming(0, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    })
  }, [offlineBoundaryLoading, offlineBoundaryProgress])

  const triggerOfflineBoundaryFeedback = useCallback(() => {
    if (offlineBoundaryTimeoutRef.current) {
      return
    }

    offlineBoundaryLoading.value = 1
    offlineBoundaryProgress.value = withTiming(1, {
      duration: 140,
      easing: Easing.out(Easing.cubic),
    })

    offlineBoundaryTimeoutRef.current = setTimeout(() => {
      offlineBoundaryLoading.value = 0
      offlineBoundaryProgress.value = withTiming(0, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      })
      offlineBoundaryTimeoutRef.current = null
      showOfflineAlert()
    }, OFFLINE_END_LOADING_DURATION_MS)
  }, [offlineBoundaryLoading, offlineBoundaryProgress, showOfflineAlert])

  useEffect(() => {
    const activeReel = activeTelemetryReelRef.current

    if (!canPlayActiveReel || !activeReel) {
      void endCurrentReelSession('screen_blur')
      return
    }

    startReelSession({
      muted: mutedRef.current,
      ...(telemetrySource === 'RECOMMENDED' && activeReel.recommendation
        ? { recommendation: activeReel.recommendation }
        : {}),
      reelId: activeReel.id,
      source: telemetrySource,
    })

    return () => {
      void endCurrentReelSession('switch')
    }
  }, [
    canPlayActiveReel,
    endCurrentReelSession,
    startReelSession,
    telemetrySource,
    effectiveActiveReelId,
  ])

  useEffect(() => {
    updateActiveMutedState(isMuted)
  }, [isMuted, updateActiveMutedState])

  const handlePlaybackProgress = useCallback(
    (
      reelId: string,
      progress: ReelVideoProgress,
      state: { isPlaying: boolean; isReady: boolean },
    ) => {
      const playbackSnapshot = playbackCoordinatorRef.current.getSnapshot()
      const isCurrentPlayingReel =
        activeReelIdRef.current === reelId && playbackSnapshot.playingReelIds.includes(reelId)

      if (!isCurrentPlayingReel) {
        return
      }

      updatePlaybackProgress({
        currentTime: progress.currentTime,
        duration: progress.duration,
        isBuffering: Boolean(progress.isBuffering),
        isPlaying: state.isPlaying,
      })
    },
    [updatePlaybackProgress],
  )
  const handleIntentionalPauseChange = useCallback(
    (paused: boolean) => {
      setIsActiveReelPausedByUser(paused)
      updateIntentionalPauseState(paused)
    },
    [updateIntentionalPauseState],
  )

  useEffect(() => {
    return () => {
      if (offlineAlertTimeoutRef.current) {
        clearTimeout(offlineAlertTimeoutRef.current)
        offlineAlertTimeoutRef.current = null
      }

      if (offlineBoundaryTimeoutRef.current) {
        clearTimeout(offlineBoundaryTimeoutRef.current)
        offlineBoundaryTimeoutRef.current = null
      }

      cancelAnimation(offlineBoundaryProgress)
      cancelAnimation(offlineBoundaryLoading)
    }
  }, [offlineBoundaryLoading, offlineBoundaryProgress])

  useEffect(() => {
    if (!isFocused) {
      hideOfflineAlert()
      hasShownOfflineFocusAlertRef.current = false
      return
    }

    if (isOnline) {
      hideOfflineAlert()
      hasShownOfflineFocusAlertRef.current = false
      return
    }

    if (hasShownOfflineFocusAlertRef.current) {
      return
    }

    hasShownOfflineFocusAlertRef.current = true
    showOfflineAlert()
  }, [hideOfflineAlert, isFocused, isOnline, showOfflineAlert])

  useEffect(() => {
    let isMounted = true
    const reelIds = reelIdsKey ? reelIdsKey.split('|') : []

    if (isOnline || reelIds.length === 0) {
      setOfflineReadyReelIds((current) => (current.length === 0 ? current : []))
      return () => {
        isMounted = false
      }
    }

    void Promise.all(
      reelIds.map(async (reelId) => ({
        id: reelId,
        record: await getCachedTemporaryReelVideo(reelId),
      })),
    ).then((results) => {
      if (!isMounted) {
        return
      }

      const nextOfflineReadyReelIds = results
        .filter((result) => Boolean(result.record))
        .map((result) => result.id)

      setOfflineReadyReelIds((current) =>
        areStringArraysEqual(current, nextOfflineReadyReelIds) ? current : nextOfflineReadyReelIds,
      )
    })

    return () => {
      isMounted = false
    }
  }, [isOnline, reelIdsKey])

  useEffect(() => {
    if (!isAtOfflineBoundary) {
      resetOfflineBoundaryFeedback()
    }
  }, [isAtOfflineBoundary, resetOfflineBoundaryFeedback])

  useEffect(() => {
    const allowedReelIds =
      isFocused && isOnline && shouldSaveNearbyReelVideos && reelCachePolicy.shouldCacheVideo
        ? reelVideoPrefetchPlan.map((reel) => reel.id)
        : []

    cancelQueuedTemporaryReelVideoCacheExcept(allowedReelIds)

    if (!isFocused || activeIndex < 0 || reels.length === 0) {
      return
    }

    if (!isOnline) {
      return
    }

    const interactionTask = InteractionManager.runAfterInteractions(() => {
      reelVideoPrefetchPlan.forEach((reel) => {
        void prefetchReelAssets(reel)
      })

      if (
        !shouldSaveNearbyReelVideos ||
        !reelCachePolicy.shouldCacheVideo ||
        reelVideoPrefetchPlan.length === 0
      ) {
        return
      }

      prefetchReelsForTemporaryOfflinePlayback(
        reelVideoPrefetchPlan,
        ...(typeof reelCachePolicy.maxVideoCacheBytes === 'number'
          ? [{ maxBytes: reelCachePolicy.maxVideoCacheBytes }]
          : []),
      )
    })

    return () => {
      interactionTask.cancel()
    }
  }, [
    activeIndex,
    isFocused,
    isOnline,
    reelCachePolicy.maxVideoCacheBytes,
    reelCachePolicy.shouldCacheVideo,
    reelVideoPrefetchPlan,
    reels.length,
    shouldSaveNearbyReelVideos,
  ])

  const isActiveError = shouldFetchReelContext ? isContextError : isPublicFeedError
  const isShowingOfflineCache =
    !shouldFetchReelContext &&
    selectedFeedTab === 'for-you' &&
    Boolean(recommendedData?.pages.some((page) => page.fromOfflineCache))

  const pullRefreshContainerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(pullProgress.value, [0, 0.22, 1], [0, 1, 1], Extrapolation.CLAMP)

    const translateY = interpolate(pullProgress.value, [0, 1], [0, 42], Extrapolation.CLAMP)

    const scale = interpolate(pullProgress.value, [0, 1], [0.86, 1], Extrapolation.CLAMP)

    return {
      opacity,
      transform: [{ translateY }, { scale }],
    }
  })

  const pullRefreshIconSpinStyle = useAnimatedStyle(() => {
    const dragRotate = interpolate(pullProgress.value, [0, 1], [0, 360], Extrapolation.CLAMP)

    const loadingRotate = refreshSpin.value * 360

    return {
      transform: [{ rotateZ: `${dragRotate + loadingRotate}deg` }],
    }
  })

  const offlineBoundaryUnderlayStyle = useAnimatedStyle(() => {
    const revealHeight = interpolate(
      offlineBoundaryProgress.value,
      [0, 1],
      [0, OFFLINE_END_REVEAL_HEIGHT],
      Extrapolation.CLAMP,
    )

    return {
      height: revealHeight,
      opacity: interpolate(
        offlineBoundaryProgress.value,
        [0, 0.12, 1],
        [0, 1, 1],
        Extrapolation.CLAMP,
      ),
    }
  })

  const offlineBoundaryPagerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          offlineBoundaryProgress.value,
          [0, 1],
          [0, -OFFLINE_END_REVEAL_HEIGHT],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }))

  useLayoutEffect(() => {
    reelsRef.current = reels
  }, [reels])

  useEffect(() => {
    if (activeReelIdRef.current || !effectiveActiveReelId) {
      return
    }

    activeReelIdRef.current = effectiveActiveReelId
    currentPageIndexRef.current = Math.max(0, activeIndex)
  }, [activeIndex, effectiveActiveReelId])

  useEffect(() => {
    const previousSelectedReelId = previousSelectedReelIdRef.current

    if (!shouldUseLocalContext && reelId && previousSelectedReelId !== reelId) {
      setContextExtraItems([])
      setContextNextCursor(null)
      handledRequestedReelIdRef.current = null
      currentPageIndexRef.current = 0
      activeReelIdRef.current = reelId
      setActiveReelId(reelId)

      requestAnimationFrame(() => {
        scrollToReelIndex(0)
      })
    }

    previousSelectedReelIdRef.current = reelId
  }, [reelId, scrollToReelIndex, shouldUseLocalContext])

  useEffect(() => {
    if (!shouldUseReelContext || shouldUseLocalContext) {
      setContextExtraItems([])
      setContextNextCursor(null)
      return
    }

    if (!reelContextSelectedId) {
      return
    }

    setContextExtraItems([])
    setContextNextCursor(reelContextInitialNextCursor)
  }, [
    reelContextInitialNextCursor,
    reelContextSelectedId,
    shouldUseLocalContext,
    shouldUseReelContext,
  ])

  useEffect(() => {
    if (!reelId) {
      handledRequestedReelIdRef.current = null
    }
  }, [reelId])

  useEffect(() => {
    if (isManualRefreshing) {
      pullProgress.value = withTiming(1, { duration: 90 })

      refreshSpin.value = 0
      refreshSpin.value = withRepeat(
        withTiming(1, {
          duration: 720,
          easing: Easing.linear,
        }),
        -1,
        false,
      )

      return
    }

    cancelAnimation(refreshSpin)
    refreshSpin.value = 0
    pullProgress.value = withTiming(0, { duration: 180 })
  }, [isManualRefreshing, pullProgress, refreshSpin])

  const setActiveByIndex = useCallback(
    (index: number) => {
      if (!isFocused) {
        return
      }

      const currentReels = reelsRef.current
      if (currentReels.length === 0) {
        currentPageIndexRef.current = 0

        if (activeReelIdRef.current !== null) {
          activeReelIdRef.current = null
          setActiveReelId(null)
        }

        return
      }

      const safeIndex = Math.max(0, Math.min(currentReels.length - 1, index))
      const nextReelId = currentReels[safeIndex]?.id ?? null

      currentPageIndexRef.current = safeIndex
      pagerCurrentIndexRef.current = safeIndex
      feedTabStatesRef.current[selectedFeedTab] = {
        activeReelId: nextReelId,
        activeIndex: safeIndex,
        scrollOffset: safeIndex * viewportHeight,
      }

      if (activeReelIdRef.current === nextReelId) {
        return
      }

      setIsActiveReelPausedByUser(false)
      activeReelIdRef.current = nextReelId
      setActiveReelId(nextReelId)
      if (currentReels[safeIndex]) {
        onActiveReelChange?.(currentReels[safeIndex], safeIndex)
      }
    },
    [isFocused, onActiveReelChange, selectedFeedTab, viewportHeight],
  )

  const handleFeedTabChange = useCallback(
    (nextFeedTab: FeedTab) => {
      if (
        nextFeedTab === selectedFeedTab ||
        isManualRefreshing ||
        isSwitchingFeedTab ||
        (nextFeedTab === 'friends' && !shouldShowFriendsTab)
      ) {
        return
      }

      setIsSwitchingFeedTab(true)
      pagerScrollStateRef.current = 'idle'
      feedTabStatesRef.current[selectedFeedTab] = {
        activeReelId: effectiveActiveReelId,
        activeIndex: Math.max(0, activeIndex),
        scrollOffset: Math.max(0, activeIndex) * viewportHeight,
      }

      pauseAllReelPlayers()
      setIsActiveReelPausedByUser(false)
      void endCurrentReelSession('tab_switch')
      activeReelIdRef.current = null
      pagerCurrentIndexRef.current = null
      setActiveReelId(null)
      setSelectedFeedTab(nextFeedTab)
      setIsSwitchingFeedTab(false)
    },
    [
      activeIndex,
      endCurrentReelSession,
      effectiveActiveReelId,
      isManualRefreshing,
      isSwitchingFeedTab,
      selectedFeedTab,
      shouldShowFriendsTab,
      pauseAllReelPlayers,
      viewportHeight,
    ],
  )

  useEffect(() => {
    if (selectedFeedTab === 'friends' && !shouldShowFriendsTab) {
      void handleFeedTabChange('for-you')
    }
  }, [handleFeedTabChange, selectedFeedTab, shouldShowFriendsTab])

  useEffect(() => {
    if (!shouldLoadPublicFeed || reels.length === 0) {
      return
    }

    const currentActiveReelId = activeReelIdRef.current
    if (currentActiveReelId && reels.some((item) => item.id === currentActiveReelId)) {
      return
    }

    if (pagerScrollStateRef.current !== 'idle') return

    const savedTabState = feedTabStatesRef.current[selectedFeedTab]
    const safeIndex = resolveReelIndexByIdentity(
      reels,
      savedTabState.activeReelId,
      savedTabState.activeIndex,
    )
    const nextReelId = reels[safeIndex]?.id ?? null

    currentPageIndexRef.current = safeIndex
    activeReelIdRef.current = nextReelId
    setActiveReelId((current) => (current === nextReelId ? current : nextReelId))

    requestAnimationFrame(() => {
      scrollToReelIndex(safeIndex)
    })
  }, [reels, scrollToReelIndex, selectedFeedTab, shouldLoadPublicFeed])

  useEffect(() => {
    if (reels.length === 0) {
      pagerCurrentIndexRef.current = null
    }
  }, [reels.length])

  useEffect(() => {
    if (!shouldUseReelContext || !reelId || handledRequestedReelIdRef.current === reelId) {
      return
    }

    if (requestedReelIndex === -1) {
      return
    }

    handledRequestedReelIdRef.current = reelId
    currentPageIndexRef.current = requestedReelIndex
    activeReelIdRef.current = reelId
    setIsActiveReelPausedByUser(false)
    setActiveReelId(reelId)
    if (reels[requestedReelIndex]) {
      onActiveReelChange?.(reels[requestedReelIndex], requestedReelIndex)
    }

    requestAnimationFrame(() => {
      scrollToReelIndex(requestedReelIndex)
    })
  }, [
    onActiveReelChange,
    reelId,
    reels,
    requestedReelIndex,
    scrollToReelIndex,
    shouldUseReelContext,
  ])

  useLayoutEffect(() => {
    if (!shouldUseLocalContext || pagerScrollStateRef.current !== 'idle') {
      return
    }

    const activeLocalIndex = activeReelIdRef.current
      ? reels.findIndex((item) => item.id === activeReelIdRef.current)
      : -1
    if (activeLocalIndex < 0 || pagerCurrentIndexRef.current === activeLocalIndex) {
      return
    }

    currentPageIndexRef.current = activeLocalIndex
    pagerScrollPositionRef.current = null
    selectedPageIndexRef.current = null
    if (pageCommitFrameRef.current !== null) {
      cancelAnimationFrame(pageCommitFrameRef.current)
      pageCommitFrameRef.current = null
    }

    isPagerWindowRebasingRef.current = true
    scrollToReelIndex(activeLocalIndex)
    requestAnimationFrame(() => {
      isPagerWindowRebasingRef.current = false
    })
  }, [activeReelId, reels, scrollToReelIndex, shouldUseLocalContext])

  useEffect(() => {
    if (
      !effectiveActiveReelId ||
      reels.length === 0 ||
      reels.some((item) => item.id === effectiveActiveReelId)
    ) {
      return
    }

    setActiveByIndex(currentPageIndexRef.current)
  }, [effectiveActiveReelId, reels, setActiveByIndex])

  useEffect(() => {
    const wasFocused = wasFocusedRef.current
    wasFocusedRef.current = isFocused

    if (!isFocused || wasFocused) {
      return
    }

    const activeReelIndex = activeReelIdRef.current
      ? reelsRef.current.findIndex((item) => item.id === activeReelIdRef.current)
      : currentPageIndexRef.current

    const safeIndex = Math.max(
      0,
      Math.min(reelsRef.current.length - 1, activeReelIndex >= 0 ? activeReelIndex : 0),
    )

    currentPageIndexRef.current = safeIndex

    const interactionTask = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        scrollToReelIndex(safeIndex)
      })
    })

    return () => {
      interactionTask.cancel()
    }
  }, [isFocused, scrollToReelIndex])

  const activeError = shouldFetchReelContext ? contextError : publicFeedError
  const errorMessage =
    (activeError as (Error & { response?: { data?: { message?: string } } }) | null)?.response?.data
      ?.message ||
    (activeError as Error | null)?.message ||
    'Could not load reels right now.'
  const isConnectivityError =
    Boolean(activeError) &&
    typeof activeError === 'object' &&
    activeError !== null &&
    'response' in activeError &&
    !(activeError as { response?: unknown }).response
  const shouldShowOfflineSkeleton = reels.length === 0 && (!isOnline || isConnectivityError)
  const isFeedPending = shouldFetchReelContext ? isContextPending : isPublicFeedPending

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height

    if (nextHeight <= 0 || nextHeight === viewportHeight) {
      return
    }

    setViewportHeight(nextHeight)
  }

  const fetchNextContextPage = useCallback(async () => {
    if (
      !shouldUseReelContext ||
      shouldUseLocalContext ||
      !reelContext?.scope ||
      !contextNextCursor ||
      isFetchingContextNextPage
    ) {
      return
    }

    setIsFetchingContextNextPage(true)

    try {
      const nextPage = await reelsApi.list({
        userId: reelContext.scope.userId,
        visibility: reelContext.scope.visibility,
        limit: DEFAULT_REELS_LIMIT,
        cursor: contextNextCursor,
      })

      setContextExtraItems((currentItems) => {
        const seenIds = new Set([
          ...reelContext.items.map((item) => item.id),
          ...currentItems.map((item) => item.id),
        ])

        const nextItems = nextPage.items.filter((item) => {
          if (seenIds.has(item.id)) {
            return false
          }

          seenIds.add(item.id)
          return true
        })

        return [...currentItems, ...nextItems]
      })

      setContextNextCursor(nextPage.nextCursor ?? null)
    } catch {
      // Keep cursor so the next page-selected event can retry this page.
    } finally {
      setIsFetchingContextNextPage(false)
    }
  }, [
    contextNextCursor,
    isFetchingContextNextPage,
    reelContext,
    shouldUseLocalContext,
    shouldUseReelContext,
  ])

  const maybeFetchNextPage = useCallback(
    (index: number) => {
      if (shouldUseLocalContext) {
        if (
          !onContextPageRequest ||
          isFetchingContextPage ||
          contextPageRequestInFlightRef.current
        ) {
          return
        }

        if (index <= 4 && hasPreviousContextPage) {
          contextPageRequestInFlightRef.current = true
          onContextPageRequest('previous')
          return
        }

        if (index >= Math.max(0, reels.length - 5) && hasNextContextPage) {
          contextPageRequestInFlightRef.current = true
          onContextPageRequest('next')
        }
        return
      }

      const shouldPrefetch = index >= Math.max(0, reels.length - 3)

      if (!shouldPrefetch) {
        return
      }

      if (shouldLoadPublicFeed && hasPublicNextPage && !isFetchingPublicNextPage) {
        void fetchPublicNextPage()
        return
      }

      if (
        shouldUseReelContext &&
        !shouldUseLocalContext &&
        contextNextCursor &&
        !isFetchingContextNextPage
      ) {
        void fetchNextContextPage()
      }
    },
    [
      contextNextCursor,
      fetchNextContextPage,
      fetchPublicNextPage,
      hasPublicNextPage,
      hasNextContextPage,
      hasPreviousContextPage,
      isFetchingContextPage,
      onContextPageRequest,
      isFetchingContextNextPage,
      isFetchingPublicNextPage,
      reels.length,
      shouldLoadPublicFeed,
      shouldUseLocalContext,
      shouldUseReelContext,
    ],
  )

  useEffect(() => {
    if (!isFetchingContextPage) {
      contextPageRequestInFlightRef.current = false
    }
  }, [isFetchingContextPage])
  const maybeRecenterPagerWindow = useCallback(
    (index: number) => {
      if (shouldUseLocalContext) return

      const reelCount = reelsRef.current.length
      const windowStart = pagerWindowStartRef.current
      const windowLength = Math.min(PAGER_WINDOW_SIZE, Math.max(0, reelCount - windowStart))
      const localIndex = index - windowStart
      const nearStart = localIndex <= PAGER_WINDOW_EDGE_THRESHOLD && windowStart > 0
      const nearEnd =
        localIndex >= windowLength - 1 - PAGER_WINDOW_EDGE_THRESHOLD &&
        windowStart + windowLength < reelCount

      if (!nearStart && !nearEnd) {
        return
      }

      const nextWindowStart = getPagerWindowStart(index, reelCount)
      if (nextWindowStart === windowStart) {
        return
      }

      pagerWindowStartRef.current = nextWindowStart
      pendingPagerWindowIndexRef.current = index
      pendingPagerSelectionReelIdRef.current = reelsRef.current[index]?.id ?? null
      isPagerWindowRebasingRef.current = true
      setPagerWindowStart(nextWindowStart)
    },
    [shouldUseLocalContext],
  )

  useEffect(() => {
    if (pagerScrollStateRef.current === 'idle' && reels.length > 0) {
      maybeRecenterPagerWindow(currentPageIndexRef.current)
    }
  }, [maybeRecenterPagerWindow, reels.length])

  const scheduleSettledPageCommit = useCallback(() => {
    if (pageCommitFrameRef.current !== null) {
      cancelAnimationFrame(pageCommitFrameRef.current)
    }

    pageCommitFrameRef.current = requestAnimationFrame(() => {
      pageCommitFrameRef.current = null
      if (pagerScrollStateRef.current !== 'idle') return

      const scrollPosition = pagerScrollPositionRef.current
      const nextIndex = scrollPosition
        ? Math.round(scrollPosition.position + scrollPosition.offset)
        : selectedPageIndexRef.current

      if (nextIndex === null) return

      selectedPageIndexRef.current = null
      const previousReelId = activeReelIdRef.current
      const nextReelId = reelsRef.current[nextIndex]?.id ?? null
      const playback = playbackCoordinatorRef.current.getSnapshot()
      const shouldPlayNextReel =
        Boolean(nextReelId) &&
        isFocused &&
        isAppActive &&
        !isManualRefreshing &&
        !isSwitchingFeedTab &&
        (playback.desiredReelId === nextReelId ||
          nextReelId !== previousReelId ||
          !isActiveReelPausedByUser)

      setActiveByIndex(nextIndex)
      playbackCoordinatorRef.current.transition(shouldPlayNextReel ? nextReelId : null, isMuted)
      maybeFetchNextPage(nextIndex)
      maybeRecenterPagerWindow(nextIndex)
    })
  }, [
    isActiveReelPausedByUser,
    isAppActive,
    isFocused,
    isMuted,
    isManualRefreshing,
    isSwitchingFeedTab,
    maybeFetchNextPage,
    maybeRecenterPagerWindow,
    setActiveByIndex,
  ])

  const handlePageScroll = useCallback(
    (event: PagerViewOnPageScrollEvent) => {
      if (isPagerWindowRebasingRef.current || pendingPagerSelectionReelIdRef.current) return

      pagerScrollPositionRef.current = {
        offset: event.nativeEvent.offset,
        position: pagerWindowStartRef.current + event.nativeEvent.position,
      }

      maybeFetchNextPage(
        Math.round(
          pagerWindowStartRef.current + event.nativeEvent.position + event.nativeEvent.offset,
        ),
      )

      if (pagerScrollStateRef.current === 'idle') {
        scheduleSettledPageCommit()
      }
    },
    [maybeFetchNextPage, scheduleSettledPageCommit],
  )
  const handlePageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const nextIndex = pagerWindowStartRef.current + event.nativeEvent.position
      const nextReelId = reelsRef.current[nextIndex]?.id
      const pendingReelId = pendingPagerSelectionReelIdRef.current
      if (pendingReelId && nextReelId !== pendingReelId) return
      if (pendingReelId === nextReelId) {
        pendingPagerSelectionReelIdRef.current = null
        isPagerWindowRebasingRef.current = false
      }
      if (isPagerWindowRebasingRef.current) return

      pagerCurrentIndexRef.current = nextIndex
      selectedPageIndexRef.current = nextIndex

      if (
        nextReelId &&
        nextReelId !== activeReelIdRef.current &&
        isFocused &&
        isAppActive &&
        !isManualRefreshing &&
        !isSwitchingFeedTab
      ) {
        const playback = playbackCoordinatorRef.current.getSnapshot()
        if (playback.desiredReelId !== nextReelId || playback.playingReelIds[0] !== nextReelId) {
          playbackCoordinatorRef.current.transition(nextReelId, isMuted)
        }
      }

      setActiveByIndex(nextIndex)
      if (pagerScrollStateRef.current === 'idle') {
        scheduleSettledPageCommit()
      }
    },
    [
      isAppActive,
      isFocused,
      isManualRefreshing,
      isMuted,
      isSwitchingFeedTab,
      scheduleSettledPageCommit,
      setActiveByIndex,
    ],
  )
  const handlePageScrollStateChanged = useCallback(
    (event: PageScrollStateChangedNativeEvent) => {
      const nextState = event.nativeEvent.pageScrollState
      if (nextState === 'dragging') {
        pendingPagerSelectionReelIdRef.current = null
        isPagerWindowRebasingRef.current = false
      }
      if (isPagerWindowRebasingRef.current) return

      pagerScrollStateRef.current = nextState

      if (nextState === 'dragging') {
        pagerScrollPositionRef.current = null
        selectedPageIndexRef.current = null
        if (pageCommitFrameRef.current !== null) {
          cancelAnimationFrame(pageCommitFrameRef.current)
          pageCommitFrameRef.current = null
        }
        return
      }

      if (nextState === 'idle') {
        scheduleSettledPageCommit()
      }
    },
    [scheduleSettledPageCommit],
  )

  useEffect(
    () => () => {
      if (pageCommitFrameRef.current !== null) {
        cancelAnimationFrame(pageCommitFrameRef.current)
      }
    },
    [],
  )

  const handleRefresh = useCallback(async () => {
    if (!shouldAllowRefresh || isManualRefreshing || isRefetchingPublicFeed) {
      return
    }

    setIsManualRefreshing(true)
    await endCurrentReelSession('manual_refresh')
    await flushReelEvents()

    try {
      setContextExtraItems([])
      setContextNextCursor(null)
      handledRequestedReelIdRef.current = null
      currentPageIndexRef.current = 0

      feedTabStatesRef.current[selectedFeedTab] = { ...INITIAL_FEED_TAB_STATE }
      const refreshedData =
        selectedFeedTab === 'friends'
          ? (await refetchFriends()).data
          : await refreshWithNewSession()
      const freshPage = refreshedData?.pages[0]

      if (!freshPage) {
        return
      }

      const nextFirstReel = freshPage.items.find((item) => !deletedReelIds.has(item.id)) ?? null

      if (nextFirstReel) {
        activeReelIdRef.current = nextFirstReel.id
        setActiveReelId(nextFirstReel.id)
      } else {
        activeReelIdRef.current = null
        setActiveReelId(null)
      }

      requestAnimationFrame(() => {
        scrollToReelIndex(0)
      })
    } finally {
      setIsManualRefreshing(false)
    }
  }, [
    deletedReelIds,
    endCurrentReelSession,
    flushReelEvents,
    isManualRefreshing,
    isRefetchingPublicFeed,
    refreshWithNewSession,
    refetchFriends,
    scrollToReelIndex,
    selectedFeedTab,
    shouldAllowRefresh,
  ])

  const pullToRefreshGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(
          shouldAllowRefresh &&
            reels.length > 0 &&
            activeIndex <= 0 &&
            !isTimelineInteracting &&
            !isManualRefreshing &&
            !isRefetchingPublicFeed,
        )
        .activeOffsetY([-100000, 22])
        .failOffsetX([-36, 36])
        .onBegin(() => {
          refreshTriggered.value = false
          pullProgress.value = 0
        })
        .onUpdate((event) => {
          const nextProgress = Math.max(
            0,
            Math.min(1, event.translationY / PULL_TO_REFRESH_DISTANCE),
          )

          pullProgress.value = nextProgress

          if (!refreshTriggered.value && event.translationY >= PULL_TO_REFRESH_DISTANCE) {
            refreshTriggered.value = true
            pullProgress.value = withTiming(1, { duration: 90 })
            scheduleOnRN(handleRefresh)
          }
        })
        .onEnd(() => {
          if (!refreshTriggered.value) {
            pullProgress.value = withTiming(0, { duration: 180 })
          }
        })
        .onFinalize(() => {
          if (!refreshTriggered.value && !isManualRefreshing) {
            pullProgress.value = withTiming(0, { duration: 180 })
          }
        }),
    [
      activeIndex,
      handleRefresh,
      isManualRefreshing,
      isRefetchingPublicFeed,
      isTimelineInteracting,
      pullProgress,
      reels.length,
      refreshTriggered,
      shouldAllowRefresh,
    ],
  )

  const offlineBoundaryGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(
          isAtOfflineBoundary &&
            !isTimelineInteracting &&
            !isManualRefreshing &&
            !isRefetchingPublicFeed,
        )
        .activeOffsetY([-22, 100000])
        .failOffsetX([-36, 36])
        .onBegin(() => {
          if (offlineBoundaryLoading.value === 0) {
            offlineBoundaryProgress.value = 0
          }
        })
        .onUpdate((event) => {
          if (offlineBoundaryLoading.value === 1) {
            return
          }

          const nextProgress = Math.max(
            0,
            Math.min(1, -event.translationY / OFFLINE_END_PULL_DISTANCE),
          )

          offlineBoundaryProgress.value = nextProgress
        })
        .onEnd(() => {
          if (offlineBoundaryLoading.value === 1) {
            return
          }

          if (offlineBoundaryProgress.value >= OFFLINE_END_TRIGGER_PROGRESS) {
            scheduleOnRN(triggerOfflineBoundaryFeedback)
            return
          }

          offlineBoundaryProgress.value = withTiming(0, {
            duration: 180,
            easing: Easing.out(Easing.cubic),
          })
        })
        .onFinalize(() => {
          if (offlineBoundaryLoading.value === 1) {
            return
          }

          if (offlineBoundaryProgress.value < OFFLINE_END_TRIGGER_PROGRESS) {
            offlineBoundaryProgress.value = withTiming(0, {
              duration: 180,
              easing: Easing.out(Easing.cubic),
            })
          }
        }),
    [
      isAtOfflineBoundary,
      isManualRefreshing,
      isRefetchingPublicFeed,
      isTimelineInteracting,
      offlineBoundaryLoading,
      offlineBoundaryProgress,
      triggerOfflineBoundaryFeedback,
    ],
  )

  const rootGesture = useMemo(
    () => Gesture.Simultaneous(pullToRefreshGesture, offlineBoundaryGesture),
    [offlineBoundaryGesture, pullToRefreshGesture],
  )

  const handleExitContext = useCallback(() => {
    setContextExtraItems([])
    setContextNextCursor(null)

    if (returnTo === 'profile') {
      router.dismissTo('/profile')
      return
    }

    if (returnTo === 'user-profile' && returnUsername) {
      router.dismissTo({
        pathname: '/users/[username]',
        params: { username: returnUsername },
      })
      return
    }

    if (returnTo === 'conversation' && returnConversationId) {
      router.dismissTo({
        pathname: '/conversation/[id]',
        params: { id: returnConversationId },
      })
      return
    }

    if (router.canGoBack()) {
      router.back()
      return
    }

    router.replace(returnTo === 'conversation' ? '/' : '/profile')
  }, [returnConversationId, returnTo, returnUsername, router])

  const handleReelDeleted = useCallback(
    (deletedReelId: string) => {
      const currentReels = reelsRef.current
      const currentActiveIndex = activeReelIdRef.current
        ? currentReels.findIndex((item) => item.id === activeReelIdRef.current)
        : -1

      setDeletedReelIds((current) => {
        const next = new Set(current)
        next.add(deletedReelId)
        return next
      })

      const deletedIndex = currentReels.findIndex((item) => item.id === deletedReelId)
      const fallbackIndex = deletedIndex >= 0 ? deletedIndex : currentActiveIndex
      const nextReel =
        currentReels[fallbackIndex + 1] ??
        currentReels[fallbackIndex - 1] ??
        currentReels.find((item) => item.id !== deletedReelId)

      if (!nextReel) {
        currentPageIndexRef.current = 0
        activeReelIdRef.current = null
        setActiveReelId(null)

        if (shouldUseReelContext) {
          handleExitContext()
        } else {
          void handleRefresh()
        }

        return
      }

      if (shouldUseReelContext && reelId === deletedReelId) {
        router.replace({
          pathname: '/reels/[id]',
          params: {
            id: nextReel.id,
            ...(routeEventSource ? { source: routeEventSource } : {}),
            ...(returnConversationId ? { conversationId: returnConversationId } : {}),
            ...(routeContextParam ? { contextReels: routeContextParam } : {}),
            ...(hideDescriptions ? { hideDescriptions: '1' } : {}),
            ...(returnTo ? { returnTo } : {}),
            ...(returnUsername ? { returnUsername } : {}),
          },
        })
      }

      const nextIndexBeforeDelete = currentReels.findIndex((item) => item.id === nextReel.id)
      const nextIndexAfterDelete =
        nextIndexBeforeDelete > fallbackIndex ? fallbackIndex : nextIndexBeforeDelete
      const safeNextIndex = Math.max(0, nextIndexAfterDelete)

      currentPageIndexRef.current = safeNextIndex
      activeReelIdRef.current = nextReel.id
      setActiveReelId(nextReel.id)

      requestAnimationFrame(() => {
        scrollToReelIndex(safeNextIndex)
      })

      if (shouldUseReelContext) {
        void refetchContext()
      } else {
        void handleRefresh()
      }
    },
    [
      handleExitContext,
      handleRefresh,
      hideDescriptions,
      reelId,
      refetchContext,
      routeContextParam,
      returnConversationId,
      returnTo,
      returnUsername,
      routeEventSource,
      router,
      scrollToReelIndex,
      shouldUseReelContext,
    ],
  )

  const renderReelPage = useCallback(
    (item: Reel, index: number) => {
      if (Math.abs(index - activeIndex) > PAGE_RENDER_RADIUS) {
        return (
          <View
            key={item.id}
            collapsable={false}
            style={{ width: '100%', height: viewportHeight, backgroundColor: '#050505' }}
          />
        )
      }

      const isCurrentItem = effectiveActiveReelId === item.id
      const isActiveItem = isFocused && isCurrentItem && !isManualRefreshing && !isSwitchingFeedTab
      const shouldWarmVideo =
        isCurrentItem ||
        (isFocused && activeIndex >= 0 && Math.abs(index - activeIndex) <= PRELOAD_RADIUS)
      const offlineVideoCachePriority = offlineVideoCachePriorities.get(item.id)

      return (
        <View
          key={item.id}
          collapsable={false}
          style={{
            width: '100%',
            height: viewportHeight,
          }}
        >
          <View style={{ height: videoViewportHeight }}>
            <ReelFeedItem
              reel={item}
              {...(!hideDescriptions && item.description ? { description: item.description } : {})}
              height={videoViewportHeight}
              isActive={isActiveItem}
              shouldWarmVideo={shouldWarmVideo}
              {...(typeof offlineVideoCachePriority === 'number'
                ? { offlineVideoCachePriority }
                : {})}
              enableStatusPolling={isActiveItem}
              hideCaption={hideDescriptions}
              isMuted={isMuted}
              clearDisplay={clearDisplay}
              liveTranscriptionEnabled={isActiveItem && liveTranscriptionEnabled}
              playbackSpeed={playbackSpeed}
              bottomContentInset={0}
              isSeriesPlayback={isSeriesPlayback}
              onOpenSeriesEpisodes={onOpenSeriesEpisodes}
              seriesEpisodeCount={seriesEpisodeCount}
              onToggleMuted={handleToggleMuted}
              onClearDisplay={handleClearDisplay}
              onRestoreDisplay={handleRestoreDisplay}
              onLiveTranscriptionChange={setLiveTranscriptionEnabled}
              onPlaybackSpeedChange={setPlaybackSpeed}
              onDeleted={handleReelDeleted}
              onIntentionalPauseChange={handleIntentionalPauseChange}
              onPlaybackProgress={handlePlaybackProgress}
              onTimelineInteractionChange={handleTimelineInteractionChange}
              onPlayerChange={handlePlayerChange}
            />
          </View>

          {!clearDisplay &&
          shouldShowRecommendationDebugOverlay &&
          isActiveItem &&
          item.recommendation ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: insets.top + 76,
                right: 16,
                maxWidth: '72%',
                borderRadius: 12,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                paddingHorizontal: 10,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '600' }}>
                {item.recommendation.candidateSource} · rank {item.recommendation.rank}
              </Text>
              <Text style={{ color: '#D1D5DB', fontSize: 10, marginTop: 2 }}>
                sources: {item.recommendation.candidateSources?.join(', ') ?? '—'}
              </Text>
              <Text style={{ color: '#D1D5DB', fontSize: 10, marginTop: 2 }}>
                v{recommendedAlgorithmVersion ?? item.recommendation.algorithmVersion}
              </Text>
              <Text style={{ color: '#D1D5DB', fontSize: 10, marginTop: 2 }}>
                session:{' '}
                {(recommendedFeedSessionId ?? item.recommendation.feedSessionId).slice(0, 8)}
              </Text>
              <Text style={{ color: '#D1D5DB', fontSize: 10, marginTop: 2 }}>
                recommendation: {item.recommendation.recommendationId.slice(0, 8)}
              </Text>
            </View>
          ) : null}
        </View>
      )
    },
    [
      activeIndex,
      effectiveActiveReelId,
      handleReelDeleted,
      handlePlayerChange,
      handlePlaybackProgress,
      handleTimelineInteractionChange,
      handleToggleMuted,
      handleClearDisplay,
      handleRestoreDisplay,
      hideDescriptions,
      isFocused,
      isManualRefreshing,
      isMuted,
      isSwitchingFeedTab,
      insets.top,
      clearDisplay,
      liveTranscriptionEnabled,
      offlineVideoCachePriorities,
      playbackSpeed,
      recommendedAlgorithmVersion,
      recommendedFeedSessionId,
      handleIntentionalPauseChange,
      setLiveTranscriptionEnabled,
      setPlaybackSpeed,
      isSeriesPlayback,
      onOpenSeriesEpisodes,
      seriesEpisodeCount,
      videoViewportHeight,
      viewportHeight,
    ],
  )

  if (isActiveError && reels.length === 0 && !shouldShowOfflineSkeleton && !shouldLoadPublicFeed) {
    return (
      <View className="flex-1 items-center justify-center bg-[#050505] px-6">
        <StatusBar style="light" hidden={clearDisplay} />

        <View
          className="w-full max-w-[340px] items-center rounded-[32px] border border-white/14 bg-black/52 px-6 py-7"
          style={{
            shadowColor: 'rgba(0, 0, 0, 0.28)',
            shadowOffset: { width: 0, height: 14 },
            shadowOpacity: 1,
            shadowRadius: 28,
            elevation: 5,
          }}
        >
          <View className="h-14 w-14 items-center justify-center rounded-[18px] border border-brand/30 bg-brand/14">
            <MaterialIcons name="error-outline" size={28} color="#FF935B" />
          </View>

          <Text className="mt-4 text-center font-heading text-xl text-white">Feed unavailable</Text>

          <Text className="mt-2 max-w-[280px] text-center text-base2 leading-6 text-white/70">
            {errorMessage}
          </Text>

          <TouchableOpacity
            accessibilityLabel="Try loading reels again"
            accessibilityRole="button"
            className="mt-6 h-11 min-w-[132px] items-center justify-center rounded-full bg-brand px-6"
            activeOpacity={0.85}
            onPress={() => {
              void handleRefresh()
            }}
          >
            <Text className="font-medium text-white">Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <GestureDetector gesture={rootGesture}>
      <View className="flex-1 bg-[#050505]" onLayout={handleLayout}>
        <StatusBar style="light" />

        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              overflow: 'hidden',
              zIndex: 0,
            },
            offlineBoundaryUnderlayStyle,
          ]}
        >
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.42)', 'rgba(255,107,44,0.12)']}
            locations={[0, 0.58, 1]}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          />

          <View className="absolute inset-x-0 top-0 h-px bg-white/8" />
          <ReelLoadingRail
            bottomOffset={Math.max(14, bottomContentInset + 12)}
            opacity={0.95}
            railHeight={3}
          />
        </Animated.View>

        <Animated.View style={[{ flex: 1, zIndex: 1 }, offlineBoundaryPagerStyle]}>
          {reels.length > 0 ? (
            <PagerView
              ref={pagerRef}
              style={{ flex: 1 }}
              initialPage={initialPagerPage}
              orientation="vertical"
              scrollEnabled={!isTimelineInteracting && !disablePagerSwipe}
              overScrollMode="never"
              overdrag={false}
              offscreenPageLimit={2}
              onPageScroll={handlePageScroll}
              onPageSelected={handlePageSelected}
              onPageScrollStateChanged={handlePageScrollStateChanged}
            >
              {pagerWindowReels.map((item, localIndex) =>
                renderReelPage(item, visiblePagerWindowStart + localIndex),
              )}
            </PagerView>
          ) : shouldShowOfflineSkeleton ? (
            <ReelOfflineSkeleton height={videoViewportHeight} bottomContentInset={0} />
          ) : (
            <View
              className="flex-1 bg-[#050505]"
              style={{ height: viewportHeight || windowHeight }}
            />
          )}
        </Animated.View>

        {!clearDisplay && activeIndex <= 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                top: insets.top + 82,
                alignItems: 'center',
                zIndex: 20,
                elevation: 20,
              },
              pullRefreshContainerStyle,
            ]}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.44)',
              }}
            >
              <Animated.View
                style={[
                  {
                    width: 28,
                    height: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  pullRefreshIconSpinStyle,
                ]}
              >
                <MaterialIcons name="refresh" size={24} color="#FFFFFF" />
              </Animated.View>
            </View>
          </Animated.View>
        ) : null}

        {reels.length === 0 &&
        !isShowingOfflineCache &&
        !shouldShowOfflineSkeleton &&
        isFeedPending &&
        !isActiveError ? (
          <View
            pointerEvents="none"
            className="absolute items-center justify-center px-6"
            style={{
              top: insets.top + (mode === 'public' ? 72 : 56),
              right: 0,
              bottom: Math.max(bottomContentInset + 32, insets.bottom + 32),
              left: 0,
              zIndex: 15,
              elevation: 15,
            }}
          >
            <View
              className="w-full max-w-[340px] items-center rounded-[32px] border border-white/14 bg-black/52 px-7 py-8"
              style={{
                shadowColor: 'rgba(0, 0, 0, 0.28)',
                shadowOffset: { width: 0, height: 14 },
                shadowOpacity: 1,
                shadowRadius: 28,
                elevation: 5,
              }}
            >
              <View className="h-14 w-14 items-center justify-center rounded-[18px] border border-white/16 bg-white/10">
                <ActivityIndicator color="#FF935B" size="small" />
              </View>
              <Text className="mt-4 text-center font-heading text-xl text-white">
                Loading reels
              </Text>
              <Text className="mt-2 max-w-[280px] text-center text-base2 leading-6 text-white/70">
                Finding something good to watch.
              </Text>
            </View>
          </View>
        ) : null}

        {reels.length === 0 &&
        !isShowingOfflineCache &&
        !shouldShowOfflineSkeleton &&
        !isFeedPending ? (
          <View
            pointerEvents="box-none"
            className="absolute items-center justify-center px-6"
            style={{
              top: insets.top + (mode === 'public' ? 72 : 56),
              right: 0,
              bottom: Math.max(bottomContentInset + 32, insets.bottom + 32),
              left: 0,
              alignItems: 'center',
              zIndex: 15,
              elevation: 15,
            }}
          >
            <View
              className="w-full max-w-[360px] items-center rounded-[32px] border border-white/14 bg-black/52 px-7 py-8"
              style={{
                shadowColor: 'rgba(0, 0, 0, 0.28)',
                shadowOffset: { width: 0, height: 14 },
                shadowOpacity: 1,
                shadowRadius: 28,
                elevation: 5,
                alignSelf: 'center',
              }}
            >
              {isActiveError ? (
                <>
                  <View className="h-14 w-14 items-center justify-center rounded-[18px] border border-brand/30 bg-brand/14">
                    <MaterialIcons name="error-outline" size={28} color="#FF935B" />
                  </View>
                  <Text className="mt-4 text-center font-heading text-xl text-white">
                    Feed unavailable
                  </Text>
                  <Text className="mt-2 max-w-[280px] text-center text-base2 leading-6 text-white/70">
                    {errorMessage}
                  </Text>
                  <TouchableOpacity
                    accessibilityLabel="Try loading reels again"
                    accessibilityRole="button"
                    className="mt-6 h-11 min-w-[132px] items-center justify-center rounded-full bg-brand px-6"
                    activeOpacity={0.84}
                    onPress={() => {
                      void handleRefresh()
                    }}
                  >
                    <Text className="font-medium text-white">Try again</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View className="h-14 w-14 items-center justify-center rounded-[18px] border border-brand/30 bg-brand/14">
                    <MaterialIcons
                      name={
                        selectedFeedTab === 'friends' ? 'people-outline' : 'play-circle-outline'
                      }
                      size={28}
                      color="#FF935B"
                    />
                  </View>

                  <View className="mt-5 w-full items-center">
                    <Text
                      adjustsFontSizeToFit
                      className="w-full text-center font-heading text-[28px] text-white"
                      minimumFontScale={0.8}
                      numberOfLines={1}
                      style={{
                        includeFontPadding: false,
                        lineHeight: emptyStateTitleLineHeight,
                      }}
                    >
                      {selectedFeedTab === 'friends' ? 'No reels from friends yet' : 'No reels yet'}
                    </Text>

                    <Text
                      className="max-w-[280px] text-center text-base2 leading-6 text-white/70"
                      style={{
                        includeFontPadding: false,
                        lineHeight: emptyStateDescriptionLineHeight,
                        marginTop: emptyStateTextSpacing,
                      }}
                    >
                      {selectedFeedTab === 'friends'
                        ? 'Your friends have not shared any reels yet. Their posts will appear here.'
                        : 'Your personalized feed is getting ready. Please try again.'}
                    </Text>
                  </View>

                  <TouchableOpacity
                    accessibilityLabel={
                      selectedFeedTab === 'friends' ? 'View friends' : 'Try loading reels again'
                    }
                    accessibilityRole="button"
                    className="mt-6 h-11 min-w-[132px] items-center justify-center rounded-full bg-brand px-6"
                    activeOpacity={0.84}
                    onPress={() => {
                      if (selectedFeedTab === 'friends') {
                        router.push('/friends')
                        return
                      }

                      void handleRefresh()
                    }}
                  >
                    <Text className="font-medium text-white">
                      {selectedFeedTab === 'friends' ? 'View friends' : 'Try again'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        ) : null}

        {!clearDisplay ? (
          <ReelOfflineAlert topOffset={insets.top + 18} visible={isOfflineAlertVisible} />
        ) : null}

        <View
          pointerEvents={clearDisplay ? 'none' : 'box-none'}
          className="absolute inset-x-0 top-0 z-30 px-5"
          style={{ paddingTop: insets.top, elevation: 30, opacity: clearDisplay ? 0 : 1 }}
        >
          {mode === 'context' ? (
            <View className="flex-row items-center justify-between">
              <TouchableOpacity
                accessibilityLabel="Go back"
                accessibilityRole="button"
                className="h-11 w-11 items-center justify-center rounded-full"
                activeOpacity={0.72}
                onPress={handleExitContext}
              >
                <MaterialIcons name="arrow-back" size={26} color="#FFFFFF" />
              </TouchableOpacity>
              {headerTitle ? (
                <View className="flex-1 items-center px-2">
                  <Text
                    className="font-heading text-[17px] font-bold text-white"
                    style={{
                      textShadowColor: 'rgba(0, 0, 0, 0.65)',
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: 3,
                    }}
                    numberOfLines={1}
                  >
                    {headerTitle}
                  </Text>
                </View>
              ) : (
                <View className="flex-1" />
              )}
              {headerRight ? headerRight : <View className="h-11 w-11" />}
            </View>
          ) : (
            <View className="h-12 flex-row items-center justify-end">
              {!isOfflineAlertVisible ? (
                <>
                  <View className="absolute inset-x-0 items-center" pointerEvents="box-none">
                    {shouldShowFriendsTab ? (
                      <View className="flex-row items-center gap-7">
                        {(['for-you', 'friends'] as const).map((tab) => {
                          const isSelected = selectedFeedTab === tab

                          return (
                            <TouchableOpacity
                              key={tab}
                              accessibilityLabel={`${tab === 'for-you' ? 'For You' : 'Friends'} reel feed`}
                              accessibilityRole="tab"
                              accessibilityState={{ selected: isSelected }}
                              className="h-11 min-w-[62px] items-center justify-center px-1"
                              activeOpacity={0.78}
                              disabled={isManualRefreshing || isSwitchingFeedTab}
                              onPress={() => {
                                if (isSelected) {
                                  void handleRefresh()
                                  return
                                }

                                void handleFeedTabChange(tab)
                              }}
                            >
                              <Text
                                className={`text-md ${
                                  isSelected
                                    ? 'font-bold text-white'
                                    : 'font-semibold text-white/85'
                                }`}
                                style={{
                                  textShadowColor: 'rgba(0, 0, 0, 0.82)',
                                  textShadowOffset: { width: 0, height: 1 },
                                  textShadowRadius: 4,
                                }}
                              >
                                {tab === 'for-you' ? 'For You' : 'Friends'}
                              </Text>
                              <View
                                className={`absolute bottom-0 h-[2px] rounded-full ${
                                  isSelected ? 'w-6 bg-brand' : 'w-0 bg-transparent'
                                }`}
                              />
                            </TouchableOpacity>
                          )
                        })}
                      </View>
                    ) : (
                      <View className="h-11 min-w-[62px] items-center justify-center px-1">
                        <Text
                          className="font-bold text-md text-white"
                          style={{
                            textShadowColor: 'rgba(0, 0, 0, 0.82)',
                            textShadowOffset: { width: 0, height: 1 },
                            textShadowRadius: 4,
                          }}
                        >
                          For You
                        </Text>
                        <View className="absolute bottom-0 h-[2px] w-6 rounded-full bg-brand" />
                      </View>
                    )}
                  </View>
                  <TouchableOpacity
                    accessibilityLabel="Create reel"
                    accessibilityRole="button"
                    className="h-11 w-11 items-center justify-center"
                    activeOpacity={0.72}
                    onPress={() => {
                      router.push('/reels/create')
                    }}
                  >
                    <Ionicons name="add" size={28} color="#FFFFFF" />
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </GestureDetector>
  )
}
