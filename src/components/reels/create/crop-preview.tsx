import { Image } from 'expo-image'
import React, { useEffect, useMemo } from 'react'
import { View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'

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
  translateX: SharedValue<number>
  translateY: SharedValue<number>
  uri: string
  muted?: boolean
  onProgress?: (progress: ReelVideoProgress) => void
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
  translateX,
  translateY,
  uri,
  muted = false,
  onProgress,
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
          backgroundColor: '#17120F',
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
          contentFit="contain"
          playbackRange={playbackRange}
          ref={videoRef}
          style={{ width: '100%', height: '100%', backgroundColor: '#17120F' }}
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
        backgroundColor: '#17120F',
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
            contentFit="cover"
            disableOrientationAwareContentFit
            playbackRange={playbackRange}
            ref={videoRef}
            style={{ width: '100%', height: '100%', backgroundColor: '#17120F' }}
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
  playbackRange,
  posterUri,
  shouldPlay,
  uri,
  videoRef,
  onProgress,
}: {
  crop: ReelCrop
  geometry: CropGeometry
  muted?: boolean
  playbackRange?: ReelTrim | null | undefined
  posterUri?: string | null
  shouldPlay: boolean
  uri: string
  videoRef?: React.Ref<ReelVideoHandle> | undefined
  onProgress?: (progress: ReelVideoProgress) => void
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
      translateX={translateX}
      translateY={translateY}
      uri={uri}
      muted={muted ?? false}
      {...(onProgress ? { onProgress } : {})}
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
        style={{ width, height, backgroundColor: '#17120F' }}
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
    <View style={{ width, height, overflow: 'hidden', backgroundColor: '#17120F' }}>
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
