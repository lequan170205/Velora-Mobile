import { MaterialIcons } from '@expo/vector-icons'
import { format } from 'date-fns'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { scheduleOnRN } from 'react-native-worklets'

import { ReelVideo } from './ReelVideo'

import type { ReelVideoHandle } from './ReelVideo'
import type { Reel } from '../../types/reel.types'

interface ReelFeedItemProps {
  description?: string
  reel: Reel
  height: number
  isActive: boolean
  shouldPreload: boolean
  isMuted: boolean
  onToggleMuted: () => void
}

const SCRUBBER_TOUCH_ZONE_HEIGHT = 40
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const formatPlaybackTime = (value: number) => {
  const safeValue = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  const minutes = Math.floor(safeValue / 60)
  const seconds = safeValue % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  video: {
    backgroundColor: '#050505',
    height: '100%',
    width: '100%',
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050505',
  },
})

const getPlaybackState = (status?: string | null) => {
  const normalized = status?.trim().toLowerCase()

  if (
    !normalized ||
    normalized === 'ready' ||
    normalized === 'completed' ||
    normalized === 'published'
  ) {
    return {
      isPlayable: true,
      label: null,
    }
  }

  if (normalized === 'processing') {
    return {
      isPlayable: false,
      label: 'Processing',
    }
  }

  if (normalized === 'pending') {
    return {
      isPlayable: false,
      label: 'Queued',
    }
  }

  if (normalized === 'failed') {
    return {
      isPlayable: false,
      label: 'Unavailable',
    }
  }

  return {
    isPlayable: true,
    label: null,
  }
}

const ReelFeedItemComponent = function ReelFeedItem({
  description,
  reel,
  height,
  isActive,
  shouldPreload,
  isMuted,
  onToggleMuted,
}: ReelFeedItemProps) {
  const videoRef = useRef<ReelVideoHandle | null>(null)
  const resumeAfterScrubRef = useRef(false)
  const pendingSeekTargetRef = useRef<number | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [bufferedPosition, setBufferedPosition] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [isPausedByUser, setIsPausedByUser] = useState(false)
  const [isScrubberVisible, setIsScrubberVisible] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [isSeekFeedbackPending, setIsSeekFeedbackPending] = useState(false)
  const [hasPlaybackError, setHasPlaybackError] = useState(false)
  const [playbackPosition, setPlaybackPosition] = useState(0)
  const [scrubPosition, setScrubPosition] = useState(0)
  const [scrubberWidth, setScrubberWidth] = useState(0)
  const playbackState = useMemo(() => getPlaybackState(reel.status), [reel.status])
  const descriptionText = description?.trim()
  const metaLine = format(new Date(reel.createdAt), 'MMM d')
  const showPausedControls =
    isPausedByUser && !isScrubbing && isActive && playbackState.isPlayable && !hasPlaybackError
  const showScrubber =
    (isScrubberVisible || isSeekFeedbackPending) && durationSeconds > 0 && isActive
  const shouldRenderVideo = playbackState.isPlayable && (isActive || shouldPreload)
  const effectivePosition = isScrubbing ? scrubPosition : playbackPosition
  const bufferedRatio = durationSeconds > 0 ? clamp(bufferedPosition / durationSeconds, 0, 1) : 0
  const progressRatio = durationSeconds > 0 ? clamp(effectivePosition / durationSeconds, 0, 1) : 0
  const scrubRailBottom = 0
  const metadataBottom = SCRUBBER_TOUCH_ZONE_HEIGHT + 14

  const handleProgress = ({
    bufferedPosition: nextBufferedPosition,
    currentTime,
    duration,
  }: {
    bufferedPosition?: number
    currentTime: number
    duration: number
  }) => {
    setPlaybackPosition(currentTime)

    if (duration > 0) {
      setDurationSeconds(duration)
    }

    if (typeof nextBufferedPosition === 'number' && nextBufferedPosition >= 0) {
      setBufferedPosition(nextBufferedPosition)
    }

    if (
      pendingSeekTargetRef.current !== null &&
      Math.abs(currentTime - pendingSeekTargetRef.current) < 0.45
    ) {
      pendingSeekTargetRef.current = null
      setIsSeekFeedbackPending(false)

      if (!isScrubbing) {
        setIsScrubberVisible(false)
      }
    }
  }

  const seekToRatio = useCallback(
    (ratio: number) => {
      if (durationSeconds <= 0) {
        return
      }

      const nextPosition = clamp(ratio, 0, 1) * durationSeconds
      pendingSeekTargetRef.current = nextPosition
      setScrubPosition(nextPosition)
      setIsSeekFeedbackPending(true)
      videoRef.current?.seekTo(nextPosition)
    },
    [durationSeconds],
  )

  const beginScrub = useCallback(
    (touchX: number) => {
      if (durationSeconds <= 0 || scrubberWidth <= 0) {
        return
      }

      resumeAfterScrubRef.current = !isPausedByUser
      setIsPausedByUser(true)
      setIsScrubberVisible(true)
      setIsScrubbing(true)
      seekToRatio(touchX / scrubberWidth)
    },
    [durationSeconds, isPausedByUser, scrubberWidth, seekToRatio],
  )

  const updateScrub = useCallback(
    (touchX: number) => {
      if (durationSeconds <= 0 || scrubberWidth <= 0) {
        return
      }

      seekToRatio(touchX / scrubberWidth)
    },
    [durationSeconds, scrubberWidth, seekToRatio],
  )

  const finishScrub = useCallback(() => {
    setIsScrubbing(false)

    if (resumeAfterScrubRef.current) {
      setIsPausedByUser(false)
    }

    if (pendingSeekTargetRef.current === null) {
      setIsScrubberVisible(false)
    }
  }, [])

  const scrubGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isActive && playbackState.isPlayable && durationSeconds > 0)
        .averageTouches(true)
        .maxPointers(1)
        .activateAfterLongPress(120)
        .activeOffsetX([-2, 2])
        .failOffsetY([-12, 12])
        .onStart((event) => {
          scheduleOnRN(beginScrub, event.x)
        })
        .onUpdate((event) => {
          scheduleOnRN(updateScrub, event.x)
        })
        .onEnd(() => {
          scheduleOnRN(finishScrub)
        })
        .onFinalize(() => {
          scheduleOnRN(finishScrub)
        }),
    [beginScrub, durationSeconds, finishScrub, isActive, playbackState.isPlayable, updateScrub],
  )

  useEffect(() => {
    pendingSeekTargetRef.current = null
    setBufferedPosition(0)
    setDurationSeconds(0)
    setIsReady(false)
    setHasPlaybackError(false)
    setIsPausedByUser(false)
    setIsScrubberVisible(false)
    setIsScrubbing(false)
    setIsSeekFeedbackPending(false)
    setPlaybackPosition(0)
    setScrubPosition(0)
  }, [reel.id])

  useEffect(() => {
    if (!isActive) {
      if (!shouldPreload) {
        setIsReady(false)
      }
      setIsPausedByUser(false)
      setIsScrubberVisible(false)
      setIsScrubbing(false)
      setIsSeekFeedbackPending(false)
      return
    }

    setHasPlaybackError(false)
  }, [isActive, shouldPreload])

  return (
    <View className="flex-1 bg-[#050505]" style={{ height }}>
      <View className="flex-1 bg-[#050505]">
        {reel.thumbnailUrl ? (
          <Image source={{ uri: reel.thumbnailUrl }} contentFit="cover" style={styles.video} />
        ) : (
          <View style={styles.video} />
        )}

        {shouldRenderVideo ? (
          <ReelVideo
            ref={videoRef}
            uri={reel.streamUrl}
            shouldPlay={isActive && !isPausedByUser && !hasPlaybackError}
            loop
            muted={isMuted}
            contentFit="cover"
            resetOnPause
            onReady={() => {
              setIsReady(true)
            }}
            onError={() => {
              setHasPlaybackError(true)
            }}
            onProgress={handleProgress}
            style={[styles.videoOverlay, { opacity: isActive && isReady ? 1 : 0 }]}
          />
        ) : null}

        <LinearGradient
          colors={['rgba(0,0,0,0.16)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.76)']}
          locations={[0, 0.36, 1]}
          pointerEvents="none"
          style={styles.fill}
        />

        {isActive && !showPausedControls && playbackState.isPlayable && !hasPlaybackError ? (
          <Pressable
            style={[styles.fill, { bottom: scrubRailBottom + SCRUBBER_TOUCH_ZONE_HEIGHT + 10 }]}
            onPress={() => {
              setIsPausedByUser(true)
            }}
          />
        ) : null}

        {showPausedControls ? (
          <Pressable
            style={styles.fill}
            onPress={() => {
              setIsPausedByUser(false)
            }}
          >
            <View className="absolute inset-0 items-center justify-center">
              <TouchableOpacity
                className="h-[72px] w-[72px] items-center justify-center rounded-full bg-black/52"
                activeOpacity={0.84}
                onPress={(event) => {
                  event.stopPropagation()
                  setIsPausedByUser(false)
                }}
              >
                <MaterialIcons name="play-arrow" size={40} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </Pressable>
        ) : null}

        {isActive && playbackState.isPlayable ? (
          <GestureDetector gesture={scrubGesture}>
            <View
              className="absolute inset-x-0 z-20"
              style={{ bottom: scrubRailBottom }}
              pointerEvents="box-only"
            >
              <View
                className="justify-end"
                onLayout={(event) => {
                  setScrubberWidth(event.nativeEvent.layout.width)
                }}
                style={{ height: SCRUBBER_TOUCH_ZONE_HEIGHT }}
              >
                <View className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-white/22">
                  <View
                    className="absolute inset-y-0 left-0 rounded-full bg-white/90"
                    style={{ width: `${progressRatio * 100}%` }}
                  />
                </View>

                {showScrubber ? (
                  <View className="absolute inset-x-0 bottom-0 rounded-full bg-black/58 px-3 py-3">
                    <View className="h-[3px] overflow-hidden rounded-full bg-white/28">
                      <View
                        className="absolute inset-y-0 left-0 bg-white/45"
                        style={{ width: `${bufferedRatio * 100}%` }}
                      />
                      <View
                        className="absolute inset-y-0 left-0 bg-white"
                        style={{ width: `${progressRatio * 100}%` }}
                      />
                    </View>

                    <View className="mt-2 flex-row items-center justify-between">
                      <Text className="text-xs2 text-white">
                        {formatPlaybackTime(effectivePosition)}
                      </Text>

                      {isSeekFeedbackPending ? (
                        <View className="flex-row items-center">
                          <View className="mr-2 h-2 w-2 rounded-full bg-white/72" />
                          <Text className="text-xs2 text-white">Loading</Text>
                        </View>
                      ) : (
                        <Text className="text-xs2 text-white">
                          {formatPlaybackTime(durationSeconds)}
                        </Text>
                      )}
                    </View>
                  </View>
                ) : null}
              </View>
            </View>
          </GestureDetector>
        ) : null}

        {!playbackState.isPlayable || hasPlaybackError ? (
          <View pointerEvents="none" className="absolute inset-0 items-center justify-center px-8">
            <View className="rounded-[28px] bg-black/58 px-6 py-4">
              <Text className="text-center font-medium text-md text-white">
                {playbackState.label || 'This reel could not be played.'}
              </Text>
            </View>
          </View>
        ) : null}

        <View
          pointerEvents="box-none"
          className="absolute inset-x-0"
          style={{ bottom: metadataBottom }}
        >
          <View className="px-4">
            <View className="flex-row items-end justify-between gap-4">
              <View className="max-w-[86%]">
                <Text className="font-heading text-[22px] leading-[26px] text-white">
                  {reel.title?.trim() || 'Untitled reel'}
                </Text>

                {descriptionText ? (
                  <Text className="mt-2 text-sm2 leading-6 text-white" numberOfLines={3}>
                    {descriptionText}
                  </Text>
                ) : null}

                <Text className="mt-2 text-sm2 text-white">{metaLine}</Text>
              </View>

              {showPausedControls ? (
                <TouchableOpacity
                  className="h-12 w-12 items-center justify-center rounded-full bg-black/36"
                  activeOpacity={0.84}
                  onPress={() => {
                    onToggleMuted()
                  }}
                >
                  <MaterialIcons
                    name={isMuted ? 'volume-off' : 'volume-up'}
                    size={20}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

export const ReelFeedItem = memo(ReelFeedItemComponent)
