import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useMemo, useRef } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { GlassIconButton } from '@/components/reels/create/shared-ui'
import { ReelSeriesPickerSheet } from '@/components/reels/series/ReelSeriesPickerSheet'
import { useCreateReelSeries, useOwnedReelSeries } from '@/hooks/useReels'
import type { ReelSeries } from '@/types/reel.types'
import type { BottomSheetModal } from '@gorhom/bottom-sheet'

const visibilityLabel = (visibility: ReelSeries['visibility']) =>
  visibility === 'friends' ? 'Friends' : visibility === 'private' ? 'Private' : 'Public'

const getErrorMessage = (error: unknown) =>
  (error as Error & { response?: { data?: { message?: string } } })?.response?.data?.message ||
  (error as Error)?.message ||
  'Velora could not create this series.'

export default function OwnedReelSeriesScreen() {
  const router = useRouter()
  const createSheetRef = useRef<BottomSheetModal>(null)
  const createSeries = useCreateReelSeries()
  const {
    data,
    isPending,
    isError,
    isRefetching,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useOwnedReelSeries({ limit: 20 })
  const series = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])

  const openSeries = (item: ReelSeries) => {
    router.push({ pathname: '/series/[id]' as never, params: { id: item.id } })
  }

  return (
    <SafeAreaView className="flex-1 bg-[#F7F2EC]" edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View className="flex-1 px-5 pt-2">
        <View className="min-h-[56px] justify-center">
          <View className="absolute left-0 z-10">
            <GlassIconButton icon="arrow-back" tone="light" onPress={() => router.back()} />
          </View>
          <View className="absolute left-16 right-24 items-center">
            <Text
              className="text-xs2 uppercase tracking-[1.2px]"
              style={{ color: 'rgba(46,36,30,0.58)' }}
            >
              Profile
            </Text>
            <Text className="mt-1 font-heading text-[22px]" style={{ color: '#17120F' }}>
              Your series
            </Text>
          </View>
          <TouchableOpacity
            accessibilityLabel="Create series"
            accessibilityRole="button"
            className="absolute right-0 min-h-11 flex-row items-center justify-center rounded-full bg-[#FF7A45] px-4"
            activeOpacity={0.84}
            onPress={() => createSheetRef.current?.present()}
          >
            <MaterialIcons name="add" size={18} color="#FFFFFF" />
            <Text className="ml-1" style={{ color: '#FFFFFF', fontWeight: '800' }}>
              New
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          className="mt-3"
          data={series}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: 24,
            flexGrow: series.length === 0 ? 1 : undefined,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              colors={['#FF7A45']}
              tintColor="#FF7A45"
            />
          }
          renderItem={({ item }) => {
            const cover = item.reels.find((reel) => reel.thumbnailUrl)?.thumbnailUrl
            return (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.title}`}
                className="mb-3 flex-row items-center rounded-[28px] bg-white p-3"
                activeOpacity={0.84}
                onPress={() => openSeries(item)}
              >
                <View className="h-24 w-[68px] overflow-hidden rounded-[20px] bg-[#F7F2EC]">
                  {cover ? (
                    <Image
                      source={{ uri: cover }}
                      contentFit="cover"
                      style={{ width: 68, height: 96 }}
                    />
                  ) : (
                    <View className="flex-1 items-center justify-center">
                      <MaterialIcons name="video-library" size={26} color="rgba(46,36,30,0.34)" />
                    </View>
                  )}
                </View>
                <View className="ml-4 min-w-0 flex-1">
                  <Text
                    className="font-heading text-lg"
                    style={{ color: '#17120F' }}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Text className="mt-1 text-xs2" style={{ color: 'rgba(46,36,30,0.58)' }}>
                    {item.reels.length} {item.reels.length === 1 ? 'episode' : 'episodes'} ·{' '}
                    {visibilityLabel(item.visibility)}
                  </Text>
                  {item.description?.trim() ? (
                    <Text
                      className="mt-2 text-sm2 leading-5"
                      style={{ color: 'rgba(46,36,30,0.66)' }}
                      numberOfLines={2}
                    >
                      {item.description.trim()}
                    </Text>
                  ) : null}
                </View>
                <MaterialIcons name="chevron-right" size={23} color="rgba(46,36,30,0.34)" />
              </TouchableOpacity>
            )
          }}
          ListEmptyComponent={
            isPending ? (
              <View className="flex-1 items-center justify-center py-16">
                <ActivityIndicator color="#FF7A45" />
                <Text className="mt-3 text-sm2" style={{ color: 'rgba(46,36,30,0.58)' }}>
                  Loading your series…
                </Text>
              </View>
            ) : isError ? (
              <View className="flex-1 items-center justify-center rounded-[28px] bg-white px-6 py-8">
                <MaterialIcons name="refresh" size={30} color="#D85A21" />
                <Text className="mt-3 font-heading text-lg" style={{ color: '#17120F' }}>
                  Could not load series
                </Text>
                <TouchableOpacity
                  className="mt-5 min-h-11 justify-center rounded-full bg-[#FF7A45] px-5"
                  onPress={() => void refetch()}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="flex-1 items-center justify-center rounded-[28px] bg-white px-6 py-8">
                <View className="h-14 w-14 items-center justify-center rounded-[20px] bg-[#FFF0E8]">
                  <MaterialIcons name="video-library" size={27} color="#D85A21" />
                </View>
                <Text className="mt-4 font-heading text-xl" style={{ color: '#17120F' }}>
                  Start a series
                </Text>
                <Text
                  className="mt-2 text-center text-base2 leading-5"
                  style={{ color: 'rgba(46,36,30,0.62)' }}
                >
                  Group related reels into episodes viewers can watch in order.
                </Text>
                <TouchableOpacity
                  className="mt-6 min-h-12 flex-row items-center justify-center rounded-full bg-[#FF7A45] px-6"
                  onPress={() => createSheetRef.current?.present()}
                >
                  <MaterialIcons name="add" size={18} color="#FFFFFF" />
                  <Text className="ml-2" style={{ color: '#FFFFFF', fontWeight: '800' }}>
                    Create series
                  </Text>
                </TouchableOpacity>
              </View>
            )
          }
          ListFooterComponent={
            hasNextPage ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Load more series"
                className="mb-3 min-h-11 items-center justify-center rounded-full bg-white px-5"
                disabled={isFetchingNextPage}
                onPress={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? (
                  <ActivityIndicator color="#FF7A45" size="small" />
                ) : (
                  <Text style={{ color: '#17120F', fontWeight: '800' }}>Load more</Text>
                )}
              </TouchableOpacity>
            ) : null
          }
        />
      </View>

      <ReelSeriesPickerSheet
        sheetRef={createSheetRef}
        initialMode="create"
        initialVisibility="public"
        allowNone={false}
        onSelect={() => undefined}
        onCreate={async (payload) => {
          try {
            const created = await createSeries.mutateAsync(payload)
            router.push({
              pathname: '/series/[id]/manage' as never,
              params: { id: created.id, openPicker: 'true' },
            })
          } catch (createError) {
            Alert.alert('Series not created', getErrorMessage(createError))
            throw createError
          }
        }}
      />
    </SafeAreaView>
  )
}
