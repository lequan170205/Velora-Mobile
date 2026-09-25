import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetModal,
  type BottomSheetBackdropProps,
  type BottomSheetFlatListMethods,
} from '@gorhom/bottom-sheet'
import { isAxiosError } from 'axios'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  CustomTabBarSurface,
  getDockedTabBarHeight,
  PROFILE_TAB_INDEX,
  REELS_TAB_INDEX,
} from '../../../src/components/navigation/CustomTabBar'
import { ReelsViewer } from '../../../src/components/reels/ReelsViewer'
import { colors } from '../../../src/constants/theme'
import { useReelSeriesEpisodes } from '../../../src/hooks/useReels'
import { useAuthStore } from '../../../src/stores/authStore'

const firstParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value)
const EPISODE_ROW_HEIGHT = 94
const EPISODE_ITEM_HEIGHT = EPISODE_ROW_HEIGHT + 10
const EPISODE_PREFETCH_DISTANCE = EPISODE_ITEM_HEIGHT * 3
const EPISODE_NEXT_PREFETCH_THRESHOLD = 0.75
const ACTIVE_EPISODE_LEADING_ROWS = 2
const EPISODE_SHEET_SNAP_POINTS = ['55%', '85%']

const formatViews = (count?: number) => {
  if (!count || count <= 0) return '0'
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(count)
}

const EpisodeCardSkeleton = () => (
  <View style={styles.episodeRow} accessibilityLabel="Loading episodes">
    <View style={[styles.episodeThumbnail, styles.episodeSkeletonBlock]} />
    <View style={styles.episodeText}>
      <View style={[styles.episodeSkeletonLine, styles.episodeSkeletonLineWide]} />
      <View style={[styles.episodeSkeletonLine, styles.episodeSkeletonLineShort]} />
    </View>
  </View>
)

export default function ReelSeriesScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const tabBarHeight = getDockedTabBarHeight(insets.bottom)
  const params = useLocalSearchParams<{
    id?: string | string[]
    reelId?: string | string[]
  }>()
  const seriesId = firstParam(params.id)
  const requestedReelId = firstParam(params.reelId)
  const userId = useAuthStore((state) => state.user?.id)
  const {
    series,
    episodes,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
    fetchNextPage,
    fetchPreviousPage,
  } = useReelSeriesEpisodes(seriesId, requestedReelId)
  const isOwner = Boolean(series && userId === series.ownerId)
  const activeTabIndex = isOwner ? PROFILE_TAB_INDEX : REELS_TAB_INDEX
  const episodesDrawerRef = useRef<BottomSheetModal>(null)
  const episodesListRef = useRef<BottomSheetFlatListMethods | null>(null)
  const pendingSelectedReelIdRef = useRef<string | null>(null)
  const shouldManageAfterDismissRef = useRef(false)
  const isFetchingPreviousEpisodesRef = useRef(false)
  const hasHandledPreviousBoundaryThisGestureRef = useRef(false)
  const pendingPreviousPageAnchorRef = useRef<{
    offsetY: number
    episodeCount: number
    skeletonAdjusted: boolean
  } | null>(null)
  const pendingPreviousEpisodesRequestRef = useRef(false)
  const hasPagerReportedActiveRef = useRef(false)
  const [episodeSheetSession, setEpisodeSheetSession] = useState(0)
  const [episodeSheetIndex, setEpisodeSheetIndex] = useState(0)
  const collapsedSheetScrollBuffer = episodeSheetIndex === 0 ? windowHeight * 0.3 : 0

  const initialReelId = useMemo(() => {
    if (!episodes.length) {
      return undefined
    }

    if (requestedReelId && episodes.some((reel) => reel.id === requestedReelId)) {
      return requestedReelId
    }

    return episodes[0]?.id
  }, [episodes, requestedReelId])

  const [selectedReelId, setSelectedReelId] = useState<string | undefined>(initialReelId)
  const [playingReelId, setPlayingReelId] = useState<string | undefined>(requestedReelId)
  const selectedEpisodeId =
    selectedReelId && episodes.some((reel) => reel.id === selectedReelId)
      ? selectedReelId
      : initialReelId
  const activeReelId =
    playingReelId && episodes.some((reel) => reel.id === playingReelId)
      ? playingReelId
      : selectedEpisodeId
  const displayedPlayingReelId = useMemo(() => {
    const preferredReelId = hasPagerReportedActiveRef.current ? playingReelId : selectedEpisodeId

    if (preferredReelId && episodes.some((reel) => reel.id === preferredReelId)) {
      return preferredReelId
    }

    if (playingReelId && episodes.some((reel) => reel.id === playingReelId)) {
      return playingReelId
    }

    return episodes[0]?.id
  }, [episodes, playingReelId, selectedEpisodeId])
  const displayedPlayingEpisodeIndex = Math.max(
    0,
    displayedPlayingReelId ? episodes.findIndex((reel) => reel.id === displayedPlayingReelId) : 0,
  )
  const activeEpisodeInitialIndex = Math.max(
    0,
    displayedPlayingEpisodeIndex - ACTIVE_EPISODE_LEADING_ROWS,
  )

  useLayoutEffect(() => {
    const anchor = pendingPreviousPageAnchorRef.current
    if (!anchor) {
      return
    }

    if (isFetchingPreviousPage && !anchor.skeletonAdjusted) {
      anchor.skeletonAdjusted = true
      requestAnimationFrame(() => {
        episodesListRef.current?.scrollToOffset({
          animated: false,
          offset: anchor.offsetY + EPISODE_ITEM_HEIGHT,
        })
      })
      return
    }

    if (isFetchingPreviousPage) {
      return
    }

    if (episodes.length > anchor.episodeCount) {
      pendingPreviousPageAnchorRef.current = null
      requestAnimationFrame(() => {
        episodesListRef.current?.scrollToOffset({
          animated: false,
          offset: anchor.offsetY + (episodes.length - anchor.episodeCount) * EPISODE_ITEM_HEIGHT,
        })
      })
      return
    }

    pendingPreviousPageAnchorRef.current = null
    if (anchor.skeletonAdjusted) {
      requestAnimationFrame(() => {
        episodesListRef.current?.scrollToOffset({
          animated: false,
          offset: anchor.offsetY,
        })
      })
    }
  }, [episodes.length, isFetchingPreviousPage])

  const activeReelIdRef = useRef(activeReelId)

  useEffect(() => {
    activeReelIdRef.current = activeReelId
  }, [activeReelId])

  useEffect(() => {
    if (initialReelId && !playingReelId) {
      setPlayingReelId(initialReelId)
    }
  }, [initialReelId, playingReelId])

  useEffect(() => {
    if (initialReelId && selectedReelId !== selectedEpisodeId) {
      setSelectedReelId(selectedEpisodeId)
    }
  }, [initialReelId, selectedEpisodeId, selectedReelId])

  useEffect(() => {
    if (!isPending && (isError || !series)) {
      const isNotFound = isAxiosError(error) && error.response?.status === 404
      if (isNotFound) {
        if (router.canDismiss()) {
          router.dismissAll()
        }
        router.replace('/(tabs)/profile' as never)
      }
    }
  }, [error, isError, isPending, router, series])

  const handleTabSelect = useCallback(
    (_nextIndex: number, routeName: string) => {
      if (routeName === 'index') {
        router.replace('/')
        return true
      }

      router.replace(`/${routeName}` as never)
      return true
    },
    [router],
  )

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.46}
        pressBehavior="close"
      />
    ),
    [],
  )

  const handleEpisodeSheetDismiss = useCallback(() => {
    const pendingSelectedReelId = pendingSelectedReelIdRef.current
    pendingSelectedReelIdRef.current = null
    if (pendingSelectedReelId) {
      activeReelIdRef.current = pendingSelectedReelId
      setPlayingReelId(pendingSelectedReelId)
      setSelectedReelId(pendingSelectedReelId)
    }

    if (shouldManageAfterDismissRef.current && series) {
      shouldManageAfterDismissRef.current = false
      router.push({
        pathname: '/series/[id]/manage' as never,
        params: { id: series.id },
      })
      return
    }
  }, [router, series])

  const handleOpenEpisodes = useCallback(() => {
    setEpisodeSheetSession((current) => current + 1)
    episodesDrawerRef.current?.present()
  }, [])

  const handleEpisodeSelect = useCallback((reelId: string) => {
    pendingSelectedReelIdRef.current = reelId
    episodesDrawerRef.current?.dismiss()
  }, [])

  const handleManageFromSheet = useCallback(() => {
    if (!series) return
    shouldManageAfterDismissRef.current = true
    episodesDrawerRef.current?.dismiss()
  }, [series])

  const requestPreviousEpisodes = useCallback(() => {
    if (!hasPreviousPage || isFetchingPreviousPage || isFetchingPreviousEpisodesRef.current) {
      return
    }

    if (isFetchingNextPage) {
      pendingPreviousEpisodesRequestRef.current = true
      return
    }

    pendingPreviousEpisodesRequestRef.current = false
    isFetchingPreviousEpisodesRef.current = true
    void fetchPreviousPage()
      .catch(() => undefined)
      .finally(() => {
        isFetchingPreviousEpisodesRef.current = false
      })
  }, [fetchPreviousPage, hasPreviousPage, isFetchingNextPage, isFetchingPreviousPage])

  useEffect(() => {
    if (isPending || !hasPreviousPage || isFetchingPreviousPage) {
      return
    }

    requestPreviousEpisodes()
  }, [hasPreviousPage, isFetchingPreviousPage, isPending, requestPreviousEpisodes])

  useEffect(() => {
    if (!isFetchingNextPage && pendingPreviousEpisodesRequestRef.current) {
      requestPreviousEpisodes()
    }
  }, [isFetchingNextPage, requestPreviousEpisodes])

  const handleListScrollEnd = useCallback(
    (offsetY: number) => {
      if (pendingPreviousPageAnchorRef.current) {
        return
      }

      if (offsetY <= EPISODE_PREFETCH_DISTANCE) {
        if (hasHandledPreviousBoundaryThisGestureRef.current) {
          return
        }

        if (hasPreviousPage) {
          hasHandledPreviousBoundaryThisGestureRef.current = true
          pendingPreviousPageAnchorRef.current = {
            offsetY,
            episodeCount: episodes.length,
            skeletonAdjusted: false,
          }
        }
        requestPreviousEpisodes()
      }
    },
    [episodes.length, hasPreviousPage, requestPreviousEpisodes],
  )

  const handleContextPageRequest = useCallback(
    (direction: 'previous' | 'next') => {
      if (direction === 'previous') {
        requestPreviousEpisodes()
      } else if (
        direction === 'next' &&
        hasNextPage &&
        !isFetchingNextPage &&
        !isFetchingPreviousPage
      ) {
        void fetchNextPage()
      }
    },
    [
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage,
      isFetchingPreviousPage,
      requestPreviousEpisodes,
    ],
  )

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-[#050505] px-6">
        <StatusBar style="light" />
        <ActivityIndicator color="#FF935B" />
        <Text className="mt-4 font-heading text-xl text-white">Loading series</Text>
      </View>
    )
  }

  if (isError || !series) {
    const isNotFound = isAxiosError(error) && error.response?.status === 404

    return (
      <View
        className="flex-1 items-center justify-center bg-[#050505] px-6"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <StatusBar style="light" />
        <TouchableOpacity
          accessibilityLabel="Go back"
          accessibilityRole="button"
          className="absolute left-5 h-11 w-11 items-center justify-center rounded-full"
          style={{ top: insets.top + 18 }}
          activeOpacity={0.72}
          onPress={() => router.back()}
        >
          <MaterialIcons name="arrow-back" size={26} color="#FFFFFF" />
        </TouchableOpacity>

        <MaterialIcons name="video-library" size={40} color="#FF935B" />
        <Text className="mt-4 text-center font-heading text-xl text-white">
          {isNotFound ? 'Series not found' : 'Series unavailable'}
        </Text>
        <Text className="mt-2 max-w-[300px] text-center text-base2 leading-6 text-white/70">
          {isNotFound
            ? 'This series is unavailable or you no longer have access to it.'
            : 'Velora could not load this series right now.'}
        </Text>
        {!isNotFound ? (
          <TouchableOpacity
            accessibilityLabel="Try loading series again"
            accessibilityRole="button"
            className="mt-6 h-11 items-center justify-center rounded-full bg-brand px-6"
            activeOpacity={0.84}
            onPress={() => void refetch()}
          >
            <Text className="font-semibold text-white">Try again</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    )
  }

  if (!initialReelId) {
    return (
      <View
        className="flex-1 items-center justify-center bg-[#050505] px-6"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <StatusBar style="light" />
        <TouchableOpacity
          accessibilityLabel="Go back"
          accessibilityRole="button"
          className="absolute left-5 h-11 w-11 items-center justify-center rounded-full"
          style={{ top: insets.top + 18 }}
          activeOpacity={0.72}
          onPress={() => {
            if (router.canGoBack()) {
              router.back()
            } else {
              router.replace('/(tabs)/profile' as never)
            }
          }}
        >
          <MaterialIcons name="arrow-back" size={26} color="#FFFFFF" />
        </TouchableOpacity>
        <MaterialIcons name="video-library" size={40} color="#FF935B" />
        <Text className="mt-4 text-center font-heading text-xl text-white">{series.title}</Text>
        <Text className="mt-2 text-center text-base2 text-white/70">
          This series has no episodes yet.
        </Text>
        {isOwner ? (
          <View className="mt-6 flex-row gap-3">
            <TouchableOpacity
              accessibilityLabel="Add episodes"
              accessibilityRole="button"
              className="min-h-11 flex-row items-center justify-center rounded-full bg-brand px-5"
              activeOpacity={0.84}
              onPress={() =>
                router.push({
                  pathname: '/series/[id]/manage' as never,
                  params: { id: series.id, openPicker: 'true' },
                })
              }
            >
              <MaterialIcons name="add" size={18} color="#FFFFFF" />
              <Text className="ml-1.5 font-semibold text-white">Add episodes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel="Manage series"
              accessibilityRole="button"
              className="min-h-11 flex-row items-center justify-center rounded-full border border-white/20 bg-white/10 px-5"
              activeOpacity={0.84}
              onPress={() =>
                router.push({ pathname: '/series/[id]/manage' as never, params: { id: series.id } })
              }
            >
              <MaterialIcons name="settings" size={18} color="#FFFFFF" />
              <Text className="ml-1.5 font-semibold text-white">Manage</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View className="flex-1 bg-[#050505]">
      <ReelsViewer
        mode="context"
        contextItems={episodes}
        reelId={selectedEpisodeId}
        headerTitle={series.title}
        headerRight={
          isOwner ? (
            <TouchableOpacity
              accessibilityLabel="Manage series"
              accessibilityRole="button"
              className="h-11 w-11 items-center justify-center rounded-full"
              activeOpacity={0.72}
              onPress={() =>
                router.push({
                  pathname: '/series/[id]/manage' as never,
                  params: { id: series.id },
                })
              }
            >
              <MaterialIcons name="settings" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          ) : undefined
        }
        onActiveReelChange={(reel) => {
          activeReelIdRef.current = reel.id
          hasPagerReportedActiveRef.current = true
          setPlayingReelId(reel.id)
        }}
        eventSource="DIRECT"
        bottomContentInset={tabBarHeight}
        tabBarHeight={tabBarHeight}
        isSeriesPlayback
        onOpenSeriesEpisodes={handleOpenEpisodes}
        seriesEpisodeCount={series.episodeCount}
        hasPreviousContextPage={hasPreviousPage}
        hasNextContextPage={hasNextPage}
        isFetchingContextPage={isFetchingPreviousPage || isFetchingNextPage}
        onContextPageRequest={handleContextPageRequest}
      />

      {/* Docked bottom navigation tab bar */}
      <CustomTabBarSurface
        activeIndex={activeTabIndex}
        forceDarkTheme
        onTabSelect={handleTabSelect}
      />

      {/* TikTok-style Episodes Drawer */}
      <BottomSheetModal
        ref={episodesDrawerRef}
        snapPoints={EPISODE_SHEET_SNAP_POINTS}
        index={0}
        enableDynamicSizing={false}
        enableContentPanningGesture={false}
        enablePanDownToClose
        onChange={setEpisodeSheetIndex}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
        onDismiss={handleEpisodeSheetDismiss}
      >
        <View className="flex-1">
          <View
            className="relative flex-row items-center justify-center px-5 pb-3.5 pt-1"
            style={{ zIndex: 1, elevation: 1 }}
          >
            <View className="items-center px-3">
              <Text
                className="font-heading text-base font-bold text-text-primary text-center"
                numberOfLines={1}
              >
                {series.title}
              </Text>
              <Text className="text-xs2 text-text-secondary text-center mt-0.5">
                {series.episodeCount} {series.episodeCount === 1 ? 'episode' : 'episodes'}
              </Text>
            </View>

            {isOwner ? (
              <TouchableOpacity
                accessibilityLabel="Manage series"
                accessibilityRole="button"
                className="absolute right-5 h-9 items-center justify-center rounded-full bg-surface-muted px-3.5"
                activeOpacity={0.76}
                onPress={handleManageFromSheet}
              >
                <Text className="text-xs2 font-bold text-text-primary">Manage</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {series.description?.trim() ? (
            <View className="bg-surface-muted/60 px-5 py-2.5">
              <Text className="text-xs2 leading-4 text-text-secondary" numberOfLines={2}>
                {series.description.trim()}
              </Text>
            </View>
          ) : null}

          <BottomSheetFlatList
            ref={episodesListRef}
            key={`${displayedPlayingReelId ?? 'episodes'}:${episodeSheetSession}`}
            data={episodes}
            style={styles.episodeList}
            initialScrollIndex={activeEpisodeInitialIndex}
            getItemLayout={(_, index) => ({
              length: EPISODE_ITEM_HEIGHT,
              offset: 12 + EPISODE_ITEM_HEIGHT * index,
              index,
            })}
            keyExtractor={(reel) => reel.id}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={5}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 12,
              // Gorhom sizes scrollables to the highest snap point; the collapsed sheet clips 30%.
              paddingBottom: insets.bottom + 24 + collapsedSheetScrollBuffer,
            }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: reel, index }) => {
              const isCurrent = reel.id === displayedPlayingReelId
              const cover = reel.thumbnailUrl || reel.localThumbnailUri
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Play episode ${reel.series?.episodeNumber ?? index + 1}`}
                  style={[styles.episodeRow, isCurrent && styles.currentEpisodeRow]}
                  onPress={() => handleEpisodeSelect(reel.id)}
                >
                  <View style={styles.episodeThumbnail}>
                    {cover ? (
                      <Image
                        source={{ uri: cover }}
                        contentFit="cover"
                        style={styles.episodeImage}
                        transition={150}
                      />
                    ) : (
                      <View style={styles.episodeFallback}>
                        <MaterialIcons name="movie" size={20} color={colors.text.tertiary} />
                      </View>
                    )}
                    <View style={styles.episodeBadge}>
                      <Text className="text-[9px] font-bold text-white">
                        Ep {reel.series?.episodeNumber ?? index + 1}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.episodeText}>
                    <Text
                      className="font-heading text-sm2 font-semibold text-text-primary"
                      style={styles.episodeTitle}
                      numberOfLines={2}
                    >
                      {reel.title?.trim() ||
                        reel.description?.trim() ||
                        `Episode ${reel.series?.episodeNumber ?? index + 1}`}
                    </Text>
                    {isCurrent ? (
                      <View style={styles.episodeStatus}>
                        <MaterialIcons name="play-arrow" size={14} color={colors.brand.primary} />
                        <Text className="ml-0.5 text-xs2 font-bold text-brand">Playing</Text>
                      </View>
                    ) : (
                      <Text className="mt-1 text-xs2 text-text-tertiary" style={styles.episodeMeta}>
                        {formatViews(reel.viewCount)} views
                      </Text>
                    )}
                  </View>
                </Pressable>
              )
            }}
            onEndReached={() => {
              if (hasNextPage && !isFetchingNextPage && !isFetchingPreviousPage) {
                void fetchNextPage()
              }
            }}
            onEndReachedThreshold={EPISODE_NEXT_PREFETCH_THRESHOLD}
            ListHeaderComponent={isFetchingPreviousPage ? <EpisodeCardSkeleton /> : null}
            ListFooterComponent={isFetchingNextPage ? <EpisodeCardSkeleton /> : null}
            onScrollBeginDrag={() => {
              hasHandledPreviousBoundaryThisGestureRef.current = false
            }}
            onScrollEndDrag={(event) => {
              handleListScrollEnd(event.nativeEvent.contentOffset.y)
            }}
            onMomentumScrollEnd={(event) => {
              handleListScrollEnd(event.nativeEvent.contentOffset.y)
            }}
          />
        </View>
      </BottomSheetModal>
    </View>
  )
}

const styles = StyleSheet.create({
  currentEpisodeRow: {
    backgroundColor: colors.surface.accent,
    borderColor: colors.brand.primary,
  },
  episodeBadge: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 4,
    bottom: 4,
    left: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    position: 'absolute',
  },
  episodeFallback: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  episodeImage: {
    height: '100%',
    width: '100%',
  },
  episodeList: {
    flex: 1,
  },
  episodeMeta: {
    marginTop: 4,
  },
  episodeRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.surface.muted,
    borderColor: 'transparent',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    minHeight: EPISODE_ROW_HEIGHT,
    padding: 10,
    width: '100%',
  },
  episodeSkeletonBlock: {
    backgroundColor: colors.border.light,
    opacity: 0.72,
  },
  episodeSkeletonLine: {
    backgroundColor: colors.border.light,
    borderRadius: 6,
    height: 12,
    marginBottom: 8,
    opacity: 0.72,
  },
  episodeSkeletonLineShort: {
    width: '38%',
  },
  episodeSkeletonLineWide: {
    width: '76%',
  },
  episodeStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 4,
  },
  episodeText: {
    flex: 1,
    justifyContent: 'center',
    marginLeft: 12,
    minWidth: 0,
    paddingVertical: 2,
  },
  episodeThumbnail: {
    backgroundColor: colors.border.light,
    borderRadius: 10,
    flexShrink: 0,
    height: 72,
    overflow: 'hidden',
    position: 'relative',
    width: 54,
  },
  episodeTitle: {
    flexShrink: 1,
  },
  handleIndicator: {
    backgroundColor: colors.border.strong,
    width: 56,
  },
  sheetBackground: {
    backgroundColor: colors.surface.modal,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
})
