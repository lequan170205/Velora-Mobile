import { MaterialIcons } from '@expo/vector-icons'
import { useIsFocused } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'
import { Image as ExpoImage } from 'expo-image'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Text, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import PagerView from 'react-native-pager-view'
import Animated, {
  Extrapolation,
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useIsOnline } from '@/hooks/useIsOnline'
import { useReelAnalyticsTracker } from '@/hooks/useReelAnalyticsTracker'
import { prefetchReelForOfflinePlayback } from '@/lib/reel-prefetch'
import type { InfiniteData } from '@tanstack/react-query'

import { reelsApi } from '../../api/reels.api'
import { queryKeys } from '../../constants/queryKeys'
import { DEFAULT_REELS_LIMIT } from '../../constants/reels'
import { useReelContext, useReelsFeed } from '../../hooks/useReels'

import { ReelFeedItem } from './ReelFeedItem'

import type { ListReelsResponse, Reel, ReelContextSource } from '../../types/reel.types'
import type { LayoutChangeEvent, NativeSyntheticEvent } from 'react-native'

type ReelsViewerMode = 'public' | 'context'

type PagerSelectedEvent = NativeSyntheticEvent<{
  position: number
}>

type PagerViewRef = React.ElementRef<typeof PagerView>

const PRELOAD_RADIUS = 2
const PULL_TO_REFRESH_DISTANCE = 74

interface ReelsViewerProps {
  bottomContentInset?: number
  contextItems?: Reel[]
  contextSource?: ReelContextSource
  hideDescriptions?: boolean
  mode: ReelsViewerMode
  reelId?: string | undefined
  returnConversationId?: string | undefined
  returnTo?: string | undefined
  returnUsername?: string | undefined
  tabBarHeight?: number
}

const prefetchReelAssets = (reel?: Reel | null) => {
  if (!reel) {
    return
  }

  if (reel.thumbnailUrl) {
    void ExpoImage.prefetch(reel.thumbnailUrl).catch(() => undefined)
  }

  if (reel.streamUrl) {
    void fetch(reel.streamUrl, { method: 'GET' }).catch(() => undefined)
  }
}

export function ReelsViewer({
  bottomContentInset = 0,
  contextItems = [],
  contextSource = 'profile',
  hideDescriptions = false,
  mode,
  reelId,
  returnConversationId,
  returnTo,
  returnUsername,
}: ReelsViewerProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const insets = useSafeAreaInsets()
  const isFocused = useIsFocused()
  const { height: windowHeight } = useWindowDimensions()
  const isOnline = useIsOnline()
  const { startReelSession, endCurrentReelSession, updateActiveMutedState, flushReelEvents } =
    useReelAnalyticsTracker()

  const pagerRef = useRef<PagerViewRef | null>(null)
  const handledRequestedReelIdRef = useRef<string | null>(null)
  const currentPageIndexRef = useRef(0)
  const wasFocusedRef = useRef(isFocused)
  const activeReelIdRef = useRef<string | null>(null)
  const reelsRef = useRef<Reel[]>([])
  const previousSelectedReelIdRef = useRef<string | undefined>(reelId)

  const [viewportHeight, setViewportHeight] = useState(windowHeight)
  const [activeReelId, setActiveReelId] = useState<string | null>(null)
  const [deletedReelIds, setDeletedReelIds] = useState<Set<string>>(() => new Set())
  const [isMuted, setIsMuted] = useState(false)
  const [isTimelineInteracting, setIsTimelineInteracting] = useState(false)
  const [contextExtraItems, setContextExtraItems] = useState<Reel[]>([])
  const [contextNextCursor, setContextNextCursor] = useState<string | null>(null)
  const [isFetchingContextNextPage, setIsFetchingContextNextPage] = useState(false)
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)

  const pullProgress = useSharedValue(0)
  const refreshSpin = useSharedValue(0)
  const refreshTriggered = useSharedValue(false)

  const shouldUseReelContext = mode === 'context' && Boolean(reelId)
  const shouldUseLocalContext = shouldUseReelContext && contextItems.length > 0
  const shouldFetchReelContext = shouldUseReelContext && !shouldUseLocalContext
  const shouldLoadPublicFeed = !shouldUseReelContext
  const shouldAllowRefresh = mode === 'public'

  const publicReelsQueryKey = useMemo(
    () => queryKeys.reels.list({ limit: DEFAULT_REELS_LIMIT, visibility: 'public', ranked: true }),
    [],
  )

  const handleTimelineInteractionChange = useCallback((isInteracting: boolean) => {
    setIsTimelineInteracting(isInteracting)
  }, [])

  const handleToggleMuted = useCallback(() => {
    setIsMuted((current) => !current)
  }, [])

  const {
    data,
    isPending,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isRefetching,
  } = useReelsFeed(
    { limit: DEFAULT_REELS_LIMIT, visibility: 'public', ranked: true },
    { enabled: shouldLoadPublicFeed },
  )

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

  const reels = useMemo(() => {
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

    return (
      data?.pages.flatMap((page) => page.items).filter((item) => !deletedReelIds.has(item.id)) ?? []
    )
  }, [
    contextExtraItems,
    contextItems,
    data,
    deletedReelIds,
    reelContext,
    shouldUseLocalContext,
    shouldUseReelContext,
  ])

  const reelContextSelectedId = reelContext?.selectedId
  const reelContextInitialNextCursor = reelContext?.nextCursor ?? null

  const requestedReelIndex = useMemo(() => {
    if (!shouldUseReelContext || !reelId) {
      return -1
    }

    return reels.findIndex((item) => item.id === reelId)
  }, [reels, reelId, shouldUseReelContext])

  const initialPageIndex = shouldUseReelContext && requestedReelIndex > 0 ? requestedReelIndex : 0

  const safeInitialPageIndex = useMemo(() => {
    if (reels.length === 0) {
      return 0
    }

    return Math.max(0, Math.min(reels.length - 1, initialPageIndex))
  }, [initialPageIndex, reels.length])

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

  useEffect(() => {
    if (!isFocused || !effectiveActiveReelId) {
      endCurrentReelSession('screen_blur')
      return
    }

    startReelSession(effectiveActiveReelId, { muted: isMuted })

    return () => {
      endCurrentReelSession('switch')
    }
  }, [effectiveActiveReelId, endCurrentReelSession, isFocused, isMuted, startReelSession])

  useEffect(() => {
    updateActiveMutedState(isMuted)
  }, [isMuted, updateActiveMutedState])

  useEffect(() => {
    if (!isFocused || activeIndex < 0 || reels.length === 0) {
      return
    }

    void prefetchReelAssets(reels[activeIndex + 1])
    void prefetchReelAssets(reels[activeIndex + 2])

    if (isOnline) {
      void prefetchReelForOfflinePlayback(reels[activeIndex])
      void prefetchReelForOfflinePlayback(reels[activeIndex + 1])
      void prefetchReelForOfflinePlayback(reels[activeIndex + 2])
    }
  }, [activeIndex, isFocused, isOnline, reels])

  const isInitialLoading = shouldFetchReelContext ? isContextPending : isPending
  const isActiveError = shouldFetchReelContext ? isContextError : isError
  const isShowingOfflineCache =
    !shouldFetchReelContext && Boolean(data?.pages.some((page) => page.fromOfflineCache))

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

  useEffect(() => {
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

    if (reelId && previousSelectedReelId !== reelId) {
      setContextExtraItems([])
      setContextNextCursor(null)
      handledRequestedReelIdRef.current = null
      currentPageIndexRef.current = 0
      activeReelIdRef.current = reelId
      setActiveReelId(reelId)

      requestAnimationFrame(() => {
        pagerRef.current?.setPageWithoutAnimation(0)
      })
    }

    previousSelectedReelIdRef.current = reelId
  }, [reelId])

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

      if (reels.length === 0) {
        currentPageIndexRef.current = 0

        if (activeReelIdRef.current !== null) {
          activeReelIdRef.current = null
          setActiveReelId(null)
        }

        return
      }

      const safeIndex = Math.max(0, Math.min(reels.length - 1, index))
      const nextReelId = reels[safeIndex]?.id ?? null

      currentPageIndexRef.current = safeIndex

      if (activeReelIdRef.current === nextReelId) {
        return
      }

      activeReelIdRef.current = nextReelId
      setActiveReelId(nextReelId)
    },
    [isFocused, reels],
  )

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
    setActiveReelId(reelId)

    requestAnimationFrame(() => {
      pagerRef.current?.setPageWithoutAnimation(requestedReelIndex)
    })
  }, [reelId, requestedReelIndex, shouldUseReelContext])

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

  useLayoutEffect(() => {
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

    requestAnimationFrame(() => {
      pagerRef.current?.setPageWithoutAnimation(safeIndex)
    })
  }, [isFocused])

  const activeError = shouldFetchReelContext ? contextError : error
  const errorMessage =
    (activeError as (Error & { response?: { data?: { message?: string } } }) | null)?.response?.data
      ?.message ||
    (activeError as Error | null)?.message ||
    'Could not load reels right now.'

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height

    if (!isFocused || nextHeight <= 0 || nextHeight === viewportHeight) {
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
      const shouldPrefetch = index >= Math.max(0, reels.length - 2)

      if (!shouldPrefetch) {
        return
      }

      if (shouldLoadPublicFeed && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage()
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
      fetchNextPage,
      hasNextPage,
      isFetchingContextNextPage,
      isFetchingNextPage,
      reels.length,
      shouldLoadPublicFeed,
      shouldUseLocalContext,
      shouldUseReelContext,
    ],
  )

  const handlePageSelected = useCallback(
    (event: PagerSelectedEvent) => {
      const nextIndex = event.nativeEvent.position

      setActiveByIndex(nextIndex)
      maybeFetchNextPage(nextIndex)
    },
    [maybeFetchNextPage, setActiveByIndex],
  )

  const handleRefresh = useCallback(async () => {
    if (!shouldAllowRefresh || isManualRefreshing || isRefetching) {
      return
    }

    endCurrentReelSession('manual_refresh')
    void flushReelEvents()
    setIsManualRefreshing(true)

    try {
      setContextExtraItems([])
      setContextNextCursor(null)
      handledRequestedReelIdRef.current = null
      currentPageIndexRef.current = 0

      const freshPage = await reelsApi.list({
        limit: DEFAULT_REELS_LIMIT,
        visibility: 'public',
        ranked: true,
      })

      queryClient.setQueryData<InfiniteData<ListReelsResponse, string | undefined>>(
        publicReelsQueryKey,
        {
          pages: [freshPage],
          pageParams: [undefined],
        },
      )

      const nextFirstReel = freshPage.items.find((item) => !deletedReelIds.has(item.id)) ?? null

      if (nextFirstReel) {
        activeReelIdRef.current = nextFirstReel.id
        setActiveReelId(nextFirstReel.id)
      } else {
        activeReelIdRef.current = null
        setActiveReelId(null)
      }

      requestAnimationFrame(() => {
        pagerRef.current?.setPageWithoutAnimation(0)
      })
    } finally {
      setIsManualRefreshing(false)
    }
  }, [
    deletedReelIds,
    endCurrentReelSession,
    flushReelEvents,
    isManualRefreshing,
    isRefetching,
    publicReelsQueryKey,
    queryClient,
    shouldAllowRefresh,
  ])

  const pullToRefreshGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(
          shouldAllowRefresh &&
            isFocused &&
            reels.length > 0 &&
            activeIndex <= 0 &&
            !isTimelineInteracting &&
            !isManualRefreshing &&
            !isRefetching,
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
            runOnJS(handleRefresh)()
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
      isFocused,
      isManualRefreshing,
      isRefetching,
      isTimelineInteracting,
      pullProgress,
      reels.length,
      refreshTriggered,
      shouldAllowRefresh,
    ],
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
            source: contextSource,
            ...(returnConversationId ? { conversationId: returnConversationId } : {}),
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
        pagerRef.current?.setPageWithoutAnimation(safeNextIndex)
      })

      if (shouldUseReelContext) {
        void refetchContext()
      } else {
        void handleRefresh()
      }
    },
    [
      contextSource,
      handleExitContext,
      handleRefresh,
      hideDescriptions,
      reelId,
      refetchContext,
      returnConversationId,
      returnTo,
      returnUsername,
      router,
      shouldUseReelContext,
    ],
  )

  const renderPagerPage = useCallback(
    (item: Reel, index: number) => {
      const isCurrentItem = effectiveActiveReelId === item.id
      const isActiveItem = isFocused && isCurrentItem
      const shouldWarmVideo =
        isCurrentItem ||
        (isFocused && activeIndex >= 0 && Math.abs(index - activeIndex) <= PRELOAD_RADIUS)

      return (
        <View
          key={item.id}
          collapsable={false}
          style={{
            width: '100%',
            height: viewportHeight,
          }}
        >
          <ReelFeedItem
            reel={item}
            {...(!hideDescriptions && item.description ? { description: item.description } : {})}
            height={viewportHeight}
            isActive={isActiveItem}
            shouldWarmVideo={shouldWarmVideo}
            enableStatusPolling={isActiveItem}
            hideCaption={hideDescriptions}
            isMuted={isMuted}
            bottomContentInset={bottomContentInset}
            onToggleMuted={handleToggleMuted}
            onDeleted={handleReelDeleted}
            onTimelineInteractionChange={handleTimelineInteractionChange}
          />
        </View>
      )
    },
    [
      activeIndex,
      bottomContentInset,
      effectiveActiveReelId,
      handleReelDeleted,
      handleTimelineInteractionChange,
      handleToggleMuted,
      hideDescriptions,
      isFocused,
      isMuted,
      viewportHeight,
    ],
  )

  if (isActiveError && reels.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-[#050505] px-6">
        <StatusBar style="light" />

        <View
          className="items-center rounded-[32px] border border-white/12 bg-white/8 px-6 py-7"
          style={{
            shadowColor: 'rgba(0, 0, 0, 0.28)',
            shadowOffset: { width: 0, height: 14 },
            shadowOpacity: 1,
            shadowRadius: 28,
            elevation: 5,
          }}
        >
          <View className="h-14 w-14 items-center justify-center rounded-full bg-white/10">
            <MaterialIcons name="error-outline" size={28} color="#FFFFFF" />
          </View>

          <Text className="mt-4 text-center font-heading text-xl text-white">Feed unavailable</Text>

          <Text className="mt-2 text-center text-base2 text-white">{errorMessage}</Text>

          <TouchableOpacity
            className="mt-6 rounded-full bg-brand px-5 py-3"
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
    <GestureDetector gesture={pullToRefreshGesture}>
      <View className="flex-1 bg-[#050505]" onLayout={handleLayout}>
        <StatusBar style="light" />

        {reels.length > 0 ? (
          <PagerView
            ref={pagerRef}
            style={{ flex: 1 }}
            initialPage={safeInitialPageIndex}
            orientation="vertical"
            scrollEnabled={!isTimelineInteracting}
            overScrollMode="never"
            overdrag={false}
            offscreenPageLimit={2}
            onPageSelected={handlePageSelected}
          >
            {reels.map(renderPagerPage)}
          </PagerView>
        ) : (
          <View
            className="flex-1 bg-[#050505]"
            style={{ height: viewportHeight || windowHeight }}
          />
        )}

        {activeIndex <= 0 ? (
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

        {!isInitialLoading && reels.length === 0 && !isShowingOfflineCache ? (
          <View
            pointerEvents="box-none"
            className="absolute inset-0 items-center justify-center px-6"
          >
            <View
              className="items-center rounded-[36px] border border-white/12 bg-white/8 px-8 py-10"
              style={{
                shadowColor: 'rgba(0, 0, 0, 0.28)',
                shadowOffset: { width: 0, height: 14 },
                shadowOpacity: 1,
                shadowRadius: 28,
                elevation: 5,
              }}
            >
              <View className="h-16 w-16 items-center justify-center rounded-full bg-white/10">
                <MaterialIcons name="play-circle-outline" size={32} color="#FFFFFF" />
              </View>

              <Text className="mt-5 font-heading text-[28px] text-white">No reels yet</Text>

              <Text className="mt-3 max-w-[280px] text-center text-base2 leading-6 text-white">
                Upload the first reel and it will land here as soon as processing finishes.
              </Text>

              <TouchableOpacity
                className="mt-7 rounded-full bg-brand px-6 py-3.5"
                activeOpacity={0.84}
                onPress={() => {
                  router.push('/reels/create')
                }}
              >
                <Text className="font-medium text-white">Create reel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {!isOnline || isShowingOfflineCache ? (
          <View
            pointerEvents="none"
            className="absolute inset-x-0 z-20 items-center px-5"
            style={{ top: insets.top + 108, elevation: 20 }}
          >
            <View className="rounded-full bg-black/52 px-3 py-1.5">
              <Text className="text-xs2 font-medium text-white">
                {!isOnline ? 'Offline • showing saved reels' : 'Showing saved reels'}
              </Text>
            </View>
          </View>
        ) : null}

        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 top-0 z-30 px-5"
          style={{ paddingTop: insets.top + 18, elevation: 30 }}
        >
          {mode === 'context' ? (
            <TouchableOpacity
              className="h-12 w-12 items-center justify-center rounded-full bg-black/38"
              activeOpacity={0.72}
              onPress={handleExitContext}
            >
              <MaterialIcons name="arrow-back" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          ) : (
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-xs2 uppercase tracking-[1.4px] text-white">Velora</Text>
                <Text className="mt-2 font-heading text-[30px] text-white">Reels</Text>
              </View>

              <TouchableOpacity
                className="h-14 w-14 items-center justify-center"
                activeOpacity={0.72}
                onPress={() => {
                  router.push('/reels/create')
                }}
              >
                <MaterialIcons name="add" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </GestureDetector>
  )
}
