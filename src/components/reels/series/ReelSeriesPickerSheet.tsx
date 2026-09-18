import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { Image } from 'expo-image'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '../../../constants/theme'
import { useOwnedReelSeries } from '../../../hooks/useReels'

import type { CreateReelSeriesPayload, ReelSeries, ReelVisibility } from '../../../types/reel.types'

interface ReelSeriesPickerSheetProps {
  sheetRef: React.RefObject<BottomSheetModal | null>
  selectedSeriesId?: string
  initialVisibility: ReelVisibility
  initialMode?: 'list' | 'create'
  allowNone?: boolean
  title?: string
  subtitle?: string
  onSelect: (series: ReelSeries | null) => Promise<void> | void
  onCreate: (payload: CreateReelSeriesPayload) => Promise<void> | void
}

const visibilityOptions: {
  icon: keyof typeof MaterialIcons.glyphMap
  label: string
  value: ReelVisibility
}[] = [
  { icon: 'public', label: 'Public', value: 'public' },
  { icon: 'group', label: 'Friends', value: 'friends' },
  { icon: 'lock-outline', label: 'Private', value: 'private' },
]

const visibilityLabel = (visibility: ReelVisibility) =>
  visibility === 'friends' ? 'Friends' : visibility === 'private' ? 'Private' : 'Public'

export function ReelSeriesPickerSheet({
  sheetRef,
  selectedSeriesId,
  initialVisibility,
  initialMode = 'list',
  allowNone = true,
  title = 'Choose a series',
  subtitle = 'Keep related reels together in episode order.',
  onSelect,
  onCreate,
}: ReelSeriesPickerSheetProps) {
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<'list' | 'create'>(initialMode)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newVisibility, setNewVisibility] = useState<ReelVisibility>(initialVisibility)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { data, isPending, isError, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useOwnedReelSeries({ limit: 20 })
  const series = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])

  useEffect(() => {
    setNewVisibility(initialVisibility)
  }, [initialVisibility])

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.46}
        pressBehavior={isSubmitting ? 'none' : 'close'}
      />
    ),
    [isSubmitting],
  )

  const resetCreateForm = useCallback(() => {
    setMode(initialMode)
    setNewTitle('')
    setNewDescription('')
    setNewVisibility(initialVisibility)
  }, [initialMode, initialVisibility])

  const closeAfter = useCallback(
    async (action: () => Promise<void> | void) => {
      if (isSubmitting) return
      setIsSubmitting(true)
      try {
        await action()
        sheetRef.current?.dismiss()
        resetCreateForm()
      } catch {
        // The caller owns the error message; keep the sheet open for recovery.
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting, resetCreateForm, sheetRef],
  )

  const handleCreate = useCallback(() => {
    const normalizedTitle = newTitle.trim()
    if (!normalizedTitle) return

    void closeAfter(() =>
      onCreate({
        title: normalizedTitle,
        ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
        visibility: newVisibility,
      }),
    )
  }, [closeAfter, newDescription, newTitle, newVisibility, onCreate])

  const canReturnToList = mode === 'create' && initialMode === 'list'

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose={!isSubmitting}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      onDismiss={resetCreateForm}
    >
      <BottomSheetScrollView
        style={{ maxHeight: 620 }}
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 20),
          paddingHorizontal: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mt-1 flex-row items-start justify-between">
          <View className="flex-1 pr-4">
            <Text className="font-heading text-xl text-text-primary">
              {mode === 'create' ? 'New series' : title}
            </Text>
            <Text className="mt-1 text-base2 leading-5 text-text-secondary">
              {mode === 'create'
                ? 'Give this collection a clear name. You can edit it later.'
                : subtitle}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={canReturnToList ? 'Back to series list' : 'Close series picker'}
            accessibilityRole="button"
            className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
            disabled={isSubmitting}
            onPress={() => {
              if (canReturnToList) resetCreateForm()
              else sheetRef.current?.dismiss()
            }}
          >
            <MaterialIcons
              name={canReturnToList ? 'arrow-back' : 'close'}
              size={20}
              color={colors.text.primary}
            />
          </Pressable>
        </View>

        {mode === 'create' ? (
          <View className="mt-5 gap-3">
            <View className="rounded-[22px] bg-surface-muted px-4 py-3">
              <Text className="text-xs2 font-semibold uppercase tracking-[1px] text-text-muted">
                Title
              </Text>
              <TextInput
                className="mt-1 text-base2 text-text-primary"
                placeholder="e.g. Vietnam food diary"
                placeholderTextColor={colors.text.tertiary}
                value={newTitle}
                onChangeText={setNewTitle}
                editable={!isSubmitting}
                maxLength={220}
                selectionColor={colors.brand.primary}
              />
            </View>

            <View className="rounded-[22px] bg-surface-muted px-4 py-3">
              <Text className="text-xs2 font-semibold uppercase tracking-[1px] text-text-muted">
                Description · optional
              </Text>
              <TextInput
                className="mt-1 min-h-20 text-base2 leading-5 text-text-primary"
                placeholder="What should viewers expect from this series?"
                placeholderTextColor={colors.text.tertiary}
                value={newDescription}
                onChangeText={setNewDescription}
                editable={!isSubmitting}
                maxLength={2000}
                multiline
                textAlignVertical="top"
                selectionColor={colors.brand.primary}
              />
            </View>

            <Text className="mt-2 text-xs2 font-semibold uppercase tracking-[1px] text-text-muted">
              Audience
            </Text>
            <View className="flex-row gap-2">
              {visibilityOptions.map((option) => {
                const selected = newVisibility === option.value
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option.label} series visibility`}
                    className={
                      selected
                        ? 'min-h-12 flex-1 items-center justify-center rounded-[18px] bg-brand px-2'
                        : 'min-h-12 flex-1 items-center justify-center rounded-[18px] bg-surface-muted px-2'
                    }
                    disabled={isSubmitting}
                    onPress={() => setNewVisibility(option.value)}
                  >
                    <MaterialIcons
                      name={option.icon}
                      size={18}
                      color={selected ? '#FFFFFF' : colors.text.primary}
                    />
                    <Text
                      className={
                        selected
                          ? 'mt-1 text-xs2 font-semibold text-white'
                          : 'mt-1 text-xs2 font-semibold text-text-primary'
                      }
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <Pressable
              accessibilityLabel="Create series"
              accessibilityRole="button"
              className={
                newTitle.trim() && !isSubmitting
                  ? 'mt-2 min-h-12 items-center justify-center rounded-[20px] bg-brand px-5'
                  : 'mt-2 min-h-12 items-center justify-center rounded-[20px] bg-border-light px-5'
              }
              disabled={!newTitle.trim() || isSubmitting}
              onPress={handleCreate}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className="font-semibold text-white">Create series</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View className="mt-5">
            <Pressable
              accessibilityLabel="Create a new series"
              accessibilityRole="button"
              className="min-h-14 flex-row items-center rounded-[22px] border border-brand-soft bg-surface-accent px-4 py-3"
              disabled={isSubmitting}
              onPress={() => setMode('create')}
            >
              <View className="h-11 w-11 items-center justify-center rounded-[16px] bg-white">
                <MaterialIcons name="add" size={22} color={colors.brand.primary} />
              </View>
              <View className="ml-3 flex-1">
                <Text className="font-medium text-md text-text-primary">Create new series</Text>
                <Text className="mt-0.5 text-sm2 text-text-secondary">
                  Start a fresh episode collection
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={21} color={colors.text.tertiary} />
            </Pressable>

            {allowNone ? (
              <Pressable
                accessibilityLabel="Do not add this reel to a series"
                accessibilityRole="button"
                accessibilityState={{ selected: !selectedSeriesId }}
                className="mt-3 min-h-14 flex-row items-center rounded-[22px] bg-surface-muted px-4 py-3"
                disabled={isSubmitting}
                onPress={() => void closeAfter(() => onSelect(null))}
              >
                <View className="h-11 w-11 items-center justify-center rounded-[16px] bg-white">
                  <MaterialIcons
                    name="remove-circle-outline"
                    size={21}
                    color={colors.text.primary}
                  />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="font-medium text-md text-text-primary">No series</Text>
                  <Text className="mt-0.5 text-sm2 text-text-secondary">
                    Keep this reel standalone
                  </Text>
                </View>
                {!selectedSeriesId ? (
                  <MaterialIcons name="check-circle" size={21} color={colors.brand.primary} />
                ) : null}
              </Pressable>
            ) : null}

            <Text className="mb-3 mt-5 text-xs2 font-semibold uppercase tracking-[1.1px] text-text-muted">
              Your series
            </Text>

            {isPending ? (
              <View className="items-center py-8">
                <ActivityIndicator color={colors.brand.primary} />
                <Text className="mt-3 text-sm2 text-text-secondary">Loading your series…</Text>
              </View>
            ) : isError ? (
              <Pressable
                accessibilityLabel="Retry loading series"
                accessibilityRole="button"
                className="items-center rounded-[22px] bg-surface-muted px-5 py-6"
                onPress={() => void refetch()}
              >
                <MaterialIcons name="refresh" size={24} color={colors.brand.primary} />
                <Text className="mt-2 font-medium text-base2 text-text-primary">
                  Try loading again
                </Text>
              </Pressable>
            ) : series.length === 0 ? (
              <View className="items-center rounded-[22px] bg-surface-muted px-5 py-7">
                <MaterialIcons name="video-library" size={28} color={colors.text.tertiary} />
                <Text className="mt-3 font-medium text-base2 text-text-primary">No series yet</Text>
                <Text className="mt-1 text-center text-sm2 text-text-secondary">
                  Create one when you want your reels to play as episodes.
                </Text>
              </View>
            ) : (
              <View className="gap-2">
                {series.map((item) => {
                  const selected = selectedSeriesId === item.id
                  const cover = item.reels.find((reel) => reel.thumbnailUrl)?.thumbnailUrl
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityLabel={`Select ${item.title}, ${item.reels.length} episodes, ${visibilityLabel(item.visibility)}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      className={
                        selected
                          ? 'min-h-16 flex-row items-center rounded-[22px] border border-brand-soft bg-surface-accent px-3 py-3'
                          : 'min-h-16 flex-row items-center rounded-[22px] bg-surface-muted px-3 py-3'
                      }
                      disabled={isSubmitting}
                      onPress={() => void closeAfter(() => onSelect(item))}
                    >
                      <View className="h-14 w-11 overflow-hidden rounded-[14px] bg-white">
                        {cover ? (
                          <Image
                            source={{ uri: cover }}
                            contentFit="cover"
                            style={{ width: 44, height: 56 }}
                          />
                        ) : (
                          <View className="flex-1 items-center justify-center">
                            <MaterialIcons
                              name="video-library"
                              size={20}
                              color={colors.text.tertiary}
                            />
                          </View>
                        )}
                      </View>
                      <View className="ml-3 min-w-0 flex-1">
                        <Text className="font-medium text-md text-text-primary" numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text className="mt-1 text-sm2 text-text-secondary">
                          {item.reels.length} {item.reels.length === 1 ? 'episode' : 'episodes'} ·{' '}
                          {visibilityLabel(item.visibility)}
                        </Text>
                      </View>
                      <MaterialIcons
                        name={selected ? 'check-circle' : 'chevron-right'}
                        size={21}
                        color={selected ? colors.brand.primary : colors.text.tertiary}
                      />
                    </Pressable>
                  )
                })}
              </View>
            )}

            {hasNextPage ? (
              <Pressable
                accessibilityLabel="Load more series"
                accessibilityRole="button"
                className="mt-3 min-h-11 items-center justify-center rounded-full bg-surface-muted px-5"
                disabled={isFetchingNextPage}
                onPress={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? (
                  <ActivityIndicator color={colors.brand.primary} size="small" />
                ) : (
                  <Text className="font-medium text-sm2 text-text-primary">Load more</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
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
