import { MaterialIcons } from '@expo/vector-icons'
import { useIsFocused } from '@react-navigation/native'
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { reelsApi } from '../../api/reels.api'
import { DEFAULT_REELS_LIMIT } from '../../constants/reels'
import { useReelContext, useReelsFeed } from '../../hooks/useReels'

import { ReelFeedItem } from './ReelFeedItem'

import type { Reel, ReelContextSource } from '../../types/reel.types'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

type ReelsViewerMode = 'public' | 'context'

interface ReelsViewerProps {
  bottomContentInset?: number
  contextSource?: ReelContextSource
  mode: ReelsViewerMode
  reelId?: string | undefined
  returnTo?: string | undefined
  returnUsername?: string | undefined
  tabBarHeight?: number
}

function ReelsLoadingSkeleton({
  headerTop,
  viewportHeight,
}: {
  headerTop: number
  viewportHeight: number
}) {
  return (
    <View className="flex-1 bg-[#050505]">
      <StatusBar style="light" />

      <View
        pointerEvents="none"
        className="absolute inset-x-0 top-0 z-10 px-5"
        style={{ paddingTop: headerTop }}
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xs2 uppercase tracking-[1.4px] text-white">Velora</Text>
            <Text className="mt-2 font-heading text-[30px] text-white">Reels</Text>
          </View>

          <View className="h-14 w-14 items-center justify-center">
            <MaterialIcons name="add" size={30} color="rgba(255,255,255,0.34)" />
          </View>
        </View>
      </View>

      <View className="flex-1 bg-[#090909]" style={{ height: viewportHeight }}>
        <View className="absolute inset-0 bg-white/[0.02]" />

        <View pointerEvents="none" className="absolute right-4" style={{ bottom: 128 }}>
          <View className="items-center">
            <View className="mb-4 h-12 w-12 rounded-full bg-white/18" />
            <View className="mb-4 h-11 w-11 rounded-full bg-white/16" />
          </View>
        </View>

        <View pointerEvents="none" className="absolute inset-x-0 px-4" style={{ bottom: 56 }}>
          <View className="max-w-[78%]">
            <View className="h-4 w-36 rounded-full bg-white/18" />
            <View className="mt-2 h-3 w-28 rounded-full bg-white/12" />
            <View className="mt-4 h-4 w-full rounded-full bg-white/12" />
            <View className="mt-2 h-4 w-[84%] rounded-full bg-white/10" />
            <View className="mt-3 h-4 w-32 rounded-full bg-white/12" />
          </View>
        </View>

        <View pointerEvents="none" className="absolute inset-x-0 bottom-0 h-[2px] bg-white/18" />
      </View>
    </View>
  )
}

export function ReelsViewer({
  bottomContentInset = 0,
  contextSource = 'profile',
  mode,
  reelId,
  returnTo,
  returnUsername,
  tabBarHeight = 0,
}: ReelsViewerProps) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const isFocused = useIsFocused()
  const { height: windowHeight } = useWindowDimensions()
  const listRef = useRef<FlashListRef<Reel> | null>(null)
  const handledRequestedReelIdRef = useRef<string | null>(null)
  const scrollOffsetYRef = useRef(0)
  const [viewportHeight, setViewportHeight] = useState(windowHeight)
  const [activeReelId, setActiveReelId] = useState<string | null>(null)
  const activeReelIdRef = useRef<string | null>(null)
  const [deletedReelIds, setDeletedReelIds] = useState<Set<string>>(() => new Set())
  const [isMuted, setIsMuted] = useState(false)
  const [isTimelineInteracting, setIsTimelineInteracting] = useState(false)
  const [contextExtraItems, setContextExtraItems] = useState<Reel[]>([])
  const [contextNextCursor, setContextNextCursor] = useState<string | null>(null)
  const [isFetchingContextNextPage, setIsFetchingContextNextPage] = useState(false)
  const reelsRef = useRef<Reel[]>([])
  const activeIndexRef = useRef(-1)
  const previousSelectedReelIdRef = useRef<string | undefined>(reelId)
  const shouldUseReelContext = mode === 'context' && Boolean(reelId)
  const shouldLoadPublicFeed = !shouldUseReelContext
  const shouldAllowRefresh = mode === 'public'
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
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isRefetching,
  } = useReelsFeed(
    { limit: DEFAULT_REELS_LIMIT, visibility: 'public' },
    { enabled: shouldLoadPublicFeed },
  )
  const {
    data: reelContext,
    isPending: isContextPending,
    isError: isContextError,
    error: contextError,
    refetch: refetchContext,
    isRefetching: isContextRefetching,
  } = useReelContext(
    reelId,
    {
      source: contextSource,
      before: Math.max(1, DEFAULT_REELS_LIMIT - 1),
      after: Math.max(1, DEFAULT_REELS_LIMIT - 1),
    },
    {
      enabled: shouldUseReelContext,
    },
  )

  const reels = useMemo(() => {
    if (shouldUseReelContext) {
      const contextItems = reelContext?.items ?? []
      const seenIds = new Set(contextItems.map((item) => item.id))
      const appendedItems = contextExtraItems.filter((item) => {
        if (seenIds.has(item.id)) {
          return false
        }

        seenIds.add(item.id)
        return true
      })

      return [...contextItems, ...appendedItems].filter((item) => !deletedReelIds.has(item.id))
    }

    return (
      data?.pages.flatMap((page) => page.items).filter((item) => !deletedReelIds.has(item.id)) ?? []
    )
  }, [contextExtraItems, data, deletedReelIds, reelContext, shouldUseReelContext])
  const reelContextSelectedId = reelContext?.selectedId
  const reelContextInitialNextCursor = reelContext?.nextCursor ?? null
  const requestedReelIndex = useMemo(() => {
    if (!shouldUseReelContext || !reelId) {
      return -1
    }

    return reels.findIndex((item) => item.id === reelId)
  }, [reels, reelId, shouldUseReelContext])
  const activeIndex = useMemo(
    () => reels.findIndex((reel) => reel.id === activeReelId),
    [activeReelId, reels],
  )
  const initialScrollIndex =
    shouldUseReelContext && requestedReelIndex > 0 ? requestedReelIndex : undefined

  useEffect(() => {
    reelsRef.current = reels
  }, [reels])

  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  useEffect(() => {
    const previousSelectedReelId = previousSelectedReelIdRef.current

    if (reelId && previousSelectedReelId !== reelId) {
      setContextExtraItems([])
      setContextNextCursor(null)
      handledRequestedReelIdRef.current = null
      scrollOffsetYRef.current = 0
      activeReelIdRef.current = reelId
      setActiveReelId(reelId)

      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false })
      })
    }

    previousSelectedReelIdRef.current = reelId
  }, [reelId])

  useEffect(() => {
    if (!shouldUseReelContext) {
      setContextExtraItems([])
      setContextNextCursor(null)
      return
    }

    if (!reelContextSelectedId) {
      return
    }

    setContextExtraItems([])
    setContextNextCursor(reelContextInitialNextCursor)
  }, [reelContextInitialNextCursor, reelContextSelectedId, shouldUseReelContext])

  useEffect(() => {
    if (!reelId) {
      handledRequestedReelIdRef.current = null
    }
  }, [reelId])

  useEffect(() => {
    if (activeReelId || reels.length === 0 || shouldUseReelContext) {
      return
    }

    const firstReelId = reels[0]?.id ?? null
    activeReelIdRef.current = firstReelId
    setActiveReelId(firstReelId)
  }, [activeReelId, reels, shouldUseReelContext])

  useEffect(() => {
    if (!shouldUseReelContext || !reelId || handledRequestedReelIdRef.current === reelId) {
      return
    }

    if (requestedReelIndex === -1) {
      return
    }

    handledRequestedReelIdRef.current = reelId
    activeReelIdRef.current = reelId
    setActiveReelId(reelId)

    requestAnimationFrame(() => {
      const scrollPromise = listRef.current?.scrollToIndex({
        index: requestedReelIndex,
        animated: false,
      })
      void scrollPromise?.catch(() => undefined)
    })
  }, [reelId, requestedReelIndex, shouldUseReelContext])

  const activeError = shouldUseReelContext ? contextError : error
  const errorMessage =
    (activeError as (Error & { response?: { data?: { message?: string } } }) | null)?.response?.data
      ?.message ||
    (activeError as Error | null)?.message ||
    'Could not load reels right now.'

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height
    if (nextHeight > 0 && nextHeight !== viewportHeight) {
      if (activeIndex >= 0) {
        listRef.current?.scrollToOffset({
          offset: activeIndex * nextHeight,
          animated: false,
        })
      }
      setViewportHeight(nextHeight)
    }
  }

  const setActiveByOffset = useCallback(
    (offsetY: number) => {
      scrollOffsetYRef.current = offsetY

      if (reels.length === 0 || viewportHeight <= 0) {
        if (activeReelIdRef.current !== null) {
          activeReelIdRef.current = null
          setActiveReelId(null)
        }
        return
      }

      const nextIndex = Math.max(
        0,
        Math.min(reels.length - 1, Math.round(offsetY / viewportHeight)),
      )
      const nextReelId = reels[nextIndex]?.id ?? null

      if (activeReelIdRef.current === nextReelId) {
        return
      }

      activeReelIdRef.current = nextReelId
      setActiveReelId(nextReelId)
    },
    [reels, viewportHeight],
  )

  useEffect(() => {
    if (!activeReelId || reels.length === 0 || reels.some((item) => item.id === activeReelId)) {
      return
    }

    setActiveByOffset(scrollOffsetYRef.current)
  }, [activeReelId, reels, setActiveByOffset])

  useEffect(() => {
    if (!isFocused || reels.length === 0 || viewportHeight <= 0) {
      return
    }

    const currentIndex = activeIndexRef.current
    const activeReelIndex = activeReelIdRef.current
      ? reels.findIndex((item) => item.id === activeReelIdRef.current)
      : -1
    const offsetIndex = Math.round(scrollOffsetYRef.current / viewportHeight)
    const nextIndex = Math.max(
      0,
      Math.min(
        reels.length - 1,
        activeReelIndex >= 0 ? activeReelIndex : currentIndex >= 0 ? currentIndex : offsetIndex,
      ),
    )
    const nextReelId = reels[nextIndex]?.id ?? null

    requestAnimationFrame(() => {
      scrollOffsetYRef.current = nextIndex * viewportHeight
      activeReelIdRef.current = nextReelId
      setActiveReelId(nextReelId)
      listRef.current?.scrollToOffset({
        offset: nextIndex * viewportHeight,
        animated: false,
      })
    })
  }, [isFocused, reels, viewportHeight])

  const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setActiveByOffset(event.nativeEvent.contentOffset.y)
  }

  const handleScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const velocityY = event.nativeEvent.velocity?.y ?? 0

    if (Math.abs(velocityY) < 0.05) {
      setActiveByOffset(event.nativeEvent.contentOffset.y)
    }
  }

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setActiveByOffset(event.nativeEvent.contentOffset.y)
    },
    [setActiveByOffset],
  )

  const fetchNextContextPage = useCallback(async () => {
    if (
      !shouldUseReelContext ||
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
      // Keep the cursor so the next onEndReached can retry the same scoped page.
    } finally {
      setIsFetchingContextNextPage(false)
    }
  }, [contextNextCursor, isFetchingContextNextPage, reelContext, shouldUseReelContext])

  const handleRefresh = useCallback(() => {
    if (!shouldAllowRefresh) {
      return
    }

    setContextExtraItems([])
    setContextNextCursor(null)
    handledRequestedReelIdRef.current = null
    activeReelIdRef.current = null
    setActiveReelId(null)

    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
    })

    void refetch()
  }, [refetch, shouldAllowRefresh])

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

    if (router.canGoBack()) {
      router.back()
      return
    }

    router.replace('/profile')
  }, [returnTo, returnUsername, router])

  const handleReelDeleted = useCallback(
    (deletedReelId: string) => {
      const currentReels = reelsRef.current
      const currentActiveIndex = activeIndexRef.current

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
        activeReelIdRef.current = null
        setActiveReelId(null)
        if (shouldUseReelContext) {
          handleExitContext()
        } else {
          void refetch()
        }
        return
      }

      if (shouldUseReelContext && reelId === deletedReelId) {
        router.replace({
          pathname: '/reels/[id]',
          params: {
            id: nextReel.id,
            source: contextSource,
            ...(returnTo ? { returnTo } : {}),
            ...(returnUsername ? { returnUsername } : {}),
          },
        })
      }

      const nextIndexBeforeDelete = currentReels.findIndex((item) => item.id === nextReel.id)
      const nextIndexAfterDelete =
        nextIndexBeforeDelete > fallbackIndex ? fallbackIndex : nextIndexBeforeDelete

      activeReelIdRef.current = nextReel.id
      setActiveReelId(nextReel.id)

      requestAnimationFrame(() => {
        const scrollPromise = listRef.current?.scrollToIndex({
          index: Math.max(0, nextIndexAfterDelete),
          animated: false,
        })
        void scrollPromise?.catch(() => undefined)
      })

      if (shouldUseReelContext) {
        void refetchContext()
      } else {
        void refetch()
      }
    },
    [
      contextSource,
      handleExitContext,
      reelId,
      refetch,
      refetchContext,
      returnTo,
      returnUsername,
      router,
      shouldUseReelContext,
    ],
  )

  const keyExtractor = useCallback((item: Reel) => item.id, [])
  const getItemType = useCallback(() => 'reel', [])

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Reel>) => {
      const isCurrentItem = activeReelId === item.id
      const isActiveItem = isFocused && isCurrentItem
      const shouldWarmVideo =
        isCurrentItem || (isFocused && activeIndex >= 0 && Math.abs(index - activeIndex) <= 1)

      return (
        <ReelFeedItem
          reel={item}
          description={item.description}
          height={viewportHeight}
          isActive={isActiveItem}
          shouldWarmVideo={shouldWarmVideo}
          enableStatusPolling={isActiveItem}
          isMuted={isMuted}
          bottomContentInset={bottomContentInset}
          onToggleMuted={handleToggleMuted}
          onDeleted={handleReelDeleted}
          onTimelineInteractionChange={handleTimelineInteractionChange}
        />
      )
    },
    [
      activeReelId,
      activeIndex,
      handleTimelineInteractionChange,
      handleToggleMuted,
      handleReelDeleted,
      isFocused,
      isMuted,
      bottomContentInset,
      viewportHeight,
    ],
  )

  const isInitialLoading = shouldUseReelContext ? isContextPending : isPending
  const isActiveError = shouldUseReelContext ? isContextError : isError
  const isActiveRefetching = shouldUseReelContext
    ? isContextRefetching || isRefetching
    : isRefetching
  const refetchActiveFeed = shouldUseReelContext ? refetchContext : refetch

  if (isInitialLoading && reels.length === 0) {
    return <ReelsLoadingSkeleton headerTop={insets.top + 18} viewportHeight={viewportHeight} />
  }

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
              void refetchActiveFeed()
            }}
          >
            <Text className="font-medium text-white">Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-[#050505]" onLayout={handleLayout}>
      <StatusBar style="light" />

      <FlashList
        ref={listRef}
        data={reels}
        extraData={`${activeReelId ?? ''}:${isMuted ? '1' : '0'}:${isFocused ? '1' : '0'}`}
        contentContainerStyle={reels.length === 0 ? { flexGrow: 1 } : undefined}
        initialScrollIndex={initialScrollIndex}
        pagingEnabled
        alwaysBounceVertical={shouldAllowRefresh}
        bounces={shouldAllowRefresh && (activeIndex <= 0 || isActiveRefetching)}
        disableIntervalMomentum
        overScrollMode={
          shouldAllowRefresh && (activeIndex <= 0 || isActiveRefetching) ? 'auto' : 'never'
        }
        removeClippedSubviews={false}
        scrollEnabled={!isTimelineInteracting}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        snapToInterval={viewportHeight}
        snapToAlignment="start"
        drawDistance={viewportHeight * 2}
        maxItemsInRecyclePool={4}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onEndReachedThreshold={0.45}
        onEndReached={() => {
          if (shouldLoadPublicFeed && hasNextPage && !isFetchingNextPage) {
            void fetchNextPage()
            return
          }

          if (shouldUseReelContext && contextNextCursor && !isFetchingContextNextPage) {
            void fetchNextContextPage()
          }
        }}
        refreshControl={
          shouldAllowRefresh ? (
            <RefreshControl
              refreshing={isActiveRefetching}
              onRefresh={handleRefresh}
              colors={['#FF7A45']}
              tintColor="#FF7A45"
              progressViewOffset={insets.top + 96}
            />
          ) : undefined
        }
        ListEmptyComponent={
          <View
            className="items-center justify-center px-6"
            style={{ height: viewportHeight || windowHeight }}
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
        }
      />

      <View
        pointerEvents="box-none"
        className="absolute inset-x-0 top-0 z-10 px-5"
        style={{ paddingTop: insets.top + 18 }}
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

      {isFetchingNextPage || isFetchingContextNextPage ? (
        <View
          pointerEvents="none"
          className="absolute inset-x-0 items-center"
          style={{ bottom: tabBarHeight + 18 }}
        >
          <View className="rounded-full bg-black/44 px-4 py-2">
            <ActivityIndicator color="#FF7A45" size="small" />
          </View>
        </View>
      ) : null}
    </View>
  )
}
