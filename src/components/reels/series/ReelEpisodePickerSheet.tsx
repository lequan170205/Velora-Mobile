import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { Image } from 'expo-image'
import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '../../../constants/theme'
import { useAddReelToSeries, useReelSeriesCandidates } from '../../../hooks/useReels'

import type { Reel } from '../../../types/reel.types'

export interface ReelEpisodePickerSheetProps {
  sheetRef: React.RefObject<BottomSheetModal | null>
  seriesId: string
  onEpisodesAdded?: () => void
}

const getErrorMessage = (error: unknown) =>
  (error as Error & { response?: { data?: { message?: string } } })?.response?.data?.message ||
  (error as Error)?.message ||
  'Could not add episodes to this series.'

export function ReelEpisodePickerSheet({
  sheetRef,
  seriesId,
  onEpisodesAdded,
}: ReelEpisodePickerSheetProps) {
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const addReels = useAddReelToSeries()

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useReelSeriesCandidates(seriesId, { limit: 30 }, { enabled: Boolean(seriesId) })

  const candidateReels = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])

  // 3-column grid calculation
  // Total padding inside sheet: 20 * 2 = 40. Gap between 3 items: 8 * 2 = 16.
  const columnWidth = useMemo(() => Math.floor((windowWidth - 40 - 16) / 3), [windowWidth])
  const itemHeight = useMemo(() => Math.floor(columnWidth * 1.45), [columnWidth])

  const snapPoints = useMemo(() => ['88%'], [])

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.48}
        pressBehavior={isSubmitting ? 'none' : 'close'}
      />
    ),
    [isSubmitting],
  )

  const toggleSelect = useCallback((reel: Reel) => {
    setSelectedIds((prev) => {
      const idx = prev.indexOf(reel.id)
      if (idx >= 0) {
        return prev.filter((id) => id !== reel.id)
      }
      return [...prev, reel.id]
    })
  }, [])

  const handleDismiss = useCallback(() => {
    if (!isSubmitting) {
      setSelectedIds([])
    }
  }, [isSubmitting])

  const handleAddSelected = useCallback(async () => {
    if (selectedIds.length === 0 || !seriesId || isSubmitting) return

    setIsSubmitting(true)
    try {
      await addReels.mutateAsync({
        seriesId,
        data: { reelIds: selectedIds },
      })

      setSelectedIds([])
      onEpisodesAdded?.()
      sheetRef.current?.dismiss()
    } catch (err) {
      Alert.alert('Could not add episodes', getErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }, [addReels, isSubmitting, onEpisodesAdded, selectedIds, seriesId, sheetRef])

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      enableDynamicSizing={false}
      enablePanDownToClose={!isSubmitting}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      onDismiss={handleDismiss}
    >
      <View style={styles.sheetContent}>
        {/* Header */}
        <View className="flex-row items-start justify-between pb-3 pt-1">
          <View className="flex-1 pr-3">
            <Text className="font-heading text-xl text-text-primary">Add episodes</Text>
            <Text className="mt-0.5 text-xs2 leading-4 text-text-secondary">
              Tap reels in the order you want them added.
            </Text>
          </View>
          <TouchableOpacity
            accessibilityLabel="Close episode picker"
            accessibilityRole="button"
            className="h-9 w-9 items-center justify-center rounded-full bg-[#EFECE8]"
            disabled={isSubmitting}
            onPress={() => sheetRef.current?.dismiss()}
          >
            <MaterialIcons name="close" size={20} color="#17120F" />
          </TouchableOpacity>
        </View>

        {/* Reel Grid / Loading / Empty */}
        {isPending && candidateReels.length === 0 ? (
          <View className="flex-1 items-center justify-center py-12">
            <ActivityIndicator color={colors.brand.primary} size="small" />
            <Text className="mt-3 text-xs2 text-text-secondary">Loading available reels…</Text>
          </View>
        ) : isError ? (
          <View className="flex-1 items-center justify-center py-12">
            <MaterialIcons name="error-outline" size={32} color="#D85A21" />
            <Text className="mt-2 text-sm2 font-semibold text-text-primary">
              Could not load candidate reels
            </Text>
          </View>
        ) : candidateReels.length === 0 ? (
          <View className="flex-1 items-center justify-center py-12">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-[#F7F2EC]">
              <MaterialIcons name="video-library" size={28} color="rgba(46,36,30,0.36)" />
            </View>
            <Text className="mt-3 text-sm2 font-bold text-text-primary">No reels available</Text>
            <Text className="mt-1 px-6 text-center text-xs2 text-text-secondary">
              There are no compatible standalone reels available for this series.
            </Text>
          </View>
        ) : (
          <BottomSheetScrollView
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingBottom: 24,
            }}
          >
            <View className="flex-row flex-wrap gap-2 pt-2">
              {candidateReels.map((reel) => {
                const selectionIndex = selectedIds.indexOf(reel.id)
                const isSelected = selectionIndex >= 0

                return (
                  <Pressable
                    key={reel.id}
                    style={[
                      styles.card,
                      { width: columnWidth, height: itemHeight },
                      isSelected && styles.cardSelected,
                    ]}
                    onPress={() => toggleSelect(reel)}
                    disabled={isSubmitting}
                  >
                    {reel.thumbnailUrl ? (
                      <Image
                        key="thumb"
                        source={{ uri: reel.thumbnailUrl }}
                        contentFit="cover"
                        style={styles.image}
                      />
                    ) : (
                      <View key="no-thumb" style={styles.placeholder}>
                        <MaterialIcons name="movie" size={24} color="#6F6861" />
                      </View>
                    )}

                    {/* Dim overlay when selected */}
                    {isSelected ? <View key="dim" style={styles.dimOverlay} /> : null}

                    {/* Order Badge at Top Right */}
                    <View key="badge-anchor" style={styles.badgeAnchor}>
                      {isSelected ? (
                        <View key="badge-selected" style={styles.selectedBadge}>
                          <Text style={styles.badgeText}>{selectionIndex + 1}</Text>
                        </View>
                      ) : (
                        <View key="badge-unselected" style={styles.unselectedBadge} />
                      )}
                    </View>

                    {/* Title or Duration at Bottom */}
                    <View key="title-box" style={styles.titleContainer}>
                      <Text style={styles.titleText} numberOfLines={1}>
                        {reel.title || 'Untitled'}
                      </Text>
                    </View>
                  </Pressable>
                )
              })}
            </View>

            {hasNextPage ? (
              <TouchableOpacity
                className="mt-4 items-center justify-center py-3"
                disabled={isFetchingNextPage}
                onPress={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? (
                  <ActivityIndicator color={colors.brand.primary} size="small" />
                ) : (
                  <Text className="text-xs2 font-semibold text-brand">Load more reels</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </BottomSheetScrollView>
        )}

        {/* Bottom Action Footer */}
        <View style={[styles.footerContainer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity
            style={[
              styles.footerButton,
              selectedIds.length > 0 && !isSubmitting
                ? styles.footerButtonActive
                : styles.footerButtonDisabled,
            ]}
            disabled={selectedIds.length === 0 || isSubmitting}
            onPress={() => void handleAddSelected()}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <MaterialIcons
                  name="add"
                  size={18}
                  color={selectedIds.length > 0 ? '#FFFFFF' : '#A89D94'}
                />
                <Text
                  style={[
                    styles.footerButtonText,
                    { color: selectedIds.length > 0 ? '#FFFFFF' : '#A89D94' },
                  ]}
                >
                  {selectedIds.length === 0
                    ? 'Select reels to add'
                    : `Add ${selectedIds.length} ${selectedIds.length === 1 ? 'episode' : 'episodes'}`}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  badgeAnchor: {
    position: 'absolute',
    right: 6,
    top: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#1F1915',
    borderColor: 'rgba(0, 0, 0, 0.08)',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  cardSelected: {
    borderColor: '#FF7A45',
    borderWidth: 2,
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  footerButton: {
    alignItems: 'center',
    borderRadius: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 20,
  },
  footerButtonActive: {
    backgroundColor: '#FF7A45',
  },
  footerButtonDisabled: {
    backgroundColor: '#E9DDD2',
  },
  footerButtonText: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 4,
  },
  footerContainer: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#EFE9E2',
    borderTopWidth: 1,
    paddingTop: 12,
  },
  handleIndicator: {
    backgroundColor: '#D9D3CC',
    width: 52,
  },
  image: {
    height: '100%',
    width: '100%',
  },
  placeholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  selectedBadge: {
    alignItems: 'center',
    backgroundColor: '#FF7A45',
    borderRadius: 12,
    elevation: 2,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  sheetBackground: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  sheetContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  titleContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    bottom: 0,
    left: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    position: 'absolute',
    right: 0,
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
  unselectedBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    borderWidth: 2,
    height: 24,
    width: 24,
  },
})
