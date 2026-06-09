import { MaterialIcons } from '@expo/vector-icons'
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { ReelVideo } from '../reels/ReelVideo'

import { VideoProgressBar } from './VideoProgressBar'

import type { ReelVideoHandle, ReelVideoProgress } from '../reels/ReelVideo'
import type { StyleProp, ViewStyle } from 'react-native'

type ContentFit = 'cover' | 'contain'

interface AppVideoPlayerProps {
  autoPlay?: boolean
  contentFit?: ContentFit
  controlsBottomInset?: number
  controlsVisible?: boolean
  defaultMuted?: boolean
  isActive?: boolean
  loop?: boolean
  muted?: boolean
  resetOnInactive?: boolean
  onControlsVisibilityChange?: (visible: boolean) => void
  onError?: () => void
  onMutedChange?: (muted: boolean) => void
  onPlaybackEnd?: () => void
  onReady?: () => void
  posterUri?: string
  style?: StyleProp<ViewStyle>
  uri: string
}

const AUTO_HIDE_DELAY_MS = 3000
const CONTROLS_FADE_DURATION_MS = 140
const PROGRESS_SETTLE_WINDOW_MS = 300
const SEEK_EPSILON_SECONDS = 0.35
const PLAYBACK_END_EPSILON_SECONDS = 0.15

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value))
}

const formatTimeLabel = (seconds: number) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainingSeconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

export const AppVideoPlayer = forwardRef<ReelVideoHandle, AppVideoPlayerProps>(
  function AppVideoPlayer(
    {
      autoPlay = true,
      contentFit = 'cover',
      controlsBottomInset = 0,
      controlsVisible,
      defaultMuted = false,
      isActive = true,
      loop = false,
      muted,
      resetOnInactive = false,
      onControlsVisibilityChange,
      onError,
      onMutedChange,
      onPlaybackEnd,
      onReady,
      posterUri,
      style,
      uri,
    },
    ref,
  ) {
    const videoRef = useRef<ReelVideoHandle | null>(null)
    const autoHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingSeekTimeRef = useRef<number | null>(null)
    const suppressProgressUntilRef = useRef(0)
    const playbackEndedRef = useRef(false)
    const [bufferedPosition, setBufferedPosition] = useState(0)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [hasActivatedPlayback, setHasActivatedPlayback] = useState(Boolean(autoPlay))
    const [hasPlaybackError, setHasPlaybackError] = useState(false)
    const [internalControlsVisible, setInternalControlsVisible] = useState(true)
    const [internalMuted, setInternalMuted] = useState(defaultMuted || Boolean(muted))
    const [isBuffering, setIsBuffering] = useState(false)
    const [isPausedByUser, setIsPausedByUser] = useState(!autoPlay)
    const [isReady, setIsReady] = useState(false)
    const [isScrubbing, setIsScrubbing] = useState(false)
    const [retryToken, setRetryToken] = useState(0)
    const [scrubTime, setScrubTime] = useState<number | null>(null)
    const [surfaceWidth, setSurfaceWidth] = useState(0)
    const controlsOpacity = useSharedValue((controlsVisible ?? internalControlsVisible) ? 1 : 0)
    const shouldShowStartupLoader = !isReady && !posterUri && !hasPlaybackError
    const shouldShowBufferingLoader = isReady && isBuffering && !hasPlaybackError

    const resolvedControlsVisible = controlsVisible ?? internalControlsVisible
    const resolvedMuted = muted ?? internalMuted
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
    const displayedTime = scrubTime ?? currentTime
    const progressRatio = safeDuration > 0 ? clamp(displayedTime / safeDuration, 0, 1) : 0
    const bufferedRatio =
      safeDuration > 0 ? clamp(bufferedPosition / safeDuration, progressRatio, 1) : progressRatio
    const shouldPlay =
      isActive && hasActivatedPlayback && !isPausedByUser && !hasPlaybackError && !isScrubbing

    const setControlsVisible = useCallback(
      (visible: boolean) => {
        if (controlsVisible === undefined) {
          setInternalControlsVisible(visible)
        }

        onControlsVisibilityChange?.(visible)
      },
      [controlsVisible, onControlsVisibilityChange],
    )

    const clearAutoHideTimer = useCallback(() => {
      if (autoHideTimeoutRef.current) {
        clearTimeout(autoHideTimeoutRef.current)
        autoHideTimeoutRef.current = null
      }
    }, [])

    const scheduleAutoHide = useCallback(() => {
      clearAutoHideTimer()

      if (
        !isActive ||
        !resolvedControlsVisible ||
        !isReady ||
        isBuffering ||
        hasPlaybackError ||
        isPausedByUser ||
        isScrubbing
      ) {
        return
      }

      autoHideTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false)
      }, AUTO_HIDE_DELAY_MS)
    }, [
      clearAutoHideTimer,
      hasPlaybackError,
      isActive,
      isPausedByUser,
      isReady,
      isScrubbing,
      resolvedControlsVisible,
      isBuffering,
      setControlsVisible,
    ])

    const commitSeek = useCallback(
      (nextTime: number) => {
        const clampedTime = clamp(nextTime, 0, safeDuration || Number.POSITIVE_INFINITY)
        pendingSeekTimeRef.current = clampedTime
        suppressProgressUntilRef.current = Date.now() + PROGRESS_SETTLE_WINDOW_MS
        playbackEndedRef.current = false
        setCurrentTime(clampedTime)
        setScrubTime(null)
        videoRef.current?.seekTo(clampedTime)
      },
      [safeDuration],
    )

    const play = useCallback(() => {
      clearAutoHideTimer()
      if (!loop && safeDuration > 0 && currentTime >= safeDuration - PLAYBACK_END_EPSILON_SECONDS) {
        commitSeek(0)
      }

      playbackEndedRef.current = false
      setHasActivatedPlayback(true)
      setIsPausedByUser(false)
      setControlsVisible(true)
      videoRef.current?.play()
    }, [clearAutoHideTimer, commitSeek, currentTime, loop, safeDuration, setControlsVisible])

    const pause = useCallback(() => {
      clearAutoHideTimer()
      setIsPausedByUser(true)
      setControlsVisible(true)
      videoRef.current?.pause()
    }, [clearAutoHideTimer, setControlsVisible])

    const seekTo = useCallback(
      (seconds: number) => {
        commitSeek(seconds)
      },
      [commitSeek],
    )

    const seekBy = useCallback(
      (seconds: number) => {
        const baseTime = pendingSeekTimeRef.current ?? scrubTime ?? currentTime
        commitSeek(baseTime + seconds)
      },
      [commitSeek, currentTime, scrubTime],
    )

    useImperativeHandle(
      ref,
      () => ({
        pause,
        play,
        seekBy,
        seekTo,
      }),
      [pause, play, seekBy, seekTo],
    )

    useEffect(() => {
      return () => {
        clearAutoHideTimer()
      }
    }, [clearAutoHideTimer])

    useEffect(() => {
      controlsOpacity.value = withTiming(resolvedControlsVisible ? 1 : 0, {
        duration: CONTROLS_FADE_DURATION_MS,
      })
    }, [controlsOpacity, resolvedControlsVisible])

    useEffect(() => {
      scheduleAutoHide()
    }, [scheduleAutoHide])

    const resetPlaybackToStart = useCallback(() => {
      pendingSeekTimeRef.current = null
      suppressProgressUntilRef.current = 0
      playbackEndedRef.current = false

      setBufferedPosition(0)
      setCurrentTime(0)
      setHasActivatedPlayback(Boolean(autoPlay))
      setIsBuffering(false)
      setIsPausedByUser(!autoPlay)
      setIsScrubbing(false)
      setScrubTime(null)

      videoRef.current?.seekTo(0)
    }, [autoPlay])

    useEffect(() => {
      if (!isActive) {
        clearAutoHideTimer()

        if (resetOnInactive) {
          resetPlaybackToStart()
          return
        }

        setScrubTime(null)
        setIsScrubbing(false)
        return
      }

      if (autoPlay && !hasActivatedPlayback) {
        playbackEndedRef.current = false
        setHasActivatedPlayback(true)
        setIsPausedByUser(false)
      }
    }, [
      autoPlay,
      clearAutoHideTimer,
      hasActivatedPlayback,
      isActive,
      resetOnInactive,
      resetPlaybackToStart,
    ])

    useEffect(() => {
      setBufferedPosition(0)
      setCurrentTime(0)
      setDuration(0)
      setHasActivatedPlayback(Boolean(autoPlay))
      setHasPlaybackError(false)
      setInternalControlsVisible(true)
      setIsBuffering(false)
      setIsPausedByUser(!autoPlay)
      setIsReady(false)
      setIsScrubbing(false)
      setRetryToken(0)
      setScrubTime(null)
      pendingSeekTimeRef.current = null
      suppressProgressUntilRef.current = 0
      playbackEndedRef.current = false
    }, [autoPlay, uri])

    useEffect(() => {
      if (muted === undefined) {
        setInternalMuted(defaultMuted)
      }
    }, [defaultMuted, muted, uri])

    const handleProgress = useCallback(
      (progress: ReelVideoProgress) => {
        const nextDuration = Number.isFinite(progress.duration) ? Math.max(0, progress.duration) : 0
        const nextCurrentTime = Number.isFinite(progress.currentTime)
          ? Math.max(0, progress.currentTime)
          : 0
        const nextBufferedPosition = Number.isFinite(progress.bufferedPosition)
          ? Math.max(0, progress.bufferedPosition ?? 0)
          : 0

        setDuration(nextDuration)
        setBufferedPosition(nextBufferedPosition)
        setIsBuffering(Boolean(progress.isBuffering))

        const pendingSeekTime = pendingSeekTimeRef.current
        if (pendingSeekTime !== null) {
          const hasSettled = Math.abs(nextCurrentTime - pendingSeekTime) <= SEEK_EPSILON_SECONDS
          if (!hasSettled && Date.now() < suppressProgressUntilRef.current) {
            return
          }

          pendingSeekTimeRef.current = null
          suppressProgressUntilRef.current = 0
        }

        setCurrentTime(nextCurrentTime)

        if (
          !loop &&
          nextDuration > 0 &&
          !progress.isBuffering &&
          nextCurrentTime >= nextDuration - PLAYBACK_END_EPSILON_SECONDS
        ) {
          if (!playbackEndedRef.current) {
            playbackEndedRef.current = true
            setIsPausedByUser(true)
            setControlsVisible(true)
            onPlaybackEnd?.()
          }

          return
        }

        if (nextCurrentTime < nextDuration - PLAYBACK_END_EPSILON_SECONDS) {
          playbackEndedRef.current = false
        }
      },
      [loop, onPlaybackEnd, setControlsVisible],
    )

    const handleReady = useCallback(() => {
      setHasPlaybackError(false)
      setIsReady(true)
      onReady?.()
    }, [onReady])

    const handleError = useCallback(() => {
      clearAutoHideTimer()
      setHasPlaybackError(true)
      setIsBuffering(false)
      setControlsVisible(true)
      onError?.()
    }, [clearAutoHideTimer, onError, setControlsVisible])

    const handleToggleControls = useCallback(() => {
      setControlsVisible(!resolvedControlsVisible)
    }, [resolvedControlsVisible, setControlsVisible])

    const handleToggleMuted = useCallback(() => {
      const nextMuted = !resolvedMuted

      if (muted === undefined) {
        setInternalMuted(nextMuted)
      }

      onMutedChange?.(nextMuted)
      setControlsVisible(true)
      scheduleAutoHide()
    }, [muted, onMutedChange, resolvedMuted, scheduleAutoHide, setControlsVisible])

    const handleTogglePlayback = useCallback(() => {
      if (shouldPlay) {
        pause()
        return
      }

      play()
    }, [pause, play, shouldPlay])

    const handleSeekStart = useCallback(() => {
      clearAutoHideTimer()
      setIsScrubbing(true)
      setScrubTime(pendingSeekTimeRef.current ?? currentTime)
      setControlsVisible(true)
    }, [clearAutoHideTimer, currentTime, setControlsVisible])

    const handleSeekChange = useCallback(
      (ratio: number) => {
        if (safeDuration <= 0) {
          return
        }

        setScrubTime(ratio * safeDuration)
      },
      [safeDuration],
    )

    const handleSeekComplete = useCallback(
      (ratio: number) => {
        setIsScrubbing(false)

        if (safeDuration <= 0) {
          setScrubTime(null)
          scheduleAutoHide()
          return
        }

        commitSeek(ratio * safeDuration)
        scheduleAutoHide()
      },
      [commitSeek, safeDuration, scheduleAutoHide],
    )

    const handleRetry = useCallback(() => {
      pendingSeekTimeRef.current = null
      suppressProgressUntilRef.current = 0
      playbackEndedRef.current = false
      setBufferedPosition(0)
      setCurrentTime(0)
      setDuration(0)
      setHasPlaybackError(false)
      setIsBuffering(false)
      setIsPausedByUser(!autoPlay)
      setIsReady(false)
      setScrubTime(null)
      setRetryToken((value) => value + 1)
      setControlsVisible(true)
    }, [autoPlay, setControlsVisible])

    const handleSkipBy = useCallback(
      (seconds: number) => {
        setControlsVisible(true)

        if (safeDuration <= 0) {
          return
        }

        setHasActivatedPlayback(true)
        seekBy(seconds)
        scheduleAutoHide()
      },
      [safeDuration, scheduleAutoHide, seekBy, setControlsVisible],
    )

    const handleSkipBackward = useCallback(() => {
      handleSkipBy(-10)
    }, [handleSkipBy])

    const handleSkipForward = useCallback(() => {
      handleSkipBy(10)
    }, [handleSkipBy])

    const controlsAnimatedStyle = useAnimatedStyle(() => ({
      opacity: controlsOpacity.value,
    }))

    const surfaceGesture = useMemo(
      () =>
        Gesture.Exclusive(
          Gesture.Tap()
            .enabled(isActive && surfaceWidth > 0)
            .numberOfTaps(2)
            .maxDuration(250)
            .onEnd((event) => {
              'worklet'
              const isLeftSide = event.x < surfaceWidth / 2
              scheduleOnRN(handleSkipBy, isLeftSide ? -10 : 10)
            }),
          Gesture.Tap()
            .enabled(isActive)
            .numberOfTaps(1)
            .maxDuration(250)
            .onEnd(() => {
              'worklet'
              scheduleOnRN(handleToggleControls)
            }),
        ),
      [handleSkipBy, handleToggleControls, isActive, surfaceWidth],
    )

    return (
      <View
        onLayout={(event) => {
          setSurfaceWidth(event.nativeEvent.layout.width)
        }}
        style={[styles.container, style]}
      >
        <ReelVideo
          key={`${uri}:${retryToken}`}
          contentFit={contentFit}
          loop={loop}
          muted={resolvedMuted}
          nativeControls={false}
          onError={handleError}
          onProgress={handleProgress}
          onReady={handleReady}
          ref={videoRef}
          shouldPlay={shouldPlay}
          style={styles.videoLayer}
          uri={uri}
          {...(posterUri ? { posterUri } : {})}
        />

        <GestureDetector gesture={surfaceGesture}>
          <View style={styles.gestureSurface} />
        </GestureDetector>

        {shouldShowStartupLoader || shouldShowBufferingLoader ? (
          <View pointerEvents="none" style={styles.bufferingOverlay}>
            <ActivityIndicator color="#FFFFFF" size="small" />
          </View>
        ) : null}

        <Animated.View
          pointerEvents={resolvedControlsVisible ? 'box-none' : 'none'}
          style={[styles.controlsOverlay, controlsAnimatedStyle]}
        >
          <View pointerEvents="box-none" style={styles.centerControls}>
            <View pointerEvents="box-none" style={styles.centerControlsRow}>
              <Pressable
                accessibilityLabel="Rewind 10 seconds"
                accessibilityRole="button"
                disabled={safeDuration <= 0}
                hitSlop={14}
                onPress={handleSkipBackward}
                style={[styles.skipButton, safeDuration <= 0 ? styles.skipButtonDisabled : null]}
              >
                <MaterialIcons color="#FFFFFF" name="replay-10" size={30} />
              </Pressable>

              <Pressable
                accessibilityLabel={shouldPlay ? 'Pause video' : 'Play video'}
                accessibilityRole="button"
                hitSlop={16}
                onPress={handleTogglePlayback}
                style={styles.playButton}
              >
                <MaterialIcons
                  color="#0A0A0A"
                  name={shouldPlay ? 'pause' : 'play-arrow'}
                  size={30}
                />
              </Pressable>

              <Pressable
                accessibilityLabel="Forward 10 seconds"
                accessibilityRole="button"
                disabled={safeDuration <= 0}
                hitSlop={14}
                onPress={handleSkipForward}
                style={[styles.skipButton, safeDuration <= 0 ? styles.skipButtonDisabled : null]}
              >
                <MaterialIcons color="#FFFFFF" name="forward-10" size={30} />
              </Pressable>
            </View>
          </View>

          <View
            pointerEvents="box-none"
            style={[styles.bottomControls, { paddingBottom: controlsBottomInset }]}
          >
            <VideoProgressBar
              bufferedRatio={bufferedRatio}
              isScrubbing={isScrubbing}
              onSeekChange={handleSeekChange}
              onSeekComplete={handleSeekComplete}
              onSeekStart={handleSeekStart}
              progressRatio={progressRatio}
            />

            <View pointerEvents="box-none" style={styles.controlRow}>
              <Text style={styles.timeLabel}>
                {formatTimeLabel(displayedTime)} / {formatTimeLabel(safeDuration)}
              </Text>
              <View style={styles.rowSpacer} />
              <Pressable hitSlop={12} onPress={handleToggleMuted} style={styles.iconButton}>
                <MaterialIcons
                  color="#FFFFFF"
                  name={resolvedMuted ? 'volume-off' : 'volume-up'}
                  size={22}
                />
              </Pressable>
            </View>
          </View>
        </Animated.View>

        {hasPlaybackError ? (
          <View style={styles.errorOverlay}>
            <MaterialIcons color="#FFFFFF" name="error-outline" size={28} />
            <Text style={styles.errorTitle}>Unable to play this video</Text>
            <Text style={styles.errorSubtitle}>Check your connection and try again.</Text>
            <Pressable hitSlop={12} onPress={handleRetry} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    )
  },
)

const styles = StyleSheet.create({
  bottomControls: {
    bottom: 0,
    left: 0,
    paddingHorizontal: 18,
    paddingTop: 20,
    position: 'absolute',
    right: 0,
  },
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerControls: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerControlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  container: {
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  controlRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 14,
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  errorSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  gestureSurface: {
    ...StyleSheet.absoluteFillObject,
  },
  iconButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 42,
    paddingHorizontal: 18,
  },
  retryLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  rowSpacer: {
    flex: 1,
  },
  skipButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    marginHorizontal: 22,
    width: 52,
  },
  skipButtonDisabled: {
    opacity: 0.38,
  },
  timeLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  videoLayer: {
    ...StyleSheet.absoluteFillObject,
  },
})
