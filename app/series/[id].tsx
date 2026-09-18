import { MaterialIcons } from '@expo/vector-icons'
import { isAxiosError } from 'axios'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useMemo } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ReelsViewer } from '../../src/components/reels/ReelsViewer'
import { useReelSeries } from '../../src/hooks/useReels'
import { useAuthStore } from '../../src/stores/authStore'

const firstParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value)

export default function ReelSeriesScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{
    id?: string | string[]
    reelId?: string | string[]
  }>()
  const seriesId = firstParam(params.id)
  const requestedReelId = firstParam(params.reelId)
  const userId = useAuthStore((state) => state.user?.id)
  const { data: series, isPending, isError, error, refetch } = useReelSeries(seriesId)
  const isOwner = Boolean(series && userId === series.ownerId)
  const initialReelId = useMemo(() => {
    if (!series?.reels.length) {
      return undefined
    }

    if (requestedReelId && series.reels.some((reel) => reel.id === requestedReelId)) {
      return requestedReelId
    }

    return series.reels[0]?.id
  }, [requestedReelId, series])

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
          className="absolute left-5 h-12 w-12 items-center justify-center rounded-full border border-white/16 bg-black/44"
          style={{ top: insets.top + 18 }}
          activeOpacity={0.72}
          onPress={() => router.back()}
        >
          <MaterialIcons name="arrow-back" size={28} color="#FFFFFF" />
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
          className="absolute left-5 h-12 w-12 items-center justify-center rounded-full border border-white/16 bg-black/44"
          style={{ top: insets.top + 18 }}
          activeOpacity={0.72}
          onPress={() => router.back()}
        >
          <MaterialIcons name="arrow-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <MaterialIcons name="video-library" size={40} color="#FF935B" />
        <Text className="mt-4 text-center font-heading text-xl text-white">{series.title}</Text>
        <Text className="mt-2 text-center text-base2 text-white/70">
          This series has no episodes yet.
        </Text>
        {isOwner ? (
          <TouchableOpacity
            accessibilityLabel="Manage series"
            accessibilityRole="button"
            className="mt-6 min-h-11 flex-row items-center justify-center rounded-full bg-brand px-5"
            activeOpacity={0.84}
            onPress={() =>
              router.push({ pathname: '/series/[id]/manage' as never, params: { id: series.id } })
            }
          >
            <MaterialIcons name="settings" size={18} color="#FFFFFF" />
            <Text className="ml-2 font-semibold text-white">Manage series</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    )
  }

  return (
    <View className="flex-1 bg-[#050505]">
      <ReelsViewer
        mode="context"
        contextItems={series.reels}
        reelId={initialReelId}
        eventSource="DIRECT"
      />

      <View
        pointerEvents="none"
        className="absolute right-4 z-40 max-w-[72%] rounded-[18px] border border-white/12 bg-black/52 px-4 py-2.5"
        style={{ top: insets.top + 18 }}
      >
        <Text className="font-heading text-base text-white" numberOfLines={1}>
          {series.title}
        </Text>
        <Text className="mt-0.5 text-xs2 font-medium text-white/70">
          {series.reels.length} {series.reels.length === 1 ? 'episode' : 'episodes'}
        </Text>
        {series.description?.trim() ? (
          <Text className="mt-1 text-xs2 leading-4 text-white/70" numberOfLines={1}>
            {series.description.trim()}
          </Text>
        ) : null}
      </View>

      {isOwner ? (
        <TouchableOpacity
          accessibilityLabel="Manage series"
          accessibilityRole="button"
          className="absolute right-4 z-40 h-11 w-11 items-center justify-center rounded-full border border-white/14 bg-black/52"
          style={{ top: insets.top + 96 }}
          activeOpacity={0.78}
          onPress={() =>
            router.push({ pathname: '/series/[id]/manage' as never, params: { id: series.id } })
          }
        >
          <MaterialIcons name="settings" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      ) : null}
    </View>
  )
}
