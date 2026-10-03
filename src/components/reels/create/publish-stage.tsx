import { MaterialIcons } from '@expo/vector-icons'
import React, { useRef } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { BottomSheetModal } from '@gorhom/bottom-sheet'

import { MAX_CAPTION_LENGTH } from '../../../constants/reel-creator'
import { colors } from '../../../constants/theme'
import { getCreatorPreviewContentFit } from '../../../lib/reel-creator'
import { formatTrimDurationLabel, getTrimDurationMs } from '../../../lib/reel-trim-geometry'
import { ReelSeriesPickerSheet } from '../series/ReelSeriesPickerSheet'

import { CropThumbnail } from './crop-preview'
import { GlassIconButton } from './shared-ui'

import type { ReelCreatorController } from '../../../hooks/useReelCreator'
import type { ReelVisibility } from '../../../types/reel.types'

const visibilityOptions: {
  icon: keyof typeof MaterialIcons.glyphMap
  label: string
  value: ReelVisibility
}[] = [
  { icon: 'public', label: 'Public', value: 'public' },
  { icon: 'group', label: 'Friends', value: 'friends' },
  { icon: 'lock-outline', label: 'Private', value: 'private' },
]

export function PublishStage({ controller }: { controller: ReelCreatorController }) {
  const insets = useSafeAreaInsets()
  const seriesSheetRef = useRef<BottomSheetModal>(null)
  const previewContentFit = getCreatorPreviewContentFit(controller.selectedAsset)
  const isCropActive = controller.editState.framing === 'crop' && controller.editState.crop
  const sourceWidth =
    controller.selectedAsset?.width && controller.selectedAsset.width > 0
      ? controller.selectedAsset.width
      : 1080
  const sourceHeight =
    controller.selectedAsset?.height && controller.selectedAsset.height > 0
      ? controller.selectedAsset.height
      : 1920
  const sourceDurationMs =
    controller.videoDurationSeconds > 0
      ? controller.videoDurationSeconds * 1000
      : (controller.selectedAsset?.duration ?? 0)
  const editSummary = [
    controller.editState.trim
      ? `${formatTrimDurationLabel(getTrimDurationMs(controller.editState.trim, sourceDurationMs))} • Trimmed`
      : null,
    isCropActive ? '9:16 crop applied' : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' • ')
  const draftButtonLabel =
    controller.draftSaveStatus === 'saving'
      ? 'Saving...'
      : controller.draftSaveStatus === 'saved'
        ? 'Saved'
        : 'Draft'

  if (!controller.selectedAsset) {
    return null
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-reel-canvas"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <Animated.View
        className="flex-1 bg-reel-canvas px-5"
        entering={FadeIn.duration(180)}
        style={{
          paddingTop: insets.top + 12,
          paddingBottom: Math.max(insets.bottom + 12, 12),
        }}
      >
        <View className="min-h-[56px] justify-center">
          <View className="absolute left-0 z-10">
            <GlassIconButton icon="arrow-back" tone="light" onPress={controller.goToEditStage} />
          </View>

          <View className="absolute left-16 right-24 items-center">
            <Text
              className="text-xs2 uppercase tracking-[1.2px]"
              style={{ color: colors.reel.inkSecondary }}
            >
              Publish
            </Text>
            <Text
              className="mt-1 font-heading text-[22px]"
              style={{ color: colors.reel.ink }}
              numberOfLines={1}
            >
              Finish reel
            </Text>
          </View>

          <TouchableOpacity
            className={`absolute right-0 rounded-full px-4 py-2.5 ${
              controller.draftSaveStatus === 'saved' ? 'bg-[#EAF8ED]' : 'bg-white'
            }`}
            activeOpacity={0.84}
            disabled={controller.draftSaveStatus === 'saving'}
            onPress={() => {
              void controller.handleSaveDraftManually()
            }}
            style={{
              shadowColor: 'rgba(86, 58, 35, 0.12)',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 1,
              shadowRadius: 18,
              elevation: 3,
            }}
          >
            <Text
              style={{
                color: controller.draftSaveStatus === 'saved' ? '#2C7A3F' : colors.reel.ink,
                fontWeight: '800',
              }}
            >
              {draftButtonLabel}
            </Text>
          </TouchableOpacity>
        </View>

        <View className="mt-3 rounded-[28px] bg-white p-3">
          <View className="flex-row items-center">
            <View className="overflow-hidden rounded-[18px] border border-reel-border bg-reel-ink">
              {controller.previewThumbnailUri ? (
                <CropThumbnail
                  uri={controller.previewThumbnailUri}
                  crop={controller.editState.crop}
                  framing={controller.editState.framing}
                  sourceWidth={sourceWidth}
                  sourceHeight={sourceHeight}
                  contentFit={previewContentFit}
                  width={58}
                  height={82}
                />
              ) : (
                <View className="h-[82px] w-[58px] items-center justify-center bg-reel-canvas">
                  <MaterialIcons name="movie" size={20} color={colors.reel.ink} />
                </View>
              )}
            </View>

            <View className="ml-3 flex-1">
              <Text style={{ color: colors.reel.ink, fontWeight: '800' }} numberOfLines={1}>
                Clip ready
              </Text>
              <Text
                className="mt-1 text-xs2 leading-4"
                style={{ color: colors.reel.inkSecondary }}
                numberOfLines={2}
              >
                {editSummary || controller.orientationMessage}
              </Text>
              {isCropActive ? (
                <View className="mt-2 self-start rounded-full bg-brand-soft px-2.5 py-1.5">
                  <Text style={{ color: colors.brand.tertiary, fontSize: 11, fontWeight: '800' }}>
                    Crop ✓
                  </Text>
                </View>
              ) : null}
              <View className="mt-2 flex-row gap-2">
                <TouchableOpacity
                  className="rounded-full bg-reel-canvas px-3 py-2"
                  activeOpacity={0.84}
                  onPress={controller.goToCaptureStage}
                >
                  <Text style={{ color: colors.reel.ink, fontSize: 12, fontWeight: '800' }}>
                    Replace
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="rounded-full bg-brand-soft px-3 py-2"
                  activeOpacity={0.84}
                  onPress={controller.handleDiscardDraft}
                >
                  <Text style={{ color: colors.brand.tertiary, fontSize: 12, fontWeight: '800' }}>
                    Discard
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        <View className="mt-3 min-h-0 flex-1 rounded-[28px] bg-white px-4 py-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-heading text-lg" style={{ color: colors.reel.ink }}>
              Details
            </Text>
            <Text style={{ color: 'rgba(46,36,30,0.48)', fontSize: 12 }}>
              {controller.caption.length}/{MAX_CAPTION_LENGTH}
            </Text>
          </View>

          <View className="mt-3 rounded-[22px] bg-reel-canvas px-4 py-3">
            <Text style={{ color: colors.reel.inkStrong, fontSize: 12, fontWeight: '800' }}>
              Title
            </Text>
            <TextInput
              className="mt-1 text-base2"
              style={{ color: colors.reel.ink, padding: 0 }}
              placeholder="Name this reel"
              placeholderTextColor="rgba(46,36,30,0.38)"
              value={controller.title}
              onChangeText={controller.setTitle}
              editable={!controller.isPending}
              selectionColor={colors.reel.accent}
            />
          </View>

          <View className="mt-3 min-h-0 flex-1 rounded-[22px] bg-reel-canvas px-4 py-3">
            <Text style={{ color: colors.reel.inkStrong, fontSize: 12, fontWeight: '800' }}>
              Caption
            </Text>
            <TextInput
              className="mt-2 min-h-0 flex-1 text-base2"
              style={{ color: colors.reel.ink, padding: 0 }}
              placeholder="Write a caption and add hashtags like #velora"
              placeholderTextColor="rgba(46,36,30,0.38)"
              multiline
              scrollEnabled
              value={controller.caption}
              onChangeText={controller.setCaption}
              editable={!controller.isPending}
              selectionColor={colors.reel.accent}
              textAlignVertical="top"
            />
          </View>

          {controller.filteredComposerSuggestions.length > 0 ? (
            <View className="mt-3">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  {controller.filteredComposerSuggestions.map((suggestion) => (
                    <TouchableOpacity
                      key={suggestion}
                      className="rounded-full bg-brand-soft px-3 py-2"
                      activeOpacity={0.84}
                      onPress={() => {
                        controller.handleInsertComposerSuggestion(suggestion)
                      }}
                    >
                      <Text
                        style={{ color: colors.brand.tertiary, fontSize: 12, fontWeight: '800' }}
                      >
                        {suggestion}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}

          <View className="mt-3">
            <Text style={{ color: colors.reel.inkStrong, fontSize: 12, fontWeight: '800' }}>
              Series
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Choose reel series"
              className="mt-2 min-h-14 flex-row items-center rounded-[22px] bg-reel-canvas px-4 py-3"
              activeOpacity={0.84}
              disabled={controller.isPending}
              onPress={() => seriesSheetRef.current?.present()}
            >
              <View className="h-11 w-11 items-center justify-center rounded-[16px] bg-white">
                <MaterialIcons
                  name={controller.seriesSelection ? 'video-library' : 'playlist-add'}
                  size={21}
                  color={colors.brand.tertiary}
                />
              </View>
              <View className="ml-3 flex-1">
                <Text style={{ color: colors.reel.ink, fontWeight: '800' }} numberOfLines={1}>
                  {controller.seriesSelection?.title ?? 'No series'}
                </Text>
                <Text className="mt-0.5 text-xs2" style={{ color: colors.reel.inkSecondary }}>
                  {controller.seriesSelection
                    ? 'This reel will publish as the next episode.'
                    : 'Keep this reel standalone or add it to a series.'}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={21} color="rgba(46,36,30,0.42)" />
            </TouchableOpacity>
          </View>

          <View className="mt-3">
            <Text style={{ color: colors.reel.inkStrong, fontSize: 12, fontWeight: '800' }}>
              Visibility
            </Text>
            {controller.seriesSelection ? (
              <View className="mt-2 min-h-12 flex-row items-center rounded-[20px] bg-brand-soft px-4 py-3">
                <MaterialIcons name="lock-outline" size={18} color={colors.brand.tertiary} />
                <View className="ml-3 flex-1">
                  <Text style={{ color: colors.reel.ink, fontWeight: '800' }}>
                    {controller.visibility === 'friends'
                      ? 'Friends'
                      : controller.visibility === 'private'
                        ? 'Private'
                        : 'Public'}
                  </Text>
                  <Text className="mt-0.5 text-xs2" style={{ color: colors.reel.inkSecondary }}>
                    Episodes in a series share the same audience.
                  </Text>
                </View>
              </View>
            ) : (
              <View className="mt-2 flex-row gap-2">
                {visibilityOptions.map((option) => {
                  const isActive = controller.visibility === option.value

                  return (
                    <TouchableOpacity
                      key={option.value}
                      className={`flex-1 flex-row items-center justify-center rounded-[18px] px-2 py-3 ${
                        isActive ? 'bg-reel-ink' : 'bg-reel-canvas'
                      }`}
                      activeOpacity={0.84}
                      disabled={controller.isPending}
                      onPress={() => controller.setVisibility(option.value)}
                    >
                      <MaterialIcons
                        name={option.icon}
                        size={17}
                        color={isActive ? colors.text.inverse : colors.reel.ink}
                      />
                      <Text
                        className="ml-2"
                        style={{
                          color: isActive ? colors.text.inverse : colors.reel.ink,
                          fontSize: 12,
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
            )}
          </View>
        </View>

        <TouchableOpacity
          className={`mt-3 rounded-[22px] px-5 py-4 ${
            controller.isPending ? 'bg-[#D9805A]' : 'bg-reel-accent'
          }`}
          activeOpacity={0.84}
          disabled={controller.isPending}
          onPress={() => {
            void controller.handlePublish()
          }}
        >
          <Text className="text-center" style={{ color: colors.text.inverse, fontWeight: '800' }}>
            {controller.isPending ? controller.publishProgressLabel : 'Publish reel'}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      <ReelSeriesPickerSheet
        sheetRef={seriesSheetRef}
        {...(controller.seriesSelection?.kind === 'existing'
          ? { selectedSeriesId: controller.seriesSelection.id }
          : {})}
        initialVisibility={controller.visibility}
        onSelect={(series) => {
          controller.setSeriesSelection(
            series
              ? {
                  kind: 'existing',
                  id: series.id,
                  title: series.title,
                  visibility: series.visibility,
                }
              : null,
          )
        }}
        onCreate={(payload) => {
          controller.setSeriesSelection({
            kind: 'new',
            title: payload.title,
            ...(payload.description ? { description: payload.description } : {}),
            visibility: payload.visibility ?? controller.visibility,
          })
        }}
      />
    </KeyboardAvoidingView>
  )
}
