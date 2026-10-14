import { Image } from 'expo-image'
import React, { useEffect, useMemo } from 'react'
import { View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'

import { colors } from '../../../constants/theme'
import { getCoverScale, getCropTransformFromRect } from '../../../lib/reel-crop-geometry'

import { CropGridOverlay } from './crop-grid-overlay'
import { TrimmedReelVideo } from './trimmed-reel-video'

import type { CropGeometry, CropTransform } from '../../../lib/reel-crop-geometry'
import type { ReelCrop, ReelFramingMode, ReelTrim } from '../../../types/reel-creator'
import type { ReelVideoHandle, ReelVideoProgress } from '../ReelVideo'
import type { SharedValue } from 'react-native-reanimated'

type CropPreviewProps = {
  geometry: CropGeometry
  framing: ReelFramingMode
  gridOpacity: SharedValue<number>
  playbackRange?: ReelTrim | null | undefined
  posterUri?: string | null
  videoRef?: React.Ref<ReelVideoHandle> | undefined
  scale: SharedValue<number>
  shouldPlay: boolean
  externallyManagedPlayback?: boolean
  resetOnPause?: boolean
  seekRelativeToTrim?: boolean
  translateX: SharedValue<number>
  translateY: SharedValue<number>
  uri: string
  muted?: boolean
  playbackRate?: number
  onProgress?: (progress: ReelVideoProgress) => void
  onReady?: () => void
  onError?: () => void
}

export function CropPreview({
  geometry,
  framing,
  gridOpacity,
  playbackRange,
  posterUri,
  videoRef,
  scale,
  shouldPlay,
  externallyManagedPlayback,
  resetOnPause,
  seekRelativeToTrim,
  translateX,
  translateY,
  uri,
  muted = false,
  playbackRate,
  onProgress,
  onReady,
  onError,
}: CropPreviewProps) {
  const coverScale = getCoverScale(
    geometry.sourceWidth,
    geometry.sourceHeight,
    geometry.viewportWidth,
    geometry.viewportHeight,
  )
  const layerWidth = geometry.sourceWidth * coverScale
  const layerHeight = geometry.sourceHeight * coverScale
  const translationStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }))
  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  if (framing === 'fit') {
    return (
      <View
        style={{
          width: geometry.viewportWidth,
          height: geometry.viewportHeight,
          overflow: 'hidden',
          backgroundColor: colors.reel.ink,
          borderRadius: 28,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.14)',
        }}
      >
        <TrimmedReelVideo
          uri={uri}
          {...(posterUri ? { posterUri } : {})}
          shouldPlay={shouldPlay}
          loop
          muted={muted}
          {...(playbackRate !== undefined ? { playbackRate } : {})}
          contentFit="contain"
          playbackRange={playbackRange}
          {...(externallyManagedPlayback !== undefined ? { externallyManagedPlayback } : {})}
          {...(resetOnPause !== undefined ? { resetOnPause } : {})}
          {...(seekRelativeToTrim !== undefined ? { seekRelativeToTrim } : {})}
          {...(onReady ? { onReady } : {})}
          {...(onError ? { onError } : {})}
          ref={videoRef}
          style={{ width: '100%', height: '100%', backgroundColor: colors.reel.ink }}
          {...(onProgress ? { onProgress } : {})}
        />
      </View>
    )
  }

  return (
    <View
      style={{
        width: geometry.viewportWidth,
        height: geometry.viewportHeight,
        overflow: 'hidden',
        backgroundColor: colors.reel.ink,
        borderRadius: 28,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.22)',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: layerWidth,
            height: layerHeight,
            left: (geometry.viewportWidth - layerWidth) / 2,
            top: (geometry.viewportHeight - layerHeight) / 2,
          },
          translationStyle,
        ]}
      >
        <Animated.View style={[{ width: layerWidth, height: layerHeight }, scaleStyle]}>
          <TrimmedReelVideo
            uri={uri}
            {...(posterUri ? { posterUri } : {})}
            shouldPlay={shouldPlay}
            loop
            muted={muted}
            {...(playbackRate !== undefined ? { playbackRate } : {})}
            contentFit="cover"
            disableOrientationAwareContentFit
            playbackRange={playbackRange}
            {...(externallyManagedPlayback !== undefined ? { externallyManagedPlayback } : {})}
            {...(resetOnPause !== undefined ? { resetOnPause } : {})}
            {...(seekRelativeToTrim !== undefined ? { seekRelativeToTrim } : {})}
            {...(onReady ? { onReady } : {})}
            {...(onError ? { onError } : {})}
            ref={videoRef}
            style={{ width: '100%', height: '100%', backgroundColor: colors.reel.ink }}
            {...(onProgress ? { onProgress } : {})}
          />
        </Animated.View>
      </Animated.View>

      <CropGridOverlay opacity={gridOpacity} />
    </View>
  )
}

export function CommittedCropPreview({
  crop,
  geometry,
  muted,
  playbackRate,
  playbackRange,
  posterUri,
  shouldPlay,
  uri,
  videoRef,
  onProgress,
  externallyManagedPlayback,
  resetOnPause,
  seekRelativeToTrim,
  onReady,
  onError,
}: {
  crop: ReelCrop
  geometry: CropGeometry
  muted?: boolean
  playbackRate?: number
  playbackRange?: ReelTrim | null | undefined
  posterUri?: string | null
  shouldPlay: boolean
  uri: string
  videoRef?: React.Ref<ReelVideoHandle> | undefined
  onProgress?: (progress: ReelVideoProgress) => void
  externallyManagedPlayback?: boolean
  resetOnPause?: boolean
  seekRelativeToTrim?: boolean
  onReady?: () => void
  onError?: () => void
}) {
  const transform = useMemo(() => getCropTransformFromRect(crop, geometry), [crop, geometry])
  const scale = useSharedValue(transform.scale)
  const translateX = useSharedValue(transform.translateX)
  const translateY = useSharedValue(transform.translateY)
  const gridOpacity = useSharedValue(0)

  useEffect(() => {
    scale.value = transform.scale
    translateX.value = transform.translateX
    translateY.value = transform.translateY
  }, [scale, transform, translateX, translateY])

  return (
    <CropPreview
      geometry={geometry}
      framing="crop"
      gridOpacity={gridOpacity}
      playbackRange={playbackRange}
      {...(posterUri ? { posterUri } : {})}
      videoRef={videoRef}
      scale={scale}
      shouldPlay={shouldPlay}
      {...(externallyManagedPlayback !== undefined ? { externallyManagedPlayback } : {})}
      {...(resetOnPause !== undefined ? { resetOnPause } : {})}
      {...(seekRelativeToTrim !== undefined ? { seekRelativeToTrim } : {})}
      translateX={translateX}
      translateY={translateY}
      uri={uri}
      muted={muted ?? false}
      {...(playbackRate !== undefined ? { playbackRate } : {})}
      {...(onProgress ? { onProgress } : {})}
      {...(onReady ? { onReady } : {})}
      {...(onError ? { onError } : {})}
    />
  )
}

type CropThumbnailProps = {
  crop?: ReelCrop | null
  framing?: ReelFramingMode
  height: number
  sourceHeight: number
  sourceWidth: number
  uri: string
  width: number
  contentFit?: 'cover' | 'contain'
}

export function CropThumbnail({
  crop,
  framing = 'fit',
  height,
  sourceHeight,
  sourceWidth,
  uri,
  width,
  contentFit = 'cover',
}: CropThumbnailProps) {
  if (framing !== 'crop' || !crop) {
    return (
      <Image
        source={{ uri }}
        contentFit={contentFit}
        style={{ width, height, backgroundColor: colors.reel.ink }}
      />
    )
  }

  const geometry: CropGeometry = {
    sourceWidth,
    sourceHeight,
    viewportWidth: width,
    viewportHeight: height,
  }
  const coverScale = getCoverScale(sourceWidth, sourceHeight, width, height)
  const layerWidth = sourceWidth * coverScale
  const layerHeight = sourceHeight * coverScale
  const transform: CropTransform = getCropTransformFromRect(crop, geometry)

  return (
    <View style={{ width, height, overflow: 'hidden', backgroundColor: colors.reel.ink }}>
      <View
        style={{
          position: 'absolute',
          width: layerWidth,
          height: layerHeight,
          left: (width - layerWidth) / 2,
          top: (height - layerHeight) / 2,
          transform: [{ translateX: transform.translateX }, { translateY: transform.translateY }],
        }}
      >
        <View
          style={{
            width: layerWidth,
            height: layerHeight,
            transform: [{ scale: transform.scale }],
          }}
        >
          <Image source={{ uri }} contentFit="cover" style={{ width: '100%', height: '100%' }} />
        </View>
      </View>
    </View>
  )
}
