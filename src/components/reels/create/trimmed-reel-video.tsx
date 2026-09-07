import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'

import { getTrimPlaybackSeekTarget } from '../../../lib/reel-trim-geometry'
import { ReelVideo } from '../ReelVideo'

import type { ReelTrim } from '../../../types/reel-creator'
import type { ReelVideoHandle, ReelVideoProgress } from '../ReelVideo'
import type { StyleProp, ViewStyle } from 'react-native'

const TRIM_LOOP_RESET_TOLERANCE_SECONDS = 0.25

export type TrimmedReelVideoProps = {
  uri: string
  posterUri?: string
  shouldPlay: boolean
  loop?: boolean
  muted?: boolean
  contentFit?: 'cover' | 'contain'
  disableOrientationAwareContentFit?: boolean
  style?: StyleProp<ViewStyle>
  playbackRange?: ReelTrim | null | undefined
  onReady?: () => void
  onError?: () => void
  onProgress?: (progress: ReelVideoProgress) => void
}

export const TrimmedReelVideo = forwardRef<ReelVideoHandle, TrimmedReelVideoProps>(
  function TrimmedReelVideo({ playbackRange, onProgress, uri, ...videoProps }, ref) {
    const videoRef = useRef<ReelVideoHandle | null>(null)
    const loopSeekIssuedRef = useRef(false)
    const startSeconds = playbackRange ? Math.max(0, playbackRange.startMs / 1000) : 0
    const endSeconds = playbackRange ? Math.max(startSeconds, playbackRange.endMs / 1000) : null

    useImperativeHandle(
      ref,
      () => ({
        pause: () => videoRef.current?.pause(),
        play: () => videoRef.current?.play(),
        seekBy: (seconds: number) => videoRef.current?.seekBy(seconds),
        seekTo: (seconds: number) => videoRef.current?.seekTo(seconds),
      }),
      [],
    )

    useEffect(() => {
      loopSeekIssuedRef.current = false
      if (playbackRange) {
        videoRef.current?.seekTo(startSeconds)
      }
    }, [playbackRange, startSeconds, uri])

    const handleProgress = useCallback(
      (progress: ReelVideoProgress) => {
        if (endSeconds !== null && progress.duration > 0) {
          const loopTarget = getTrimPlaybackSeekTarget(
            playbackRange,
            progress.currentTime,
            progress.duration,
          )

          if (loopTarget !== null) {
            if (!loopSeekIssuedRef.current) {
              loopSeekIssuedRef.current = true
              videoRef.current?.seekTo(loopTarget)
            }
          } else if (
            progress.currentTime <
            Math.min(endSeconds, progress.duration) - TRIM_LOOP_RESET_TOLERANCE_SECONDS
          ) {
            loopSeekIssuedRef.current = false
          }
        }

        onProgress?.(progress)
      },
      [endSeconds, onProgress, playbackRange],
    )

    return <ReelVideo {...videoProps} onProgress={handleProgress} ref={videoRef} uri={uri} />
  },
)
