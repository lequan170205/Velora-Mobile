import { MaterialIcons } from '@expo/vector-icons'
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs'
import { useIsFocused } from '@react-navigation/native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ReelFeedItem } from '../../src/components/reels/ReelFeedItem'
import { DEFAULT_REELS_LIMIT } from '../../src/constants/reels'
import { useReelDetail, useReelsFeed } from '../../src/hooks/useReels'

import type { Reel } from '../../src/types/reel.types'
import type {
  LayoutChangeEvent,
  ListRenderItem,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native'

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

export default function ReelsScreen() {
  const router = useRouter()
  const { reelId } = useLocalSearchParams<{ reelId?: string | string[] }>()
  const insets = useSafeAreaInsets()
  const tabBarHeight = useBottomTabBarHeight()
  const isFocused = useIsFocused()
  const { height: windowHeight } = useWindowDimensions()
  const listRef = useRef<FlatList<Reel> | null>(null)
  const handledRequestedReelIdRef = useRef<string | null>(null)
  const [viewportHeight, setViewportHeight] = useState(windowHeight)
  const [activeReelId, setActiveReelId] = useState<string | null>(null)
  const activeReelIdRef = useRef<string | null>(null)
  const [deletedReelIds, setDeletedReelIds] = useState<Set<string>>(() => new Set())
  const [isMuted, setIsMuted] = useState(false)
  const [isTimelineInteracting, setIsTimelineInteracting] = useState(false)
  const selectedReelId = Array.isArray(reelId) ? reelId[0] : reelId
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
  } = useReelsFeed({ limit: DEFAULT_REELS_LIMIT, visibility: 'public' })
  const { data: selectedReel } = useReelDetail(selectedReelId, {
    enabled: Boolean(selectedReelId),
  })

  const reels = useMemo(() => {
    const feedItems =
      data?.pages.flatMap((page) => page.items).filter((item) => !deletedReelIds.has(item.id)) ?? []

    if (!selectedReel || deletedReelIds.has(selectedReel.id)) {
      return feedItems
    }

    return feedItems.some((item) => item.id === selectedReel.id)
      ? feedItems
      : [selectedReel, ...feedItems]
  }, [data, deletedReelIds, selectedReel])
  const activeIndex = useMemo(
    () => reels.findIndex((reel) => reel.id === activeReelId),
    [activeReelId, reels],
  )

  useEffect(() => {
    if (!selectedReelId) {
      handledRequestedReelIdRef.current = null
    }
  }, [selectedReelId])

  useEffect(() => {
    if (activeReelId || reels.length === 0 || selectedReelId) {
      return
    }

    const firstReelId = reels[0]?.id ?? null
    activeReelIdRef.current = firstReelId
    setActiveReelId(firstReelId)
  }, [activeReelId, reels, selectedReelId])

  useEffect(() => {
    if (!selectedReelId || handledRequestedReelIdRef.current === selectedReelId) {
      return
    }

    const targetIndex = reels.findIndex((item) => item.id === selectedReelId)

    if (targetIndex === -1) {
      return
    }

    handledRequestedReelIdRef.current = selectedReelId
    activeReelIdRef.current = selectedReelId
    setActiveReelId(selectedReelId)

    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: targetIndex,
        animated: false,
      })
    })
  }, [reels, selectedReelId, viewportHeight])

  const errorMessage =
    (error as (Error & { response?: { data?: { message?: string } } }) | null)?.response?.data
      ?.message ||
    (error as Error | null)?.message ||
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

  const handleRefresh = useCallback(() => {
    void refetch()
  }, [refetch])

  const handleReelDeleted = useCallback(
    (deletedReelId: string) => {
      setDeletedReelIds((current) => {
        const next = new Set(current)
        next.add(deletedReelId)
        return next
      })

      const deletedIndex = reels.findIndex((item) => item.id === deletedReelId)
      const fallbackIndex = deletedIndex >= 0 ? deletedIndex : activeIndex
      const nextReel =
        reels[fallbackIndex + 1] ??
        reels[fallbackIndex - 1] ??
        reels.find((item) => item.id !== deletedReelId)

      if (selectedReelId === deletedReelId) {
        router.replace('/reels')
      }

      if (!nextReel) {
        activeReelIdRef.current = null
        setActiveReelId(null)
        void refetch()
        return
      }

      const nextIndexBeforeDelete = reels.findIndex((item) => item.id === nextReel.id)
      const nextIndexAfterDelete =
        nextIndexBeforeDelete > fallbackIndex ? fallbackIndex : nextIndexBeforeDelete

      activeReelIdRef.current = nextReel.id
      setActiveReelId(nextReel.id)

      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({
          index: Math.max(0, nextIndexAfterDelete),
          animated: false,
        })
      })

      void refetch()
    },
    [activeIndex, reels, refetch, router, selectedReelId],
  )

  const keyExtractor = useCallback((item: Reel) => item.id, [])

  const getItemLayout = useCallback(
    (_: ArrayLike<Reel> | null | undefined, index: number) => ({
      length: viewportHeight,
      offset: viewportHeight * index,
      index,
    }),
    [viewportHeight],
  )

  const renderItem = useCallback<ListRenderItem<Reel>>(
    ({ item, index }) => {
      const isActiveItem = isFocused && activeReelId === item.id
      const shouldWarmVideo =
        isFocused && (isActiveItem || (activeIndex >= 0 && Math.abs(index - activeIndex) <= 1))

      return (
        <ReelFeedItem
          reel={item}
          description={item.description}
          height={viewportHeight}
          isActive={isActiveItem}
          shouldWarmVideo={shouldWarmVideo}
          enableStatusPolling={isActiveItem}
          isMuted={isMuted}
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
      viewportHeight,
    ],
  )

  if (isPending && !selectedReel) {
    return <ReelsLoadingSkeleton headerTop={insets.top + 18} viewportHeight={viewportHeight} />
  }

  if (isError && reels.length === 0) {
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
              void refetch()
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

      <FlatList
        ref={listRef}
        data={reels}
        extraData={`${activeReelId ?? ''}:${isMuted ? '1' : '0'}`}
        contentContainerStyle={reels.length === 0 ? { flexGrow: 1 } : undefined}
        pagingEnabled
        alwaysBounceVertical
        bounces={activeIndex <= 0 || isRefetching}
        disableIntervalMomentum
        overScrollMode={activeIndex <= 0 || isRefetching ? 'auto' : 'never'}
        removeClippedSubviews={false}
        scrollEnabled={!isTimelineInteracting}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        showsVerticalScrollIndicator={false}
        snapToInterval={viewportHeight}
        snapToAlignment="start"
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={16}
        windowSize={3}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onEndReachedThreshold={0.45}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            void fetchNextPage()
          }
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            colors={['#FF7A45']}
            tintColor="#FF7A45"
            progressViewOffset={insets.top + 96}
          />
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
      </View>

      {isFetchingNextPage ? (
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
