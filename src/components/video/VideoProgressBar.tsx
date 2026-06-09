import React, { useCallback, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { scheduleOnRN } from 'react-native-worklets'

interface VideoProgressBarProps {
  bufferedRatio: number
  isScrubbing?: boolean
  progressRatio: number
  onSeekChange: (ratio: number) => void
  onSeekComplete: (ratio: number) => void
  onSeekStart?: () => void
}

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value))
}

export function VideoProgressBar({
  bufferedRatio,
  isScrubbing = false,
  progressRatio,
  onSeekChange,
  onSeekComplete,
  onSeekStart,
}: VideoProgressBarProps) {
  const [trackWidth, setTrackWidth] = useState(0)
  const hasMeasuredTrack = trackWidth > 0
  const thumbRadius = isScrubbing ? 7 : 6
  const thumbPosition =
    trackWidth > 0
      ? clamp(
          progressRatio * trackWidth,
          thumbRadius,
          Math.max(thumbRadius, trackWidth - thumbRadius),
        )
      : 0

  const toRatio = useCallback(
    (x: number) => {
      if (trackWidth <= 0) {
        return 0
      }

      return clamp(x / trackWidth, 0, 1)
    },
    [trackWidth],
  )

  const handleSeekStart = useCallback(() => {
    onSeekStart?.()
  }, [onSeekStart])

  const handleSeekChange = useCallback(
    (x: number) => {
      onSeekChange(toRatio(x))
    },
    [onSeekChange, toRatio],
  )

  const handleSeekComplete = useCallback(
    (x: number) => {
      onSeekComplete(toRatio(x))
    },
    [onSeekComplete, toRatio],
  )

  const gesture = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Pan()
          .enabled(trackWidth > 0)
          .onBegin((event) => {
            scheduleOnRN(handleSeekStart)
            scheduleOnRN(handleSeekChange, event.x)
          })
          .onUpdate((event) => {
            scheduleOnRN(handleSeekChange, event.x)
          })
          .onEnd((event) => {
            scheduleOnRN(handleSeekComplete, event.x)
          }),
        Gesture.Tap()
          .enabled(trackWidth > 0)
          .onBegin(() => {
            scheduleOnRN(handleSeekStart)
          })
          .onEnd((event) => {
            scheduleOnRN(handleSeekComplete, event.x)
          }),
      ),
    [handleSeekChange, handleSeekComplete, handleSeekStart, trackWidth],
  )

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={(event) => {
          setTrackWidth(event.nativeEvent.layout.width)
        }}
        style={styles.touchArea}
      >
        <View style={[styles.track, isScrubbing ? styles.trackScrubbing : null]}>
          <View style={[styles.bufferedTrack, { width: `${bufferedRatio * 100}%` }]} />
          <View style={[styles.playbackTrack, { width: `${progressRatio * 100}%` }]} />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            isScrubbing ? styles.thumbScrubbing : null,
            { left: thumbPosition, opacity: hasMeasuredTrack ? 1 : 0 },
          ]}
        />
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  bufferedTrack: {
    backgroundColor: 'rgba(255,255,255,0.32)',
    borderRadius: 999,
    height: '100%',
    left: 0,
    position: 'absolute',
    top: 0,
  },
  playbackTrack: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: '100%',
    left: 0,
    position: 'absolute',
    top: 0,
  },
  thumb: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 12,
    marginLeft: -6,
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -6 }],
    width: 12,
  },
  thumbScrubbing: {
    height: 14,
    marginLeft: -7,
    transform: [{ translateY: -7 }],
    width: 14,
  },
  touchArea: {
    justifyContent: 'center',
    minHeight: 26,
  },
  track: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    height: 4,
    overflow: 'hidden',
  },
  trackScrubbing: {
    height: 8,
  },
})
