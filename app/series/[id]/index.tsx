import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { isAxiosError } from 'axios'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  CustomTabBarSurface,
  getDockedTabBarHeight,
  PROFILE_TAB_INDEX,
  REELS_TAB_INDEX,
} from '../../../src/components/navigation/CustomTabBar'
import { ReelsViewer } from '../../../src/components/reels/ReelsViewer'
import { colors } from '../../../src/constants/theme'
import { useReelSeries } from '../../../src/hooks/useReels'
import { useAuthStore } from '../../../src/stores/authStore'

const firstParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value)

const formatViews = (count?: number) => {
  if (!count || count <= 0) return '0'
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(count)
}

export default function ReelSeriesScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const tabBarHeight = getDockedTabBarHeight(insets.bottom)
  const params = useLocalSearchParams<{
    id?: string | string[]
    reelId?: string | string[]
  }>()
  const seriesId = firstParam(params.id)
  const requestedReelId = firstParam(params.reelId)
  const userId = useAuthStore((state) => state.user?.id)
  const { data: series, isPending, isError, error, refetch } = useReelSeries(seriesId)
  const isOwner = Boolean(series && userId === series.ownerId)
  const activeTabIndex = isOwner ? PROFILE_TAB_INDEX : REELS_TAB_INDEX
  const episodesDrawerRef = useRef<BottomSheetModal>(null)

  const initialReelId = useMemo(() => {
    if (!series?.reels.length) {
      return undefined
    }

    if (requestedReelId && series.reels.some((reel) => reel.id === requestedReelId)) {
      return requestedReelId
    }

    return series.reels[0]?.id
  }, [requestedReelId, series])

  const [currentReelId, setCurrentReelId] = useState<string | undefined>(initialReelId)

  useEffect(() => {
    if (initialReelId && !currentReelId) {
      setCurrentReelId(initialReelId)
    }
  }, [initialReelId, currentReelId])

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

  const activeReelId = currentReelId ?? initialReelId

  return (
    <View className="flex-1 bg-[#050505]">
      <ReelsViewer
        mode="context"
        contextItems={series.reels}
        reelId={activeReelId}
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
        onActiveReelChange={(reel) => setCurrentReelId(reel.id)}
        eventSource="DIRECT"
        bottomContentInset={tabBarHeight}
        tabBarHeight={tabBarHeight}
        isSeriesPlayback
        onOpenSeriesEpisodes={() => episodesDrawerRef.current?.present()}
        seriesEpisodeCount={series.reels.length}
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
        snapPoints={['55%', '85%']}
        index={0}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <View className="flex-1">
          <View className="flex-row items-center justify-between border-b border-border-light px-5 pb-3.5 pt-1">
            <TouchableOpacity
              accessibilityLabel="Close episodes drawer"
              accessibilityRole="button"
              className="h-10 w-10 items-center justify-center rounded-full bg-surface-muted"
              activeOpacity={0.72}
              onPress={() => episodesDrawerRef.current?.dismiss()}
            >
              <MaterialIcons name="close" size={20} color={colors.text.primary} />
            </TouchableOpacity>

            <View className="flex-1 items-center px-3">
              <Text
                className="font-heading text-base font-bold text-text-primary text-center"
                numberOfLines={1}
              >
                {series.title}
              </Text>
              <Text className="text-xs2 text-text-secondary text-center mt-0.5">
                {series.reels.length} {series.reels.length === 1 ? 'episode' : 'episodes'}
              </Text>
            </View>

            {isOwner ? (
              <TouchableOpacity
                accessibilityLabel="Manage series"
                accessibilityRole="button"
                className="h-9 items-center justify-center rounded-full bg-surface-muted px-3.5"
                activeOpacity={0.76}
                onPress={() => {
                  episodesDrawerRef.current?.dismiss()
                  router.push({
                    pathname: '/series/[id]/manage' as never,
                    params: { id: series.id },
                  })
                }}
              >
                <Text className="text-xs2 font-bold text-text-primary">Manage</Text>
              </TouchableOpacity>
            ) : (
              <View className="w-10" />
            )}
          </View>

          {series.description?.trim() ? (
            <View className="border-b border-border-light bg-surface-muted/60 px-5 py-2.5">
              <Text className="text-xs2 leading-4 text-text-secondary" numberOfLines={2}>
                {series.description.trim()}
              </Text>
            </View>
          ) : null}

          <BottomSheetScrollView
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: insets.bottom + 24,
            }}
            showsVerticalScrollIndicator={false}
          >
            {series.reels.map((reel, index) => {
              const isCurrent = reel.id === activeReelId
              const cover = reel.thumbnailUrl || reel.localThumbnailUri
              return (
                <TouchableOpacity
                  key={reel.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Play episode ${index + 1}`}
                  className={`mb-2.5 flex-row items-center rounded-[16px] p-2.5 ${
                    isCurrent ? 'border border-brand-soft bg-surface-accent' : 'bg-surface-muted'
                  }`}
                  activeOpacity={0.82}
                  onPress={() => {
                    setCurrentReelId(reel.id)
                    episodesDrawerRef.current?.dismiss()
                  }}
                >
                  <View className="relative h-[72px] w-[54px] overflow-hidden rounded-[10px] bg-border-light">
                    {cover ? (
                      <Image
                        source={{ uri: cover }}
                        contentFit="cover"
                        style={{ width: 54, height: 72 }}
                        transition={150}
                      />
                    ) : (
                      <View className="flex-1 items-center justify-center">
                        <MaterialIcons name="movie" size={20} color={colors.text.tertiary} />
                      </View>
                    )}
                    <View className="absolute bottom-1 left-1 rounded bg-black/75 px-1 py-0.5">
                      <Text className="text-[9px] font-bold text-white">Ep {index + 1}</Text>
                    </View>
                  </View>

                  <View className="ml-3 flex-1 justify-center py-0.5">
                    <Text
                      className="font-heading text-sm2 font-semibold text-text-primary"
                      numberOfLines={2}
                    >
                      {reel.title?.trim() || reel.description?.trim() || `Episode ${index + 1}`}
                    </Text>
                    {isCurrent ? (
                      <View className="mt-1 flex-row items-center">
                        <MaterialIcons name="play-arrow" size={14} color={colors.brand.primary} />
                        <Text className="ml-0.5 text-xs2 font-bold text-brand">Playing</Text>
                      </View>
                    ) : (
                      <Text className="mt-1 text-xs2 text-text-tertiary">
                        {formatViews(reel.viewCount)} views
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              )
            })}
          </BottomSheetScrollView>
        </View>
      </BottomSheetModal>
    </View>
  )
}

const styles = StyleSheet.create({
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
