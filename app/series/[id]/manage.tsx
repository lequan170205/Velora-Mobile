import { MaterialIcons } from '@expo/vector-icons'
import { isAxiosError } from 'axios'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  ShadowDecorator,
} from 'react-native-draggable-flatlist'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { GlassIconButton } from '@/components/reels/create/shared-ui'
import { ReelEpisodePickerSheet } from '@/components/reels/series/ReelEpisodePickerSheet'
import {
  useDeleteReelSeries,
  useReelSeries,
  useRemoveReelFromSeries,
  useReorderReelSeries,
  useUpdateReelSeries,
} from '@/hooks/useReels'
import { useAuthStore } from '@/stores/authStore'
import type { Reel, ReelVisibility } from '@/types/reel.types'
import type { BottomSheetModal } from '@gorhom/bottom-sheet'

import type { RenderItemParams } from 'react-native-draggable-flatlist'

const firstParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value)

const visibilityOptions: {
  icon: keyof typeof MaterialIcons.glyphMap
  label: string
  value: ReelVisibility
}[] = [
  { icon: 'public', label: 'Public', value: 'public' },
  { icon: 'group', label: 'Friends', value: 'friends' },
  { icon: 'lock-outline', label: 'Private', value: 'private' },
]

export const isBroadeningSeriesVisibility = (
  currentVisibility: ReelVisibility,
  nextVisibility: ReelVisibility,
): boolean => {
  const rank: Record<ReelVisibility, number> = {
    private: 0,
    friends: 1,
    public: 2,
  }
  return rank[nextVisibility] > rank[currentVisibility]
}

const errorMessage = (error: unknown, fallback: string) =>
  (error as Error & { response?: { data?: { message?: string } } })?.response?.data?.message ||
  (error as Error)?.message ||
  fallback

export default function ManageReelSeriesScreen() {
  const insets = useSafeAreaInsets()
  const userId = useAuthStore((state) => state.user?.id)
  const params = useLocalSearchParams<{ id?: string | string[]; openPicker?: string }>()
  const seriesId = firstParam(params.id)
  const episodePickerRef = useRef<BottomSheetModal>(null)
  const { data: series, isPending, isError, error, refetch } = useReelSeries(seriesId)
  const updateSeries = useUpdateReelSeries()
  const deleteSeries = useDeleteReelSeries()
  const removeEpisode = useRemoveReelFromSeries()
  const reorderSeries = useReorderReelSeries()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<ReelVisibility>('public')
  const [orderedReels, setOrderedReels] = useState<Reel[]>([])
  const [activeTab, setActiveTab] = useState<'episodes' | 'settings'>('episodes')
  const [activeDrag, setActiveDrag] = useState<{
    id: string
    fromIndex: number
    toIndex: number
  } | null>(null)

  const handleSelectVisibility = (nextVisibility: ReelVisibility) => {
    if (nextVisibility === visibility) return
    if (series && isBroadeningSeriesVisibility(series.visibility, nextVisibility)) {
      Alert.alert(
        'Broaden series audience?',
        'Changing the audience updates every episode in this series and makes them visible to more people.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Update',
            onPress: () => setVisibility(nextVisibility),
          },
        ],
      )
      return
    }
    setVisibility(nextVisibility)
  }

  useEffect(() => {
    if (params.openPicker === 'true') {
      const timer = setTimeout(() => {
        episodePickerRef.current?.present()
      }, 350)
      return () => clearTimeout(timer)
    }
  }, [params.openPicker])

  useEffect(() => {
    if (!series) return
    setTitle(series.title)
    setDescription(series.description ?? '')
    setVisibility(series.visibility)
    setOrderedReels(series.reels)
  }, [series])

  const isOwner = Boolean(series && userId === series.ownerId)
  const metadataChanged = Boolean(
    series &&
    (title.trim() !== series.title ||
      description.trim() !== (series.description ?? '').trim() ||
      visibility !== series.visibility),
  )
  const orderChanged = useMemo(() => {
    if (!series || orderedReels.length !== series.reels.length) return false
    return orderedReels.some((reel, index) => reel.id !== series.reels[index]?.id)
  }, [orderedReels, series])
  const isBusy =
    updateSeries.isPending ||
    deleteSeries.isPending ||
    removeEpisode.isPending ||
    reorderSeries.isPending

  const handleSaveDetails = async () => {
    if (!seriesId || !series || !metadataChanged) return
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      Alert.alert('Title required', 'Give this series a title before saving.')
      return
    }

    try {
      await updateSeries.mutateAsync({
        id: seriesId,
        data: {
          title: normalizedTitle,
          description: description.trim(),
          visibility,
        },
      })
    } catch (saveError) {
      Alert.alert('Save failed', errorMessage(saveError, 'Velora could not update this series.'))
    }
  }

  const handleSaveOrder = async () => {
    if (!seriesId || !orderChanged) return
    try {
      await reorderSeries.mutateAsync({
        seriesId,
        data: { reelIds: orderedReels.map((reel) => reel.id) },
      })
    } catch (reorderError) {
      if (isAxiosError(reorderError) && reorderError.response?.status === 409) {
        await refetch()
        Alert.alert(
          'Series changed',
          'The episode list changed elsewhere. Review the refreshed order.',
        )
        return
      }
      Alert.alert(
        'Order not saved',
        errorMessage(reorderError, 'Velora could not save this episode order.'),
      )
    }
  }

  const confirmRemoveEpisode = (reel: Reel) => {
    if (!seriesId) return
    Alert.alert('Remove episode?', 'The reel stays published and becomes standalone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void removeEpisode
            .mutateAsync({ seriesId, reelId: reel.id })
            .catch((removeError) =>
              Alert.alert(
                'Episode not removed',
                errorMessage(removeError, 'Velora could not remove this episode.'),
              ),
            )
        },
      },
    ])
  }

  const renderEpisodeItem = ({ item: reel, drag, getIndex, isActive }: RenderItemParams<Reel>) => {
    let displayIndex = getIndex() ?? 0
    if (activeDrag) {
      if (reel.id === activeDrag.id) {
        displayIndex = activeDrag.toIndex
      } else {
        const { fromIndex, toIndex } = activeDrag
        if (fromIndex > toIndex) {
          if (displayIndex >= toIndex && displayIndex < fromIndex) {
            displayIndex += 1
          }
        } else if (fromIndex < toIndex) {
          if (displayIndex > fromIndex && displayIndex <= toIndex) {
            displayIndex -= 1
          }
        }
      }
    }

    return (
      <ShadowDecorator elevation={6} radius={8} opacity={0.15}>
        <TouchableOpacity
          accessibilityLabel={`Episode ${displayIndex + 1}: ${reel.title || 'Untitled reel'}`}
          accessibilityHint="Drag to change the episode order"
          accessibilityRole="button"
          activeOpacity={0.92}
          disabled={isBusy}
          onPressIn={drag}
          style={[styles.episodeCard, isActive && styles.episodeCardActive]}
        >
          <View style={styles.thumbnailContainer}>
            {reel.thumbnailUrl ? (
              <Image
                source={{ uri: reel.thumbnailUrl }}
                contentFit="cover"
                style={styles.thumbnail}
              />
            ) : (
              <View style={styles.thumbnailPlaceholder}>
                <MaterialIcons name="movie" size={20} color="rgba(46,36,30,0.36)" />
              </View>
            )}
          </View>
          <View style={styles.episodeTitleContainer}>
            <Text style={styles.episodeTitle} numberOfLines={1}>
              {displayIndex + 1}. {reel.title || 'Untitled reel'}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityLabel={`Remove ${reel.title || 'episode'} from series`}
            accessibilityRole="button"
            style={styles.removeButton}
            disabled={isBusy}
            onPressIn={(e) => {
              e.stopPropagation()
            }}
            onPress={() => confirmRemoveEpisode(reel)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="remove-circle-outline" size={21} color="#D85A21" />
          </TouchableOpacity>
        </TouchableOpacity>
      </ShadowDecorator>
    )
  }

  const confirmDeleteSeries = () => {
    if (!seriesId) return
    Alert.alert('Delete series?', 'Reels stay published; only the Series is removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteSeries
            .mutateAsync(seriesId)
            .then(() => {
              if (router.canDismiss()) {
                router.dismissAll()
              }
              router.replace('/(tabs)/profile' as never)
            })
            .catch((deleteError) =>
              Alert.alert(
                'Series not deleted',
                errorMessage(deleteError, 'Velora could not delete this series.'),
              ),
            )
        },
      },
    ])
  }

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-[#F7F2EC]">
        <StatusBar style="dark" />
        <ActivityIndicator color="#FF7A45" />
      </View>
    )
  }

  if (isError || !series) {
    return (
      <View className="flex-1 items-center justify-center bg-[#F7F2EC] px-6">
        <StatusBar style="dark" />
        <View className="items-center rounded-[28px] bg-white px-6 py-7">
          <MaterialIcons name="error-outline" size={32} color="#D85A21" />
          <Text className="mt-4 font-heading text-xl" style={{ color: '#17120F' }}>
            Series unavailable
          </Text>
          <Text className="mt-2 text-center text-base2" style={{ color: 'rgba(46,36,30,0.62)' }}>
            {errorMessage(error, 'Velora could not load this series.')}
          </Text>
          <TouchableOpacity
            className="mt-6 min-h-11 justify-center rounded-full bg-[#FF7A45] px-5"
            onPress={() => void refetch()}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (!isOwner) {
    return (
      <View className="flex-1 items-center justify-center bg-[#F7F2EC] px-6">
        <StatusBar style="dark" />
        <View className="items-center rounded-[28px] bg-white px-6 py-7">
          <MaterialIcons name="lock-outline" size={32} color="#D85A21" />
          <Text className="mt-4 font-heading text-xl" style={{ color: '#17120F' }}>
            Owner controls only
          </Text>
          <Text className="mt-2 text-center text-base2" style={{ color: 'rgba(46,36,30,0.62)' }}>
            Only the series owner can edit episodes or audience settings.
          </Text>
          <TouchableOpacity
            className="mt-6 min-h-11 justify-center px-5"
            onPress={() => router.back()}
          >
            <Text style={{ color: '#D85A21', fontWeight: '800' }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#F7F2EC]"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="dark" />
      <View
        className="flex-1 px-5"
        style={{ paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom + 12, 12) }}
      >
        <View className="min-h-[56px] justify-center">
          <View className="absolute left-0 z-10">
            <GlassIconButton icon="arrow-back" tone="light" onPress={() => router.back()} />
          </View>
          <View className="absolute left-16 right-16 items-center">
            <Text
              className="text-xs2 uppercase tracking-[1.2px]"
              style={{ color: 'rgba(46,36,30,0.58)' }}
            >
              Series
            </Text>
            <Text
              className="mt-1 font-heading text-[22px]"
              style={{ color: '#17120F' }}
              numberOfLines={1}
            >
              Manage episodes
            </Text>
          </View>
        </View>

        {/* Segmented Tab Switcher */}
        <View className="mt-2.5 flex-row rounded-full bg-white/80 p-1 border border-[#EBE5DF]">
          <TouchableOpacity
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'episodes' }}
            accessibilityLabel="Episodes tab"
            className={`h-10 flex-1 flex-row items-center justify-center rounded-full ${
              activeTab === 'episodes' ? 'bg-[#FF7A45]' : 'bg-transparent'
            }`}
            activeOpacity={0.8}
            onPress={() => setActiveTab('episodes')}
          >
            <MaterialIcons
              name="video-library"
              size={17}
              color={activeTab === 'episodes' ? '#FFFFFF' : '#8A8379'}
            />
            <Text
              className="ml-1.5 text-xs2 font-bold"
              style={{ color: activeTab === 'episodes' ? '#FFFFFF' : '#17120F' }}
            >
              Episodes
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'settings' }}
            accessibilityLabel="Settings tab"
            className={`h-10 flex-1 flex-row items-center justify-center rounded-full ${
              activeTab === 'settings' ? 'bg-[#FF7A45]' : 'bg-transparent'
            }`}
            activeOpacity={0.8}
            onPress={() => setActiveTab('settings')}
          >
            <MaterialIcons
              name="settings"
              size={17}
              color={activeTab === 'settings' ? '#FFFFFF' : '#8A8379'}
            />
            <Text
              className="ml-1.5 text-xs2 font-bold"
              style={{ color: activeTab === 'settings' ? '#FFFFFF' : '#17120F' }}
            >
              Settings
            </Text>
          </TouchableOpacity>
        </View>

        <NestableScrollContainer
          className="mt-3 flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {activeTab === 'episodes' ? (
            <View className="rounded-[28px] bg-white p-4">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="font-heading text-lg" style={{ color: '#17120F' }}>
                    Episodes
                  </Text>
                  <Text className="mt-1 text-xs2" style={{ color: 'rgba(46,36,30,0.58)' }}>
                    Drag an episode to reorder, then save once.
                  </Text>
                </View>
                <View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Add episodes to series"
                    className="flex-row items-center rounded-full bg-[#FFF0E8] px-3 py-1.5"
                    disabled={isBusy}
                    onPress={() => episodePickerRef.current?.present()}
                  >
                    <MaterialIcons name="add" size={16} color="#D85A21" />
                    <Text className="ml-0.5 text-xs2 font-bold" style={{ color: '#D85A21' }}>
                      Add
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {orderedReels.length === 0 ? (
                <View className="mt-4 items-center rounded-[22px] bg-[#F7F2EC] px-5 py-7">
                  <MaterialIcons name="video-library" size={28} color="rgba(46,36,30,0.36)" />
                  <Text className="mt-3" style={{ color: '#17120F', fontWeight: '800' }}>
                    No episodes yet
                  </Text>
                  <Text
                    className="mt-1 text-center text-xs2"
                    style={{ color: 'rgba(46,36,30,0.58)' }}
                  >
                    Add a reel from its edit screen or choose from your published reels below.
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Select from your reels"
                    className="mt-4 flex-row items-center justify-center rounded-full bg-[#FF7A45] px-4 py-2.5"
                    disabled={isBusy}
                    onPress={() => episodePickerRef.current?.present()}
                  >
                    <MaterialIcons name="add" size={18} color="#FFFFFF" />
                    <Text className="ml-1 text-xs2 font-bold text-white">
                      Select from your reels
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <NestableDraggableFlatList
                  data={orderedReels}
                  extraData={activeDrag}
                  keyExtractor={(reel) => reel.id}
                  renderItem={renderEpisodeItem}
                  onDragBegin={(index) =>
                    setActiveDrag({
                      id: orderedReels[index]?.id ?? '',
                      fromIndex: index,
                      toIndex: index,
                    })
                  }
                  onPlaceholderIndexChange={(index) =>
                    setActiveDrag((prev) => (prev ? { ...prev, toIndex: index } : null))
                  }
                  onRelease={() => setActiveDrag(null)}
                  onDragEnd={({ data }) => setOrderedReels(data)}
                  scrollEnabled={false}
                  activationDistance={5}
                  containerStyle={{ marginTop: 12, overflow: 'visible' }}
                  contentContainerStyle={{ overflow: 'visible' }}
                />
              )}

              {orderedReels.length > 1 ? (
                <TouchableOpacity
                  className={`mt-4 min-h-12 items-center justify-center rounded-[20px] px-5 ${orderChanged && !isBusy ? 'bg-[#FF7A45]' : 'bg-[#E9DDD2]'}`}
                  disabled={!orderChanged || isBusy}
                  onPress={() => void handleSaveOrder()}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>
                    {reorderSeries.isPending ? 'Saving order…' : 'Save episode order'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <>
              <View className="rounded-[28px] bg-white p-4">
                <Text className="font-heading text-lg" style={{ color: '#17120F' }}>
                  Details
                </Text>
                <View className="mt-3 rounded-[22px] bg-[#F7F2EC] px-4 py-3">
                  <Text style={{ color: 'rgba(46,36,30,0.66)', fontSize: 12, fontWeight: '800' }}>
                    Title
                  </Text>
                  <TextInput
                    className="mt-1 text-base2"
                    style={{ color: '#17120F', padding: 0 }}
                    value={title}
                    onChangeText={setTitle}
                    editable={!isBusy}
                    maxLength={220}
                    selectionColor="#FF7A45"
                  />
                </View>
                <View className="mt-3 rounded-[22px] bg-[#F7F2EC] px-4 py-3">
                  <Text style={{ color: 'rgba(46,36,30,0.66)', fontSize: 12, fontWeight: '800' }}>
                    Description · optional
                  </Text>
                  <TextInput
                    className="mt-2 min-h-20 text-base2"
                    style={{ color: '#17120F', padding: 0 }}
                    value={description}
                    onChangeText={setDescription}
                    editable={!isBusy}
                    maxLength={2000}
                    multiline
                    textAlignVertical="top"
                    selectionColor="#FF7A45"
                  />
                </View>

                <Text
                  className="mt-4 text-xs2 font-semibold uppercase tracking-[1px]"
                  style={{ color: 'rgba(46,36,30,0.58)' }}
                >
                  Audience
                </Text>
                <View className="mt-2 flex-row gap-2">
                  {visibilityOptions.map((option) => {
                    const selected = visibility === option.value
                    return (
                      <TouchableOpacity
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        className={`min-h-[42px] flex-1 flex-row items-center justify-center rounded-[14px] px-2 py-2 ${selected ? 'bg-[#FF7A45]' : 'bg-[#F7F2EC]'}`}
                        activeOpacity={0.84}
                        disabled={isBusy}
                        onPress={() => handleSelectVisibility(option.value)}
                      >
                        <MaterialIcons
                          name={option.icon}
                          size={16}
                          color={selected ? '#FFFFFF' : '#17120F'}
                        />
                        <Text
                          className="ml-1.5"
                          style={{
                            color: selected ? '#FFFFFF' : '#17120F',
                            fontSize: 11.5,
                            fontWeight: '800',
                          }}
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
                <Text className="mt-2 text-xs2 leading-4" style={{ color: 'rgba(46,36,30,0.58)' }}>
                  Changing the audience updates every episode in this series.
                </Text>

                <TouchableOpacity
                  className={`mt-4 min-h-12 items-center justify-center rounded-[20px] px-5 ${metadataChanged && !isBusy ? 'bg-[#FF7A45]' : 'bg-[#E9DDD2]'}`}
                  disabled={!metadataChanged || isBusy}
                  onPress={() => void handleSaveDetails()}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>
                    {updateSeries.isPending ? 'Saving…' : 'Save details'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View className="mt-3 rounded-[28px] bg-white p-4">
                <Text className="font-heading text-lg" style={{ color: '#17120F' }}>
                  Series controls
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Delete series"
                  className="mt-3 min-h-12 flex-row items-center justify-center rounded-[20px] bg-[#FFF0E8] px-5"
                  disabled={isBusy}
                  onPress={confirmDeleteSeries}
                >
                  <MaterialIcons name="delete-outline" size={19} color="#D85A21" />
                  <Text className="ml-2" style={{ color: '#D85A21', fontWeight: '800' }}>
                    Delete series
                  </Text>
                </TouchableOpacity>
                <Text
                  className="mt-2 text-center text-xs2"
                  style={{ color: 'rgba(46,36,30,0.54)' }}
                >
                  Reels stay published; only the Series is removed.
                </Text>
              </View>
            </>
          )}
        </NestableScrollContainer>
      </View>

      <ReelEpisodePickerSheet
        sheetRef={episodePickerRef}
        seriesId={seriesId ?? ''}
        onEpisodesAdded={() => {
          void refetch()
        }}
      />
    </KeyboardAvoidingView>
  )
}

const styles = (StyleSheet?.create ?? (<T extends Record<string, unknown>>(s: T): T => s))({
  episodeCard: {
    alignItems: 'center',
    backgroundColor: '#F7F2EC',
    borderColor: 'transparent',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    padding: 12,
  },
  episodeCardActive: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(255, 122, 69, 0.35)',
    elevation: 6,
    shadowColor: '#17120F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  episodeTitle: {
    color: '#17120F',
    fontWeight: '800',
  },
  episodeTitleContainer: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  removeButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    height: 44,
    justifyContent: 'center',
    marginLeft: 8,
    width: 44,
  },
  thumbnail: {
    height: 64,
    width: 48,
  },
  thumbnailContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    height: 64,
    overflow: 'hidden',
    width: 48,
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
})
