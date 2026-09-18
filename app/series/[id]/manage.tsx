import { MaterialIcons } from '@expo/vector-icons'
import { isAxiosError } from 'axios'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { GlassIconButton } from '@/components/reels/create/shared-ui'
import {
  useDeleteReelSeries,
  useReelSeries,
  useRemoveReelFromSeries,
  useReorderReelSeries,
  useUpdateReelSeries,
} from '@/hooks/useReels'
import { useAuthStore } from '@/stores/authStore'
import type { Reel, ReelVisibility } from '@/types/reel.types'

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

const errorMessage = (error: unknown, fallback: string) =>
  (error as Error & { response?: { data?: { message?: string } } })?.response?.data?.message ||
  (error as Error)?.message ||
  fallback

export default function ManageReelSeriesScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const userId = useAuthStore((state) => state.user?.id)
  const params = useLocalSearchParams<{ id?: string | string[] }>()
  const seriesId = firstParam(params.id)
  const { data: series, isPending, isError, error, refetch } = useReelSeries(seriesId)
  const updateSeries = useUpdateReelSeries()
  const deleteSeries = useDeleteReelSeries()
  const removeEpisode = useRemoveReelFromSeries()
  const reorderSeries = useReorderReelSeries()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<ReelVisibility>('public')
  const [orderedReels, setOrderedReels] = useState<Reel[]>([])

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

  const moveEpisode = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset
    if (nextIndex < 0 || nextIndex >= orderedReels.length) return
    setOrderedReels((current) => {
      const next = [...current]
      const currentEpisode = next[index]
      const targetEpisode = next[nextIndex]
      if (!currentEpisode || !targetEpisode) return current
      next[index] = targetEpisode
      next[nextIndex] = currentEpisode
      return next
    })
  }

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
            .then(() => router.replace('/series' as never))
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

        <ScrollView
          className="mt-3 flex-1"
          contentContainerStyle={{ paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
                    className={`min-h-14 flex-1 items-center justify-center rounded-[18px] px-2 ${selected ? 'bg-[#17120F]' : 'bg-[#F7F2EC]'}`}
                    activeOpacity={0.84}
                    disabled={isBusy}
                    onPress={() => setVisibility(option.value)}
                  >
                    <MaterialIcons
                      name={option.icon}
                      size={18}
                      color={selected ? '#FFFFFF' : '#17120F'}
                    />
                    <Text
                      className="mt-1"
                      style={{
                        color: selected ? '#FFFFFF' : '#17120F',
                        fontSize: 12,
                        fontWeight: '800',
                      }}
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
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="font-heading text-lg" style={{ color: '#17120F' }}>
                  Episodes
                </Text>
                <Text className="mt-1 text-xs2" style={{ color: 'rgba(46,36,30,0.58)' }}>
                  Move episodes, then save the order once.
                </Text>
              </View>
              <Text style={{ color: 'rgba(46,36,30,0.48)', fontSize: 12 }}>
                {orderedReels.length}
              </Text>
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
                  Add a reel from its edit screen or when publishing.
                </Text>
              </View>
            ) : (
              <View className="mt-3 gap-2">
                {orderedReels.map((reel, index) => (
                  <View
                    key={reel.id}
                    className="flex-row items-center rounded-[22px] bg-[#F7F2EC] p-3"
                  >
                    <View className="h-16 w-12 overflow-hidden rounded-[14px] bg-white">
                      {reel.thumbnailUrl ? (
                        <Image
                          source={{ uri: reel.thumbnailUrl }}
                          contentFit="cover"
                          style={{ width: 48, height: 64 }}
                        />
                      ) : (
                        <View className="flex-1 items-center justify-center">
                          <MaterialIcons name="movie" size={20} color="rgba(46,36,30,0.36)" />
                        </View>
                      )}
                    </View>
                    <View className="ml-3 min-w-0 flex-1">
                      <Text style={{ color: '#17120F', fontWeight: '800' }} numberOfLines={1}>
                        {index + 1}. {reel.title || 'Untitled reel'}
                      </Text>
                      <View className="mt-2 flex-row gap-2">
                        <TouchableOpacity
                          accessibilityLabel={`Move episode ${index + 1} up`}
                          accessibilityRole="button"
                          className="h-11 w-11 items-center justify-center rounded-[15px] bg-white"
                          disabled={index === 0 || isBusy}
                          style={{ opacity: index === 0 ? 0.38 : 1 }}
                          onPress={() => moveEpisode(index, -1)}
                        >
                          <MaterialIcons name="keyboard-arrow-up" size={22} color="#17120F" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          accessibilityLabel={`Move episode ${index + 1} down`}
                          accessibilityRole="button"
                          className="h-11 w-11 items-center justify-center rounded-[15px] bg-white"
                          disabled={index === orderedReels.length - 1 || isBusy}
                          style={{ opacity: index === orderedReels.length - 1 ? 0.38 : 1 }}
                          onPress={() => moveEpisode(index, 1)}
                        >
                          <MaterialIcons name="keyboard-arrow-down" size={22} color="#17120F" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <TouchableOpacity
                      accessibilityLabel={`Remove ${reel.title || 'episode'} from series`}
                      accessibilityRole="button"
                      className="ml-2 h-11 w-11 items-center justify-center rounded-[15px] bg-white"
                      disabled={isBusy}
                      onPress={() => confirmRemoveEpisode(reel)}
                    >
                      <MaterialIcons name="remove-circle-outline" size={21} color="#D85A21" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {orderedReels.length > 1 ? (
              <TouchableOpacity
                className={`mt-4 min-h-12 items-center justify-center rounded-[20px] px-5 ${orderChanged && !isBusy ? 'bg-[#17120F]' : 'bg-[#E9DDD2]'}`}
                disabled={!orderChanged || isBusy}
                onPress={() => void handleSaveOrder()}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>
                  {reorderSeries.isPending ? 'Saving order…' : 'Save episode order'}
                </Text>
              </TouchableOpacity>
            ) : null}
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
            <Text className="mt-2 text-center text-xs2" style={{ color: 'rgba(46,36,30,0.54)' }}>
              Deleting a series never deletes its reels.
            </Text>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}
