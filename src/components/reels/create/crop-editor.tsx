import { MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler'
import Animated, { FadeIn, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import {
  REEL_CROP_MAX_SCALE,
  getCoverScale,
  getCropRectFromTransform,
  getCropTransformFromRect,
  getDefaultCropRect,
} from '../../../lib/reel-crop-geometry'

import { CropPreview } from './crop-preview'

import type { ReelCreatorController } from '../../../hooks/useReelCreator'
import type { CropGeometry } from '../../../lib/reel-crop-geometry'
import type { ReelEditState } from '../../../types/reel-creator'

const clampUiValue = (value: number, min: number, max: number) => {
  'worklet'
  return Math.min(max, Math.max(min, value))
}

export function CropEditor({
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
  const { editState, isPreviewMuted, previewThumbnailUri, pulseHaptic } = controller
  const [isResetToFit, setIsResetToFit] = useState(false)

  const sourceWidth = asset?.width && asset.width > 0 ? asset.width : 1080
  const sourceHeight = asset?.height && asset.height > 0 ? asset.height : 1920
  const horizontalPadding = windowWidth < 380 ? 16 : 20
  const headerHeight = 56
  const footerHeight = 124
  const availablePreviewHeight = Math.max(
    180,
    windowHeight - insets.top - insets.bottom - headerHeight - footerHeight - 64,
  )
  const viewportWidth = Math.min(
    Math.max(180, windowWidth - horizontalPadding * 2),
    availablePreviewHeight * (9 / 16),
  )
  const viewportHeight = viewportWidth * (16 / 9)
  const geometry = useMemo<CropGeometry>(
    () => ({
      sourceWidth,
      sourceHeight,
      viewportWidth,
      viewportHeight,
    }),
    [sourceHeight, sourceWidth, viewportHeight, viewportWidth],
  )
  const initialCrop = useMemo(
    () =>
      editState.framing === 'crop' && editState.crop
        ? editState.crop
        : getDefaultCropRect(sourceWidth, sourceHeight),
    [editState, sourceHeight, sourceWidth],
  )
  const initialTransform = useMemo(
    () => getCropTransformFromRect(initialCrop, geometry),
    [geometry, initialCrop],
  )
  const scale = useSharedValue(initialTransform.scale)
  const translateX = useSharedValue(initialTransform.translateX)
  const translateY = useSharedValue(initialTransform.translateY)
  const gridOpacity = useSharedValue(0)
  const panStartX = useSharedValue(initialTransform.translateX)
  const panStartY = useSharedValue(initialTransform.translateY)
  const pinchStartScale = useSharedValue(initialTransform.scale)
  const pinchStartX = useSharedValue(initialTransform.translateX)
  const pinchStartY = useSharedValue(initialTransform.translateY)
  const pinchStartFocalX = useSharedValue(0)
  const pinchStartFocalY = useSharedValue(0)

  const handleBeginAdjustments = useCallback(() => {
    setIsResetToFit(false)
  }, [])

  useEffect(() => {
    scale.value = initialTransform.scale
    translateX.value = initialTransform.translateX
    translateY.value = initialTransform.translateY
    panStartX.value = initialTransform.translateX
    panStartY.value = initialTransform.translateY
    pinchStartScale.value = initialTransform.scale
    pinchStartX.value = initialTransform.translateX
    pinchStartY.value = initialTransform.translateY
  }, [
    initialTransform,
    panStartX,
    panStartY,
    pinchStartScale,
    pinchStartX,
    pinchStartY,
    scale,
    translateX,
    translateY,
  ])

  const coverScale = getCoverScale(sourceWidth, sourceHeight, viewportWidth, viewportHeight)
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .onBegin(() => {
          'worklet'
          scheduleOnRN(handleBeginAdjustments)
          panStartX.value = translateX.value
          panStartY.value = translateY.value
          gridOpacity.value = withTiming(1, { duration: 100 })
        })
        .onUpdate((event) => {
          'worklet'
          const maxTranslateX = Math.max(
            0,
            (sourceWidth * coverScale * scale.value - viewportWidth) / 2,
          )
          const maxTranslateY = Math.max(
            0,
            (sourceHeight * coverScale * scale.value - viewportHeight) / 2,
          )
          translateX.value = clampUiValue(
            panStartX.value + event.translationX,
            -maxTranslateX,
            maxTranslateX,
          )
          translateY.value = clampUiValue(
            panStartY.value + event.translationY,
            -maxTranslateY,
            maxTranslateY,
          )
        })
        .onFinalize(() => {
          'worklet'
          gridOpacity.value = withTiming(0, { duration: 240 })
        }),
    [
      coverScale,
      gridOpacity,
      handleBeginAdjustments,
      panStartX,
      panStartY,
      scale,
      sourceHeight,
      sourceWidth,
      translateX,
      translateY,
      viewportHeight,
      viewportWidth,
    ],
  )

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin((event) => {
          'worklet'
          scheduleOnRN(handleBeginAdjustments)
          pinchStartScale.value = scale.value
          pinchStartX.value = translateX.value
          pinchStartY.value = translateY.value
          pinchStartFocalX.value = event.focalX
          pinchStartFocalY.value = event.focalY
          gridOpacity.value = withTiming(1, { duration: 100 })
        })
        .onUpdate((event) => {
          'worklet'
          const nextScale = clampUiValue(
            pinchStartScale.value * event.scale,
            1,
            REEL_CROP_MAX_SCALE,
          )
          const maxTranslateX = Math.max(
            0,
            (sourceWidth * coverScale * nextScale - viewportWidth) / 2,
          )
          const maxTranslateY = Math.max(
            0,
            (sourceHeight * coverScale * nextScale - viewportHeight) / 2,
          )
          scale.value = nextScale
          translateX.value = clampUiValue(
            pinchStartX.value + event.focalX - pinchStartFocalX.value,
            -maxTranslateX,
            maxTranslateX,
          )
          translateY.value = clampUiValue(
            pinchStartY.value + event.focalY - pinchStartFocalY.value,
            -maxTranslateY,
            maxTranslateY,
          )
        })
        .onFinalize(() => {
          'worklet'
          gridOpacity.value = withTiming(0, { duration: 240 })
        }),
    [
      coverScale,
      gridOpacity,
      handleBeginAdjustments,
      pinchStartFocalX,
      pinchStartFocalY,
      pinchStartScale,
      pinchStartX,
      pinchStartY,
      scale,
      sourceHeight,
      sourceWidth,
      translateX,
      translateY,
      viewportHeight,
      viewportWidth,
    ],
  )

  const gesture = useMemo(
    () => Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture],
  )

  const handleReset = useCallback(() => {
    const resetTransform = getCropTransformFromRect(
      getDefaultCropRect(sourceWidth, sourceHeight),
      geometry,
    )
    scale.value = resetTransform.scale
    translateX.value = resetTransform.translateX
    translateY.value = resetTransform.translateY
    setIsResetToFit(true)
    pulseHaptic(Haptics.ImpactFeedbackStyle.Light)
  }, [geometry, pulseHaptic, scale, sourceHeight, sourceWidth, translateX, translateY])

  const handleDone = useCallback(() => {
    const nextEditState: ReelEditState = isResetToFit
      ? { framing: 'fit', crop: null, trim: editState.trim }
      : {
          framing: 'crop',
          trim: editState.trim,
          crop: getCropRectFromTransform(
            { scale: scale.value, translateX: translateX.value, translateY: translateY.value },
            geometry,
          ),
        }
    onDone(nextEditState)
  }, [editState.trim, geometry, isResetToFit, onDone, scale, translateX, translateY])

  if (!asset) {
    return null
  }

  return (
    <Animated.View
      className="flex-1 bg-[#17120F]"
      entering={FadeIn.duration(160)}
      style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8) }}
    >
      <StatusBar style="light" />
      <View className="h-14 flex-row items-center justify-between px-4">
        <Pressable
          accessibilityLabel="Cancel crop changes"
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.72 : 1 }]}
        >
          <Text
            className="text-base2"
            style={{ color: 'rgba(255,255,255,0.82)', fontWeight: '700' }}
          >
            Cancel
          </Text>
        </Pressable>

        <View className="items-center">
          <Text
            className="text-xs2 uppercase tracking-[1.2px]"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            Editor
          </Text>
          <Text className="mt-0.5 font-heading text-lg" style={{ color: '#FFFFFF' }}>
            Crop video
          </Text>
        </View>

        <Pressable
          accessibilityLabel="Done with crop changes"
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

      <View style={styles.previewArea}>
        <View className="absolute inset-0 bg-black/16" pointerEvents="none" />
        <GestureDetector gesture={gesture}>
          <View>
            <CropPreview
              geometry={geometry}
              framing={isResetToFit ? 'fit' : 'crop'}
              gridOpacity={gridOpacity}
              playbackRange={editState.trim}
              {...(previewThumbnailUri ? { posterUri: previewThumbnailUri } : {})}
              scale={scale}
              shouldPlay
              translateX={translateX}
              translateY={translateY}
              uri={asset.uri}
              muted={isPreviewMuted}
            />
          </View>
        </GestureDetector>
      </View>

      <View style={[styles.footer, { minHeight: footerHeight }]}>
        <Text className="text-center text-sm2" style={{ color: 'rgba(255,255,255,0.66)' }}>
          {isResetToFit
            ? 'Fit restored • pinch or drag to crop again'
            : 'Pinch to zoom • drag to reposition'}
        </Text>
        <View style={styles.footerActions}>
          <Pressable
            accessibilityLabel="Reset crop to fit"
            accessibilityRole="button"
            onPress={handleReset}
            style={({ pressed }) => [styles.framingButton, { opacity: pressed ? 0.78 : 1 }]}
          >
            <MaterialIcons name="refresh" size={18} color="#FFFFFF" />
            <Text className="ml-2" style={{ color: '#FFFFFF', fontWeight: '800' }}>
              Reset
            </Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  footer: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 16,
    width: '100%',
  },
  framingButton: {
    alignItems: 'center',
    backgroundColor: '#FF7A45',
    borderRadius: 999,
    flex: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 160,
    paddingHorizontal: 16,
  },
  headerAction: {
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 72,
  },
  headerActionEnd: {
    alignItems: 'flex-end',
  },
  previewArea: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
})
