import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '../../../constants/theme'
import { getCreatorPreviewContentFit } from '../../../lib/reel-creator'
import { getTrimDurationMs, formatTrimDurationLabel } from '../../../lib/reel-trim-geometry'
import { formatDurationLabel } from '../../../lib/reels'

import { CropEditor } from './crop-editor'
import { CommittedCropPreview, CropThumbnail } from './crop-preview'
import { EditorToolbar } from './editor-toolbar'
import { GlassIconButton } from './shared-ui'
import { TrimEditor } from './trim-editor'
import { TrimmedReelVideo } from './trimmed-reel-video'

import type { ReelCreatorController } from '../../../hooks/useReelCreator'
import type { CropGeometry } from '../../../lib/reel-crop-geometry'
import type { ReelEditState } from '../../../types/reel-creator'

export function EditorStage({ controller }: { controller: ReelCreatorController }) {
  const insets = useSafeAreaInsets()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const { commitEditState, pulseHaptic } = controller
  const [isPreviewPaused, setIsPreviewPaused] = React.useState(false)
  const [isCropEditing, setIsCropEditing] = React.useState(false)
  const [isTrimEditing, setIsTrimEditing] = React.useState(false)
  const [videoDuration, setVideoDuration] = React.useState(0)
  const horizontalPadding = windowWidth < 380 ? 16 : 20
  const safeContentHeight = Math.max(0, windowHeight - insets.top - insets.bottom - 24)
  const headerHeight = 52
  const timelineHeight = windowHeight < 720 ? 220 : 228
  const previewAvailableHeight = Math.max(
    220,
    safeContentHeight - headerHeight - timelineHeight - 20,
  )
  const maxPreviewWidth = windowWidth - horizontalPadding * 2
  const portraitWidthForAvailableHeight = previewAvailableHeight * (9 / 16)
  const previewWidth = Math.min(maxPreviewWidth, Math.max(264, portraitWidthForAvailableHeight))
  const previewHeight = Math.min(previewAvailableHeight, previewWidth * (16 / 9))
  const previewContentFit = getCreatorPreviewContentFit(controller.selectedAsset)
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
      : videoDuration > 0
        ? videoDuration * 1000
        : (controller.selectedAsset?.duration ?? 0)
  const displayedDurationMs = getTrimDurationMs(controller.editState.trim, sourceDurationMs)
  const displayedPositionMs = controller.editState.trim
    ? Math.min(
        displayedDurationMs,
        Math.max(0, controller.videoPlaybackPosition * 1000 - controller.editState.trim.startMs),
      )
    : Math.max(controller.videoPlaybackPosition, 0) * 1000
  const durationLabel = formatDurationLabel(displayedDurationMs) || '0:00'
  const positionLabel = formatDurationLabel(displayedPositionMs) || '0:00'

  React.useEffect(() => {
    setIsPreviewPaused(false)
    setIsCropEditing(false)
    setIsTrimEditing(false)
    setVideoDuration(0)
  }, [controller.selectedAsset?.uri])

  const handleOpenCropEditor = React.useCallback(() => {
    pulseHaptic()
    setIsCropEditing(true)
  }, [pulseHaptic])

  const handleCancelCropEditor = React.useCallback(() => {
    setIsCropEditing(false)
  }, [])

  const handleOpenTrimEditor = React.useCallback(() => {
    pulseHaptic()
    setIsTrimEditing(true)
  }, [pulseHaptic])

  const handleCancelTrimEditor = React.useCallback(() => {
    setIsTrimEditing(false)
  }, [])

  const handleDoneCropEditor = React.useCallback(
    (nextEditState: ReelEditState) => {
      commitEditState(nextEditState)
      setIsCropEditing(false)
    },
    [commitEditState],
  )

  const handleDoneTrimEditor = React.useCallback(
    (nextEditState: ReelEditState) => {
      commitEditState(nextEditState)
      setIsTrimEditing(false)
    },
    [commitEditState],
  )

  if (!controller.selectedAsset) {
    return null
  }

  if (isCropEditing) {
    return (
      <CropEditor
        controller={controller}
        onCancel={handleCancelCropEditor}
        onDone={handleDoneCropEditor}
      />
    )
  }

  if (isTrimEditing) {
    return (
      <TrimEditor
        controller={controller}
        onCancel={handleCancelTrimEditor}
        onDone={handleDoneTrimEditor}
      />
    )
  }

  const previewGeometry: CropGeometry = {
    sourceWidth,
    sourceHeight,
    viewportWidth: previewWidth,
    viewportHeight: previewHeight,
  }

  return (
    <Animated.View
      className="flex-1 bg-reel-canvas"
      entering={FadeIn.duration(180)}
      style={{
        paddingHorizontal: horizontalPadding,
        paddingTop: insets.top + 12,
        paddingBottom: Math.max(insets.bottom + 12, 12),
      }}
    >
      <View className="justify-center" style={{ height: headerHeight }}>
        <View className="absolute left-0 z-10">
          <GlassIconButton icon="arrow-back" tone="light" onPress={controller.goToCaptureStage} />
        </View>

        <View className="absolute left-16 right-24 items-center">
          <Text
            className="text-xs2 uppercase tracking-[1.2px]"
            style={{ color: colors.reel.inkSecondary }}
          >
            Preview
          </Text>
          <Text
            className="mt-1 font-heading text-[22px]"
            style={{ color: colors.reel.ink }}
            numberOfLines={1}
          >
            Preview clip
          </Text>
        </View>

        <TouchableOpacity
          className="absolute right-0 rounded-full bg-reel-accent px-5 py-3"
          activeOpacity={0.84}
          onPress={controller.goToPublishStage}
        >
          <Text style={{ color: colors.text.inverse, fontWeight: '700' }}>Next</Text>
        </TouchableOpacity>
      </View>

      <View className="mt-2 items-center">
        <View
          className="overflow-hidden rounded-[30px] border border-[#E5D8CC] bg-reel-ink"
          style={{
            width: previewWidth,
            height: previewHeight,
            shadowColor: 'rgba(86, 58, 35, 0.16)',
            shadowOffset: { width: 0, height: 18 },
            shadowOpacity: 1,
            shadowRadius: 30,
            elevation: 6,
          }}
        >
          {controller.editState.framing === 'crop' && controller.editState.crop ? (
            <CommittedCropPreview
              crop={controller.editState.crop}
              geometry={previewGeometry}
              {...(controller.previewThumbnailUri
                ? { posterUri: controller.previewThumbnailUri }
                : {})}
              playbackRange={controller.editState.trim}
              shouldPlay={!isPreviewPaused}
              muted={controller.isPreviewMuted}
              uri={controller.selectedAsset.uri}
              onProgress={(progress) => {
                if (progress.duration > 0 && videoDuration === 0) {
                  setVideoDuration(progress.duration)
                }
                controller.handleEditorProgress(progress)
              }}
            />
          ) : (
            <TrimmedReelVideo
              uri={controller.selectedAsset.uri}
              {...(controller.previewThumbnailUri
                ? { posterUri: controller.previewThumbnailUri }
                : {})}
              shouldPlay={!isPreviewPaused}
              loop
              muted={controller.isPreviewMuted}
              contentFit={previewContentFit}
              playbackRange={controller.editState.trim}
              onProgress={(progress) => {
                if (progress.duration > 0 && videoDuration === 0) {
                  setVideoDuration(progress.duration)
                }
                controller.handleEditorProgress(progress)
              }}
              style={{ width: '100%', height: '100%', backgroundColor: colors.reel.ink }}
            />
          )}

          <View className="absolute inset-x-0 bottom-0 px-3 pb-3">
            <View className="flex-row items-center justify-between rounded-full bg-white/92 px-3 py-2">
              <Text style={{ color: colors.reel.ink, fontSize: 12, fontWeight: '700' }}>
                {positionLabel} / {durationLabel}
              </Text>
              <View className="flex-row gap-2">
                <TouchableOpacity
                  className="h-9 w-9 items-center justify-center rounded-full bg-reel-ink"
                  activeOpacity={0.84}
                  onPress={controller.togglePreviewMuted}
                >
                  <MaterialIcons
                    name={controller.isPreviewMuted ? 'volume-off' : 'volume-up'}
                    size={18}
                    color={colors.text.inverse}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  className="h-9 w-9 items-center justify-center rounded-full bg-reel-accent"
                  activeOpacity={0.84}
                  onPress={() => {
                    setIsPreviewPaused((current) => !current)
                  }}
                >
                  <MaterialIcons
                    name={isPreviewPaused ? 'play-arrow' : 'pause'}
                    size={20}
                    color={colors.text.inverse}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </View>

      <View
        className="mt-2 rounded-[24px] border border-[#E6DAD0] bg-white px-3 py-3"
        style={{ height: timelineHeight }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="font-heading text-lg" style={{ color: colors.reel.ink }}>
              Timeline
            </Text>
            <Text
              className="mt-0.5 text-xs2"
              style={{ color: colors.reel.inkSecondary }}
              numberOfLines={1}
            >
              {controller.orientationMessage}
            </Text>
          </View>

          <View className="flex-row items-center gap-2">
            {controller.editState.trim ? (
              <View className="rounded-full bg-brand-soft px-2.5 py-2">
                <Text style={{ color: colors.brand.tertiary, fontSize: 11, fontWeight: '700' }}>
                  Trimmed • {formatTrimDurationLabel(displayedDurationMs)}
                </Text>
              </View>
            ) : null}
            <View className="rounded-full bg-brand-soft px-3 py-2">
              <Text style={{ color: colors.brand.tertiary, fontWeight: '700' }}>
                {controller.selectedAssetType
                  ? controller.selectedAssetType.replace('video/', '').toUpperCase()
                  : 'VIDEO'}
              </Text>
            </View>
          </View>
        </View>

        <EditorToolbar
          isCropActive={controller.editState.framing === 'crop'}
          isTrimActive={Boolean(controller.editState.trim)}
          onCrop={handleOpenCropEditor}
          onTrim={handleOpenTrimEditor}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2"
          contentContainerStyle={{ gap: 8 }}
        >
          {(controller.timelineFrames.length > 0
            ? controller.timelineFrames
            : [{ uri: controller.selectedAsset.uri, timeMs: 0 }]
          ).map((frame, index) => (
            <View
              key={`${frame.uri}-${frame.timeMs}-${index}`}
              className="overflow-hidden rounded-[16px] border border-reel-border bg-reel-canvas"
            >
              <CropThumbnail
                uri={frame.uri}
                crop={controller.editState.crop}
                framing={controller.editState.framing}
                sourceWidth={sourceWidth}
                sourceHeight={sourceHeight}
                contentFit={previewContentFit}
                width={windowHeight < 720 ? 48 : 54}
                height={windowHeight < 720 ? 58 : 66}
              />
            </View>
          ))}
        </ScrollView>
      </View>
    </Animated.View>
  )
}
