import { MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler'
import Animated, { FadeIn, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import { getCreatorPreviewContentFit, getTrimmedThumbnailFrame } from '../../../lib/reel-creator'
import {
  MIN_TRIM_DURATION_MS,
  clampTrimRange,
  formatTrimDurationLabel,
  formatTrimTime,
  getTrimRange,
  sanitizeTrim,
  timeMsToTimelineX,
  timelineXToTimeMs,
} from '../../../lib/reel-trim-geometry'

import { CommittedCropPreview, CropThumbnail } from './crop-preview'
import { TrimmedReelVideo } from './trimmed-reel-video'

import type { ReelCreatorController } from '../../../hooks/useReelCreator'
import type { TrimRange } from '../../../lib/reel-trim-geometry'
import type { ReelEditState, ReelTrim, TimelineHandle } from '../../../types/reel-creator'
import type { ReelVideoHandle, ReelVideoProgress } from '../ReelVideo'

const HANDLE_HIT_SIZE = 48
const HANDLE_VISUAL_WIDTH = 4
const TIMELINE_HORIZONTAL_MARGIN = 24

const clampUiValue = (value: number, min: number, max: number) => {
  'worklet'
  return Math.min(max, Math.max(min, value))
}

const rangesEqual = (left: TrimRange, right: TrimRange) =>
  left.startMs === right.startMs && left.endMs === right.endMs

const getKnownDurationMs = (controller: ReelCreatorController) => {
  if (controller.videoDurationSeconds > 0) {
    return Math.round(controller.videoDurationSeconds * 1000)
  }

  return controller.selectedAsset?.duration && controller.selectedAsset.duration > 0
    ? Math.round(controller.selectedAsset.duration)
    : 0
}

export function TrimEditor({
  controller,
  onCancel,
  onDone,
}: {
  controller: ReelCreatorController
  onCancel: () => void
  onDone: (editState: ReelEditState) => void
}) {
  const insets = useSafeAreaInsets()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const asset = controller.selectedAsset
  const { pulseHaptic } = controller
  const initialDurationMs = getKnownDurationMs(controller)
  const initialRange = useMemo(
    () => getTrimRange(controller.editState.trim, initialDurationMs),
    [controller.editState.trim, initialDurationMs],
  )
  const [sourceDurationMs, setSourceDurationMs] = useState(initialDurationMs)
  const [workingRange, setWorkingRange] = useState<TrimRange>(initialRange)
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false)
  const workingRangeRef = useRef(initialRange)
  const videoRef = useRef<ReelVideoHandle | null>(null)
  const didTouchRangeRef = useRef(false)
  const forceFullRangeRef = useRef(!controller.editState.trim)

  const sourceWidth = asset?.width && asset.width > 0 ? asset.width : 1080
  const sourceHeight = asset?.height && asset.height > 0 ? asset.height : 1920
  const horizontalPadding = windowWidth < 380 ? 16 : 20
  const headerHeight = 56
  const timelineCardHeight = windowHeight < 720 ? 206 : 218
  const footerHeight = 88
  const availablePreviewHeight = Math.max(
    200,
    windowHeight -
      insets.top -
      insets.bottom -
      headerHeight -
      timelineCardHeight -
      footerHeight -
      44,
  )
  const previewWidth = Math.min(
    Math.max(220, windowWidth - horizontalPadding * 2),
    availablePreviewHeight * (9 / 16),
  )
  const previewHeight = Math.min(availablePreviewHeight, previewWidth * (16 / 9))
  const previewContentFit = getCreatorPreviewContentFit(asset)
  const previewGeometry = useMemo(
    () => ({
      sourceWidth,
      sourceHeight,
      viewportWidth: previewWidth,
      viewportHeight: previewHeight,
    }),
    [previewHeight, previewWidth, sourceHeight, sourceWidth],
  )
  const previewFrames = useMemo(
    () =>
      controller.timelineFrames.length > 0
        ? controller.timelineFrames
        : asset
          ? [{ uri: asset.uri, timeMs: 0 }]
          : [],
    [asset, controller.timelineFrames],
  )
  const previewPosterUri =
    getTrimmedThumbnailFrame(previewFrames, workingRange)?.uri ??
    (workingRange.startMs === 0 ? controller.previewThumbnailUri : null)
  const playbackRange = useMemo<ReelTrim>(
    () => ({
      version: 1,
      startMs: workingRange.startMs,
      endMs: workingRange.endMs,
    }),
    [workingRange],
  )

  const leftX = useSharedValue(0)
  const rightX = useSharedValue(0)
  const playheadX = useSharedValue(0)
  const leftStartX = useSharedValue(0)
  const rightStartX = useSharedValue(0)

  const updateWorkingRange = useCallback((nextRange: TrimRange) => {
    workingRangeRef.current = nextRange
    setWorkingRange((current) => (rangesEqual(current, nextRange) ? current : nextRange))
  }, [])

  const reconcileDuration = useCallback(
    (nextDurationMs: number) => {
      if (nextDurationMs <= 0) {
        return
      }

      setSourceDurationMs((current) => (current === nextDurationMs ? current : nextDurationMs))

      const currentRange = workingRangeRef.current
      const nextRange =
        forceFullRangeRef.current || (!didTouchRangeRef.current && !controller.editState.trim)
          ? { startMs: 0, endMs: nextDurationMs }
          : clampTrimRange(currentRange.startMs, currentRange.endMs, nextDurationMs)

      if (!rangesEqual(currentRange, nextRange)) {
        updateWorkingRange(nextRange)
      }
    },
    [controller.editState.trim, updateWorkingRange],
  )

  const handlePreviewProgress = useCallback(
    (progress: ReelVideoProgress) => {
      const observedDurationMs =
        progress.duration > 0 ? Math.round(progress.duration * 1000) : sourceDurationMs

      if (observedDurationMs > 0) {
        reconcileDuration(observedDurationMs)
      }

      if (timelineWidth > 0 && observedDurationMs > 0) {
        playheadX.value = timeMsToTimelineX(
          progress.currentTime * 1000,
          observedDurationMs,
          timelineWidth,
        )
      }
    },
    [playheadX, reconcileDuration, sourceDurationMs, timelineWidth],
  )

  useEffect(() => {
    if (timelineWidth <= 0 || sourceDurationMs <= 0) {
      return
    }

    const range = clampTrimRange(
      workingRangeRef.current.startMs,
      workingRangeRef.current.endMs,
      sourceDurationMs,
    )
    leftX.value = timeMsToTimelineX(range.startMs, sourceDurationMs, timelineWidth)
    rightX.value = timeMsToTimelineX(range.endMs, sourceDurationMs, timelineWidth)
    leftStartX.value = leftX.value
    rightStartX.value = rightX.value
    playheadX.value = timeMsToTimelineX(range.startMs, sourceDurationMs, timelineWidth)
  }, [leftStartX, leftX, playheadX, rightStartX, rightX, sourceDurationMs, timelineWidth])

  const handleDragStart = useCallback(() => {
    didTouchRangeRef.current = true
    forceFullRangeRef.current = false
    setIsPreviewPlaying(false)
    videoRef.current?.pause()
  }, [])

  const handleDragEnd = useCallback(
    (handle: TimelineHandle, x: number) => {
      if (sourceDurationMs <= 0 || timelineWidth <= 0) {
        return
      }

      const currentRange = workingRangeRef.current
      const nextTimeMs = timelineXToTimeMs(x, sourceDurationMs, timelineWidth)
      const nextRange =
        handle === 'start'
          ? clampTrimRange(nextTimeMs, currentRange.endMs, sourceDurationMs)
          : clampTrimRange(currentRange.startMs, nextTimeMs, sourceDurationMs)

      forceFullRangeRef.current = nextRange.startMs === 0 && nextRange.endMs === sourceDurationMs
      updateWorkingRange(nextRange)
      videoRef.current?.seekTo((handle === 'start' ? nextRange.startMs : nextRange.endMs) / 1000)
      pulseHaptic()
    },
    [pulseHaptic, sourceDurationMs, timelineWidth, updateWorkingRange],
  )

  const leftHandleGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(timelineWidth > 0 && sourceDurationMs >= MIN_TRIM_DURATION_MS)
        .maxPointers(1)
        .onBegin(() => {
          'worklet'
          leftStartX.value = leftX.value
          scheduleOnRN(handleDragStart)
        })
        .onUpdate((event) => {
          'worklet'
          const minRangePx =
            sourceDurationMs > 0
              ? (MIN_TRIM_DURATION_MS / sourceDurationMs) * timelineWidth
              : timelineWidth
          leftX.value = clampUiValue(
            leftStartX.value + event.translationX,
            0,
            Math.max(0, rightX.value - minRangePx),
          )
        })
        .onFinalize(() => {
          'worklet'
          scheduleOnRN(handleDragEnd, 'start', leftX.value)
        }),
    [handleDragEnd, handleDragStart, leftStartX, leftX, rightX, sourceDurationMs, timelineWidth],
  )

  const rightHandleGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(timelineWidth > 0 && sourceDurationMs >= MIN_TRIM_DURATION_MS)
        .maxPointers(1)
        .onBegin(() => {
          'worklet'
          rightStartX.value = rightX.value
          scheduleOnRN(handleDragStart)
        })
        .onUpdate((event) => {
          'worklet'
          const minRangePx =
            sourceDurationMs > 0
              ? (MIN_TRIM_DURATION_MS / sourceDurationMs) * timelineWidth
              : timelineWidth
          rightX.value = clampUiValue(
            rightStartX.value + event.translationX,
            Math.min(timelineWidth, leftX.value + minRangePx),
            timelineWidth,
          )
        })
        .onFinalize(() => {
          'worklet'
          scheduleOnRN(handleDragEnd, 'end', rightX.value)
        }),
    [handleDragEnd, handleDragStart, leftX, rightStartX, rightX, sourceDurationMs, timelineWidth],
  )

  const leftExcludedStyle = useAnimatedStyle(() => ({ width: leftX.value }))
  const rightExcludedStyle = useAnimatedStyle(() => ({
    left: rightX.value,
    width: Math.max(0, timelineWidth - rightX.value),
  }))
  const selectedRangeStyle = useAnimatedStyle(() => ({
    left: leftX.value,
    width: Math.max(0, rightX.value - leftX.value),
  }))
  const leftHandleStyle = useAnimatedStyle(() => ({ left: leftX.value - HANDLE_HIT_SIZE / 2 }))
  const rightHandleStyle = useAnimatedStyle(() => ({ left: rightX.value - HANDLE_HIT_SIZE / 2 }))
  const playheadStyle = useAnimatedStyle(() => ({ left: playheadX.value - 1 }))

  const handleReset = useCallback(() => {
    const nextRange = { startMs: 0, endMs: Math.max(0, sourceDurationMs) }
    didTouchRangeRef.current = false
    forceFullRangeRef.current = true
    updateWorkingRange(nextRange)
    leftX.value = 0
    rightX.value = timelineWidth
    playheadX.value = 0
    videoRef.current?.pause()
    videoRef.current?.seekTo(0)
    pulseHaptic(Haptics.ImpactFeedbackStyle.Light)
  }, [leftX, playheadX, pulseHaptic, rightX, sourceDurationMs, timelineWidth, updateWorkingRange])

  const handleDone = useCallback(() => {
    const range = clampTrimRange(
      workingRangeRef.current.startMs,
      workingRangeRef.current.endMs,
      sourceDurationMs,
    )
    const trim =
      sourceDurationMs > 0
        ? sanitizeTrim({ version: 1, startMs: range.startMs, endMs: range.endMs }, sourceDurationMs)
        : null

    onDone({
      framing: controller.editState.framing,
      crop: controller.editState.crop,
      trim,
    })
  }, [controller.editState, onDone, sourceDurationMs])

  if (!asset) {
    return null
  }

  const selectedDurationMs = Math.max(0, workingRange.endMs - workingRange.startMs)
  const activeCrop = controller.editState.framing === 'crop' ? controller.editState.crop : null

  return (
    <Animated.View
      className="flex-1 bg-[#F7F2EC]"
      entering={FadeIn.duration(160)}
      style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8) }}
    >
      <StatusBar style="dark" />

      <View className="h-14 flex-row items-center justify-between px-4">
        <Pressable
          accessibilityLabel="Cancel trim changes"
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.72 : 1 }]}
        >
          <Text style={{ color: 'rgba(46,36,30,0.72)', fontWeight: '700' }}>Cancel</Text>
        </Pressable>

        <View className="items-center">
          <Text
            className="text-xs2 uppercase tracking-[1.2px]"
            style={{ color: 'rgba(46,36,30,0.52)' }}
          >
            Editor
          </Text>
          <Text className="mt-0.5 font-heading text-lg" style={{ color: '#17120F' }}>
            Trim video
          </Text>
        </View>

        <Pressable
          accessibilityLabel="Done with trim changes"
          accessibilityRole="button"
          onPress={handleDone}
          style={({ pressed }) => [
            styles.headerAction,
            styles.headerActionEnd,
            { opacity: pressed ? 0.78 : 1 },
          ]}
        >
          <Text
            className="rounded-full bg-[#FF7A45] px-4 py-2.5"
            style={{ color: '#FFFFFF', fontWeight: '800' }}
          >
            Done
          </Text>
        </Pressable>
      </View>

      <View className="flex-1 justify-center px-4">
        <View
          className="self-center overflow-hidden rounded-[30px] border border-[#E5D8CC] bg-[#17120F]"
          style={{ width: previewWidth, height: previewHeight }}
        >
          {activeCrop ? (
            <CommittedCropPreview
              crop={activeCrop}
              geometry={previewGeometry}
              {...(previewPosterUri ? { posterUri: previewPosterUri } : {})}
              playbackRange={playbackRange}
              videoRef={videoRef}
              shouldPlay={isPreviewPlaying}
              muted={controller.isPreviewMuted}
              uri={asset.uri}
              onProgress={handlePreviewProgress}
            />
          ) : (
            <TrimmedReelVideo
              uri={asset.uri}
              {...(previewPosterUri ? { posterUri: previewPosterUri } : {})}
              shouldPlay={isPreviewPlaying}
              loop
              muted={controller.isPreviewMuted}
              contentFit={previewContentFit}
              playbackRange={playbackRange}
              ref={videoRef}
              onProgress={handlePreviewProgress}
              style={{ width: '100%', height: '100%', backgroundColor: '#17120F' }}
            />
          )}

          <View className="absolute inset-x-0 bottom-0 flex-row items-center justify-between px-3 pb-3">
            <View className="rounded-full bg-white/92 px-3 py-2">
              <Text style={{ color: '#17120F', fontSize: 12, fontWeight: '800' }}>
                {formatTrimDurationLabel(selectedDurationMs)} selected
              </Text>
            </View>
            <Pressable
              accessibilityLabel={isPreviewPlaying ? 'Pause trim preview' : 'Play trim preview'}
              accessibilityRole="button"
              onPress={() => {
                setIsPreviewPlaying((current) => !current)
              }}
              style={({ pressed }) => [styles.previewButton, { opacity: pressed ? 0.78 : 1 }]}
            >
              <MaterialIcons
                name={isPreviewPlaying ? 'pause' : 'play-arrow'}
                size={20}
                color="#FFFFFF"
              />
            </Pressable>
          </View>
        </View>
      </View>

      <View
        className="mx-4 rounded-[24px] border border-[#E6DAD0] bg-white px-3 py-3"
        style={{ height: timelineCardHeight }}
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="font-heading text-lg" style={{ color: '#17120F' }}>
              Choose the moment
            </Text>
            <Text className="mt-0.5 text-xs2" style={{ color: 'rgba(46,36,30,0.62)' }}>
              Drag the handles to keep one continuous clip
            </Text>
          </View>
          <View className="rounded-full bg-[#FFF0E8] px-3 py-2">
            <Text style={{ color: '#D85A21', fontSize: 12, fontWeight: '800' }}>
              {formatTrimDurationLabel(selectedDurationMs)}
            </Text>
          </View>
        </View>

        <View
          accessibilityLabel="Trim timeline"
          onLayout={(event) => {
            setTimelineWidth(Math.max(0, event.nativeEvent.layout.width))
          }}
          style={styles.timelineTrack}
        >
          <View style={styles.thumbnailStrip}>
            {previewFrames.map((frame, index) => (
              <View key={`${frame.uri}-${frame.timeMs}-${index}`} style={styles.thumbnailCell}>
                <CropThumbnail
                  uri={frame.uri}
                  crop={controller.editState.crop}
                  framing={controller.editState.framing}
                  sourceWidth={sourceWidth}
                  sourceHeight={sourceHeight}
                  contentFit={previewContentFit}
                  width={Math.max(1, timelineWidth / Math.max(1, previewFrames.length))}
                  height={72}
                />
              </View>
            ))}
          </View>

          <Animated.View pointerEvents="none" style={[styles.excludedOverlay, leftExcludedStyle]} />
          <Animated.View
            pointerEvents="none"
            style={[styles.excludedOverlay, rightExcludedStyle]}
          />
          <Animated.View pointerEvents="none" style={[styles.selectedRange, selectedRangeStyle]} />
          <Animated.View pointerEvents="none" style={[styles.playhead, playheadStyle]} />

          <GestureDetector gesture={leftHandleGesture}>
            <Animated.View
              accessible
              accessibilityLabel="Trim start handle"
              accessibilityRole="adjustable"
              style={[styles.handleHitbox, leftHandleStyle]}
            >
              <View style={styles.handleVisual} />
            </Animated.View>
          </GestureDetector>
          <GestureDetector gesture={rightHandleGesture}>
            <Animated.View
              accessible
              accessibilityLabel="Trim end handle"
              accessibilityRole="adjustable"
              style={[styles.handleHitbox, rightHandleStyle]}
            >
              <View style={styles.handleVisual} />
            </Animated.View>
          </GestureDetector>
        </View>

        <View className="mt-2 flex-row items-center justify-between">
          <Text style={{ color: '#D85A21', fontSize: 12, fontWeight: '800' }}>
            {formatTrimTime(workingRange.startMs)}
          </Text>
          <Text style={{ color: 'rgba(46,36,30,0.58)', fontSize: 12, fontWeight: '700' }}>
            {formatTrimDurationLabel(selectedDurationMs)} selected
          </Text>
          <Text style={{ color: '#D85A21', fontSize: 12, fontWeight: '800' }}>
            {formatTrimTime(workingRange.endMs)}
          </Text>
        </View>
      </View>

      <View style={[styles.footer, { minHeight: footerHeight }]}>
        <Pressable
          accessibilityLabel="Reset trim"
          accessibilityRole="button"
          onPress={handleReset}
          style={({ pressed }) => [styles.resetButton, { opacity: pressed ? 0.78 : 1 }]}
        >
          <MaterialIcons name="refresh" size={18} color="#17120F" />
          <Text className="ml-2" style={{ color: '#17120F', fontWeight: '800' }}>
            Reset
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  excludedOverlay: {
    backgroundColor: 'rgba(23,18,15,0.48)',
    bottom: 0,
    position: 'absolute',
    top: 0,
  },
  footer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  handleHitbox: {
    alignItems: 'center',
    bottom: -10,
    justifyContent: 'center',
    position: 'absolute',
    top: -10,
    width: HANDLE_HIT_SIZE,
    zIndex: 5,
  },
  handleVisual: {
    backgroundColor: '#FF7A45',
    borderRadius: 999,
    height: 92,
    width: HANDLE_VISUAL_WIDTH,
  },
  headerAction: {
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 72,
  },
  headerActionEnd: {
    alignItems: 'flex-end',
  },
  playhead: {
    backgroundColor: '#FFFFFF',
    bottom: -2,
    position: 'absolute',
    top: -2,
    width: 2,
    zIndex: 4,
  },
  previewButton: {
    alignItems: 'center',
    backgroundColor: '#FF7A45',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  resetButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E6DAD0',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 144,
    paddingHorizontal: 18,
  },
  selectedRange: {
    borderColor: '#FF7A45',
    borderRadius: 14,
    borderWidth: 3,
    bottom: 0,
    position: 'absolute',
    top: 0,
    zIndex: 3,
  },
  thumbnailCell: {
    flex: 1,
    height: 72,
    overflow: 'hidden',
  },
  thumbnailStrip: {
    borderRadius: 14,
    flex: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  timelineTrack: {
    backgroundColor: '#F7F2EC',
    borderColor: '#E9DED5',
    borderRadius: 14,
    borderWidth: 1,
    height: 72,
    marginHorizontal: TIMELINE_HORIZONTAL_MARGIN,
    marginTop: 12,
    overflow: 'visible',
    position: 'relative',
    width: '100%',
  },
})
