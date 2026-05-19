import { Image } from 'expo-image'
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { StyleSheet } from 'react-native'

import type { StyleProp, ViewStyle } from 'react-native'

type ContentFit = 'cover' | 'contain'

interface ReelVideoProps {
  uri: string
  posterUri?: string
  shouldPlay: boolean
  loop?: boolean
  muted?: boolean
  nativeControls?: boolean
  contentFit?: ContentFit
  style?: StyleProp<ViewStyle>
  resetOnPause?: boolean
  onReady?: () => void
  onError?: () => void
  onProgress?: (progress: ReelVideoProgress) => void
}

export interface ReelVideoHandle {
  seekBy: (seconds: number) => void
  seekTo: (seconds: number) => void
}

export interface ReelVideoProgress {
  bufferedPosition?: number | undefined
  currentTime: number
  duration: number
  isBuffering?: boolean | undefined
}

interface ExpoVideoModule {
  VideoView: React.ComponentType<{
    player: unknown
    contentFit?: ContentFit
    nativeControls?: boolean
    onFirstFrameRender?: () => void
    surfaceType?: 'surfaceView' | 'textureView'
    style?: StyleProp<ViewStyle>
  }>
  useVideoPlayer: (
    source: string | { uri: string; contentType?: 'hls' },
    setup?: (player: {
      loop: boolean
      muted: boolean
      currentTime: number
      duration: number
      timeUpdateEventInterval: number
      seekBy?: (seconds: number) => void
      play: () => void
      pause: () => void
    }) => void,
  ) => {
    loop: boolean
    muted: boolean
    currentTime: number
    duration: number
    timeUpdateEventInterval: number
    seekBy?: (seconds: number) => void
    play: () => void
    pause: () => void
    addListener: {
      (
        event: 'statusChange',
        listener: (payload: { status: string; error?: unknown }) => void,
      ): {
        remove: () => void
      }
      (
        event: 'timeUpdate',
        listener: (payload: { bufferedPosition: number; currentTime: number }) => void,
      ): { remove: () => void }
    }
  }
}

interface PlaybackStatusLoaded {
  isLoaded: true
  isBuffering?: boolean
  positionMillis: number
  durationMillis?: number
  playableDurationMillis?: number
}

interface PlaybackStatusUnloaded {
  isLoaded: false
}

type PlaybackStatus = PlaybackStatusLoaded | PlaybackStatusUnloaded

interface ExpoAvPlaybackRef {
  playAsync: () => Promise<unknown>
  pauseAsync: () => Promise<unknown>
  setPositionAsync: (position: number) => Promise<unknown>
  getStatusAsync: () => Promise<PlaybackStatus>
}

interface ExpoAvModule {
  Video: React.ComponentType<{
    ref?: React.RefObject<ExpoAvPlaybackRef | null>
    source: { uri: string }
    shouldPlay?: boolean
    isLooping?: boolean
    isMuted?: boolean
    resizeMode?: string
    usePoster?: boolean
    posterSource?: { uri: string }
    useNativeControls?: boolean
    onPlaybackStatusUpdate?: (status: PlaybackStatus) => void
    onReadyForDisplay?: (() => void) | undefined
    onError?: (() => void) | undefined
    style?: StyleProp<ViewStyle>
  }>
  ResizeMode: {
    COVER: string
    CONTAIN: string
  }
}

const isHlsUri = (uri: string) => /\.m3u8($|[?#])/i.test(uri)

const buildExpoVideoSource = (uri: string): string | { uri: string; contentType: 'hls' } => {
  if (isHlsUri(uri)) {
    return { uri, contentType: 'hls' }
  }

  return uri
}

let expoVideoModule: ExpoVideoModule | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  expoVideoModule = require('expo-video') as ExpoVideoModule
} catch {
  expoVideoModule = null
}

let expoAvModule: ExpoAvModule | null | undefined
const getExpoAvModule = () => {
  if (expoAvModule !== undefined) {
    return expoAvModule
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    expoAvModule = require('expo-av') as ExpoAvModule
  } catch {
    expoAvModule = null
  }

  return expoAvModule
}

const posterStyle = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
})

const ExpoVideoPlayer = forwardRef<ReelVideoHandle, ReelVideoProps>(function ExpoVideoPlayer(
  {
    uri,
    posterUri,
    shouldPlay,
    loop = false,
    muted = false,
    nativeControls = false,
    contentFit = 'cover',
    style,
    resetOnPause = false,
    onReady,
    onError,
    onProgress,
  },
  ref,
) {
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false)
  const { VideoView: VideoViewComponent, useVideoPlayer } = expoVideoModule as ExpoVideoModule
  const player = useVideoPlayer(buildExpoVideoSource(uri), (videoPlayer) => {
    videoPlayer.loop = loop
    videoPlayer.muted = muted
    videoPlayer.timeUpdateEventInterval = 0.25
    videoPlayer.pause()
  })

  useImperativeHandle(
    ref,
    () => ({
      seekBy: (seconds: number) => {
        if (typeof player.seekBy === 'function') {
          player.seekBy(seconds)
          return
        }

        player.currentTime = Math.max(0, player.currentTime + seconds)
      },
      seekTo: (seconds: number) => {
        const safeDuration =
          Number.isFinite(player.duration) && player.duration > 0 ? player.duration : Infinity
        player.currentTime = Math.max(0, Math.min(safeDuration, seconds))
      },
    }),
    [player],
  )

  useEffect(() => {
    setHasRenderedFrame(false)
  }, [uri])

  useEffect(() => {
    player.loop = loop
    player.muted = muted
    player.timeUpdateEventInterval = 0.25

    if (shouldPlay) {
      player.play()
      return
    }

    player.pause()

    if (resetOnPause) {
      player.currentTime = 0
    }
  }, [loop, muted, player, resetOnPause, shouldPlay])

  useEffect(() => {
    const statusSubscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error' || error) {
        onError?.()
      }
    })
    const timeSubscription = player.addListener(
      'timeUpdate',
      ({ bufferedPosition, currentTime }) => {
        onProgress?.({
          bufferedPosition,
          currentTime,
          duration: player.duration,
        })
      },
    )

    return () => {
      statusSubscription.remove()
      timeSubscription.remove()
    }
  }, [onError, onProgress, player])

  return (
    <>
      {posterUri && !hasRenderedFrame ? (
        <Image source={{ uri: posterUri }} style={posterStyle.fill} />
      ) : null}
      <VideoViewComponent
        player={player}
        contentFit={contentFit}
        nativeControls={nativeControls}
        onFirstFrameRender={() => {
          setHasRenderedFrame(true)
          onProgress?.({
            currentTime: player.currentTime,
            duration: player.duration,
          })
          onReady?.()
        }}
        surfaceType="textureView"
        style={style}
      />
    </>
  )
})

const ExpoAvPlayer = forwardRef<ReelVideoHandle, ReelVideoProps>(function ExpoAvPlayer(
  {
    uri,
    posterUri,
    shouldPlay,
    loop = false,
    muted = false,
    nativeControls = false,
    contentFit = 'cover',
    style,
    resetOnPause = false,
    onReady,
    onError,
    onProgress,
  },
  ref,
) {
  const { ResizeMode, Video: VideoComponent } = getExpoAvModule() as ExpoAvModule
  const videoRef = useRef<ExpoAvPlaybackRef | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      seekBy: (seconds: number) => {
        void videoRef.current
          ?.getStatusAsync()
          .then((status) => {
            if (!status.isLoaded) {
              return
            }

            const durationMillis =
              typeof status.durationMillis === 'number' ? status.durationMillis : Infinity
            const nextPositionMillis = Math.max(
              0,
              Math.min(durationMillis, status.positionMillis + seconds * 1000),
            )

            return videoRef.current?.setPositionAsync(nextPositionMillis)
          })
          .catch(() => undefined)
      },
      seekTo: (seconds: number) => {
        void videoRef.current?.setPositionAsync(Math.max(0, seconds * 1000)).catch(() => undefined)
      },
    }),
    [],
  )

  useEffect(() => {
    if (shouldPlay) {
      void videoRef.current?.playAsync().catch(() => undefined)
      return
    }

    void videoRef.current?.pauseAsync().catch(() => undefined)

    if (resetOnPause) {
      void videoRef.current?.setPositionAsync(0).catch(() => undefined)
    }
  }, [resetOnPause, shouldPlay, uri])

  return (
    <VideoComponent
      ref={videoRef}
      source={{ uri }}
      shouldPlay={shouldPlay}
      isLooping={loop}
      isMuted={muted}
      resizeMode={contentFit === 'contain' ? ResizeMode.CONTAIN : ResizeMode.COVER}
      usePoster={!!posterUri}
      {...(posterUri ? { posterSource: { uri: posterUri } } : {})}
      useNativeControls={nativeControls}
      onPlaybackStatusUpdate={(status) => {
        if (!status.isLoaded) {
          return
        }

        onProgress?.({
          bufferedPosition:
            typeof status.playableDurationMillis === 'number'
              ? status.playableDurationMillis / 1000
              : undefined,
          currentTime: status.positionMillis / 1000,
          duration: typeof status.durationMillis === 'number' ? status.durationMillis / 1000 : 0,
          isBuffering: status.isBuffering,
        })
      }}
      onReadyForDisplay={onReady}
      onError={onError}
      style={style}
    />
  )
})

export const ReelVideo = forwardRef<ReelVideoHandle, ReelVideoProps>(
  function ReelVideo(props, ref) {
    if (expoVideoModule) {
      return <ExpoVideoPlayer {...props} ref={ref} />
    }

    if (getExpoAvModule()) {
      return <ExpoAvPlayer {...props} ref={ref} />
    }

    return props.posterUri ? (
      <Image source={{ uri: props.posterUri }} style={posterStyle.fill} />
    ) : null
  },
)
