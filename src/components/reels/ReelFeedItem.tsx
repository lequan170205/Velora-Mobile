import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { useOfflineReelVideoSource } from '@/hooks/useOfflineReelVideoSource'

import {
  useReelDetail,
  useReelProcessingStatus,
  useDeleteReel,
  useReprocessReel,
} from '../../hooks/useReels'
import { CHAT_SHARED_REEL_FALLBACK_ID_PREFIX } from '../../lib/chatReels'
import { getInitials } from '../../lib/profile'
import { isCurrentReelPlayerCallback } from '../../lib/reelPlaybackCoordinator'
import {
  isReelMediaFailed,
  isReelPlayable,
  mergeReelProcessingStatus,
} from '../../lib/reelProcessing'
import { useAuthStore } from '../../stores/authStore'

import { DeleteReelModal } from './DeleteReelModal'
import { ReelActionsMenu } from './ReelActionsMenu'
import { ReelLoadingRail } from './ReelLoadingRail'
import { ReelShareSheet } from './ReelShareSheet'
import { ReelVideo } from './ReelVideo'

import type { ReelVideoHandle, ReelVideoProgress } from './ReelVideo'
import type { Reel } from '../../types/reel.types'

interface ReelFeedItemProps {
  description?: string | undefined
  reel: Reel
  height: number
  isActive: boolean
  shouldWarmVideo?: boolean | undefined
  offlineVideoCachePriority?: number | undefined
  enableStatusPolling?: boolean | undefined
  hideCaption?: boolean | undefined
  isMuted: boolean
  bottomContentInset?: number | undefined
  onToggleMuted: () => void
  onDeleted?: ((reelId: string) => void) | undefined
  onIntentionalPauseChange?: ((paused: boolean) => void) | undefined
  onPlaybackProgress?:
    | ((
        reelId: string,
        progress: ReelVideoProgress,
        state: { isPlaying: boolean; isReady: boolean },
      ) => void)
    | undefined
  onTimelineInteractionChange?: ((isInteracting: boolean) => void) | undefined
  onPlayerChange?: ((reelId: string, player: ReelVideoHandle | null) => void) | undefined
}

type ReelWithLocalThumbnail = Reel & {
  localThumbnailUri?: string
}

const SCRUBBER_TOUCH_ZONE_HEIGHT = 40
const METADATA_GAP_ABOVE_SCRUB_RAIL = 24
const TIMELINE_ACTIVE_HEIGHT = 10
const TIMELINE_CHIP_WIDTH = 74
const TIMELINE_CHIP_BOTTOM_OFFSET = 4
const TIMELINE_MOTION_EASING = Easing.bezier(0.22, 1, 0.36, 1)
const TIMELINE_PLAYBACK_EASING = Easing.linear
const clamp = (value: number, min: number, max: number) => {
  'worklet'

  return Math.min(max, Math.max(min, value))
}
const formatPlaybackTime = (value: number) => {
  const safeValue = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  const minutes = Math.floor(safeValue / 60)
  const seconds = safeValue % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const styles = StyleSheet.create({
  containedMediaFrame: {
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  immersiveBackground: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.8,
  },
  immersiveBackgroundDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 5, 5, 0.34)',
  },
  mediaStage: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
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

type ReelPlaybackContentFit = 'cover' | 'contain'

const getStablePlaybackContentFit = (reel: Reel): ReelPlaybackContentFit | null => {
  if (reel.edit?.framing === 'crop') {
    return 'cover'
  }

  if (reel.edit?.framing !== 'fit') {
    return null
  }

  if (reel.sourceOrientation === 'PORTRAIT') {
    return 'cover'
  }

  if (reel.sourceOrientation === 'LANDSCAPE' || reel.sourceOrientation === 'SQUARE') {
    return 'contain'
  }

  if (
    typeof reel.sourceAspectRatio === 'number' &&
    Number.isFinite(reel.sourceAspectRatio) &&
    reel.sourceAspectRatio > 0
  ) {
    return reel.sourceAspectRatio >= 0.9 ? 'contain' : 'cover'
  }

  return null
}

const getPlaybackState = (reel: Reel, streamUrl?: string | null) => {
  if (Boolean(streamUrl) && isReelPlayable({ ...reel, streamUrl: streamUrl ?? reel.streamUrl })) {
    return { isPlayable: true, label: null }
  }

  if (isReelMediaFailed(reel)) {
    return { isPlayable: false, label: 'Failed' }
  }

  return { isPlayable: false, label: reel.mediaStatus === 'PENDING' ? 'Queued' : 'Processing' }
}

const normalizeProgress = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const percentValue = value <= 1 ? value * 100 : value
  return Math.min(100, Math.max(0, Math.round(percentValue)))
}

const getAuthorHandle = (username?: string | null) => {
  const normalized = username?.trim().replace(/^@+/, '')

  return normalized || null
}

const ReelFeedItemComponent = function ReelFeedItem({
  description,
  reel,
  height,
  isActive,
  shouldWarmVideo = false,
  offlineVideoCachePriority,
  enableStatusPolling = false,
  hideCaption = false,
  isMuted,
  bottomContentInset = 0,
  onToggleMuted,
  onDeleted,
  onIntentionalPauseChange,
  onPlaybackProgress,
  onTimelineInteractionChange,
  onPlayerChange,
}: ReelFeedItemProps) {
  const router = useRouter()
  const { user } = useAuthStore()
  const videoRef = useRef<ReelVideoHandle | null>(null)
  const playerIdentityRef = useRef({ playerGeneration: 0, reelId: reel.id, sourceKey: '' })
  const lastBufferedPositionRef = useRef(0)
  const lastPlaybackPositionRef = useRef(0)
  const isPausedByUserRef = useRef(false)
  const [isReady, setIsReady] = useState(false)
  const [bufferedPosition, setBufferedPosition] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [isPausedByUser, setIsPausedByUserState] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [hasPlaybackError, setHasPlaybackError] = useState(false)
  const [playbackPosition, setPlaybackPosition] = useState(0)
  const [pendingSeekRatio, setPendingSeekRatio] = useState<number | null>(null)
  const [scrubPosition, setScrubPosition] = useState(0)
  const [scrubberWidth, setScrubberWidth] = useState(0)
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showShareSheet, setShowShareSheet] = useState(false)
  const { data: processingStatus } = useReelProcessingStatus(reel, {
    enabled: enableStatusPolling,
  })
  const shouldFetchReelDetail =
    !reel.id.startsWith(CHAT_SHARED_REEL_FALLBACK_ID_PREFIX) &&
    (!reel.author?.username ||
      !reel.author?.avatarUrl ||
      reel.tags.length === 0 ||
      !reel.description?.trim())
  const { data: reelDetail } = useReelDetail(reel.id, {
    enabled: shouldFetchReelDetail,
  })
  const deleteReel = useDeleteReel()
  const reprocessReel = useReprocessReel()
  const displayReel = useMemo<ReelWithLocalThumbnail>(() => {
    const sourceReel = reel as ReelWithLocalThumbnail
    const nextReel: ReelWithLocalThumbnail = processingStatus
      ? mergeReelProcessingStatus(sourceReel, processingStatus)
      : { ...sourceReel }

    if (reelDetail?.title?.trim()) {
      nextReel.title = reelDetail.title
    }

    if (reelDetail?.description?.trim()) {
      nextReel.description = reelDetail.description
    }

    if (reelDetail?.tags.length) {
      nextReel.tags = reelDetail.tags
    }

    if (reelDetail?.author) {
      nextReel.author = {
        ...(nextReel.author ?? {}),
        ...reelDetail.author,
      }
    }

    if (reelDetail?.thumbnailUrl) {
      nextReel.thumbnailUrl = reelDetail.thumbnailUrl
    }

    return nextReel
  }, [processingStatus, reel, reelDetail])
  const offlineVideoSource = useOfflineReelVideoSource(displayReel, {
    enabled: shouldWarmVideo,
    shouldPrepareOfflineVideo: typeof offlineVideoCachePriority === 'number',
    ...(typeof offlineVideoCachePriority === 'number'
      ? { cachePriority: offlineVideoCachePriority }
      : {}),
  })
  const videoSourceKey = `${displayReel.id}:${offlineVideoSource.uri}`

  if (playerIdentityRef.current.sourceKey !== videoSourceKey) {
    playerIdentityRef.current = {
      playerGeneration: playerIdentityRef.current.playerGeneration + 1,
      reelId: displayReel.id,
      sourceKey: videoSourceKey,
    }
  }

  const playerGeneration = playerIdentityRef.current.playerGeneration
  const resumeAfterScrub = useSharedValue(0)
  const pendingSeekTarget = useSharedValue(-1)
  const lastScrubRatio = useSharedValue(0)
  const scrubReleaseHandled = useSharedValue(0)
  const timelineInteractionProgress = useSharedValue(0)
  const timelinePreviewRatio = useSharedValue(0)
  const uploadRailShimmerProgress = useSharedValue(0)
  const setIsPausedByUser = useCallback(
    (paused: boolean) => {
      isPausedByUserRef.current = paused

      if (paused) {
        cancelAnimation(timelinePreviewRatio)
        videoRef.current?.pause()
      }

      setIsPausedByUserState(paused)
    },
    [timelinePreviewRatio],
  )
  const playbackState = useMemo(
    () => getPlaybackState(displayReel, offlineVideoSource.uri),
    [displayReel, offlineVideoSource.uri],
  )
  const descriptionText = displayReel.description?.trim() || description?.trim()
  const titleText = displayReel.title?.trim()
  const effectiveAuthor =
    displayReel.author ||
    (user && displayReel.userId === user.id
      ? {
          id: user.id,
          username: user.username ?? null,
          displayName: user.fullName ?? null,
          avatarUrl: user.picture ?? null,
          isVerified: false,
        }
      : null)
  const authorHandle = getAuthorHandle(effectiveAuthor?.username)
  const authorDisplayName = effectiveAuthor?.displayName?.trim() || authorHandle || 'Creator'
  const authorNameLine =
    effectiveAuthor?.displayName?.trim() || (authorHandle ? `@${authorHandle}` : 'Creator')
  const authorUsernameLine = authorHandle ? `@${authorHandle}` : authorNameLine
  const canOpenAuthorProfile = Boolean(authorHandle) || displayReel.userId === user?.id
  const captionText = hideCaption ? '' : descriptionText || titleText || 'Shared a new reel.'
  const hashtagLine = hideCaption
    ? ''
    : displayReel.tags
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter(Boolean)
        .map((tag) => `#${tag}`)
        .join(' ')
  const canExpandMetadata = captionText.length > 44 || hashtagLine.length > 40
  const avatarInitials = getInitials(authorDisplayName)
  const pendingSeekPosition =
    pendingSeekRatio !== null && durationSeconds > 0 ? pendingSeekRatio * durationSeconds : null
  const showScrubber = isScrubbing && durationSeconds > 0 && isActive
  const showLoadingRail = isActive && offlineVideoSource.isOfflineVideoUnavailable
  const showPausedControls =
    isPausedByUser &&
    !isScrubbing &&
    !showLoadingRail &&
    isActive &&
    playbackState.isPlayable &&
    !hasPlaybackError
  const shouldRenderVideo = playbackState.isPlayable && shouldWarmVideo
  const effectivePosition = isScrubbing ? scrubPosition : playbackPosition
  const timelinePosition = pendingSeekPosition ?? effectivePosition
  const bufferedRatio = durationSeconds > 0 ? clamp(bufferedPosition / durationSeconds, 0, 1) : 0
  const safeBottomContentInset = Math.max(0, bottomContentInset)
  const scrubRailBottom = safeBottomContentInset
  const metadataBottom = safeBottomContentInset + METADATA_GAP_ABOVE_SCRUB_RAIL
  const timelineLabel = formatPlaybackTime(timelinePosition)
  const timelineChipWidth = TIMELINE_CHIP_WIDTH
  const processingMessage = displayReel.message ?? displayReel.processingMessage
  const processingProgress = normalizeProgress(
    displayReel.progress ?? displayReel.processingProgress,
  )
  const isFailed = isReelMediaFailed(displayReel)
  const shouldAnimateUploadRail =
    typeof processingProgress === 'number' && !isFailed && !hasPlaybackError
  const canManageReel = user?.id === displayReel.userId
  const posterUri =
    offlineVideoSource.posterUri ?? displayReel.thumbnailUrl ?? displayReel.localThumbnailUri
  const stablePlaybackContentFit = getStablePlaybackContentFit(displayReel)
  const playbackContentFit = stablePlaybackContentFit ?? 'cover'
  const isContainedPlayback = playbackContentFit === 'contain'
  const shouldRenderImmersiveBackground = isContainedPlayback && Boolean(posterUri)
  const containedMediaAspectRatio =
    typeof displayReel.sourceAspectRatio === 'number' &&
    Number.isFinite(displayReel.sourceAspectRatio) &&
    displayReel.sourceAspectRatio > 0
      ? displayReel.sourceAspectRatio
      : displayReel.sourceOrientation === 'LANDSCAPE'
        ? 16 / 9
        : 1
  const shouldShowVideoLayer = isActive || isReady || playbackPosition > 0

  const triggerScrubStartHaptic = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined)
  }, [])

  useEffect(() => {
    cancelAnimation(uploadRailShimmerProgress)

    if (!shouldAnimateUploadRail) {
      uploadRailShimmerProgress.value = 0
      return
    }

    uploadRailShimmerProgress.value = 0
    uploadRailShimmerProgress.value = withRepeat(
      withTiming(1, {
        duration: 1050,
        easing: Easing.linear,
      }),
      -1,
      false,
    )

    return () => {
      cancelAnimation(uploadRailShimmerProgress)
    }
  }, [shouldAnimateUploadRail, uploadRailShimmerProgress])

  const uploadRailShimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      uploadRailShimmerProgress.value,
      [0, 0.08, 0.5, 0.92, 1],
      [0, 0.68, 0.4, 0.68, 0],
    ),
    transform: [
      {
        translateX: interpolate(uploadRailShimmerProgress.value, [0, 1], [-56, 280]),
      },
    ],
  }))

  const triggerScrubSettleHaptic = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
  }, [])

  const handleAuthorPress = useCallback(() => {
    if (displayReel.userId === user?.id) {
      router.push('/profile')
      return
    }

    if (authorHandle) {
      router.push(`/users/${authorHandle}`)
    }
  }, [authorHandle, displayReel.userId, router, user?.id])

  const handleProgress = ({
    bufferedPosition: nextBufferedPosition,
    currentTime,
    duration,
    isBuffering,
  }: ReelVideoProgress) => {
    onPlaybackProgress?.(
      displayReel.id,
      { bufferedPosition: nextBufferedPosition, currentTime, duration, isBuffering },
      {
        isPlaying: isActive && isReady && !isPausedByUserRef.current && !isBuffering,
        isReady,
      },
    )
    if (duration > 0 && duration !== durationSeconds) {
      setDurationSeconds(duration)
    }

    if (!isPausedByUserRef.current && !isScrubbing && pendingSeekRatio === null && duration > 0) {
      const nextProgressRatio = clamp(currentTime / duration, 0, 1)

      timelinePreviewRatio.value =
        currentTime < lastPlaybackPositionRef.current
          ? nextProgressRatio
          : withTiming(nextProgressRatio, {
              duration: 280,
              easing: TIMELINE_PLAYBACK_EASING,
            })
    }

    const shouldCommitPlaybackPosition =
      currentTime === 0 ||
      currentTime < lastPlaybackPositionRef.current ||
      Math.abs(currentTime - lastPlaybackPositionRef.current) >= 0.5

    if (shouldCommitPlaybackPosition) {
      lastPlaybackPositionRef.current = currentTime
      setPlaybackPosition(currentTime)
    }

    const shouldTrackBufferedPosition =
      pendingSeekTarget.value >= 0 || isScrubbing || pendingSeekRatio !== null

    if (
      shouldTrackBufferedPosition &&
      typeof nextBufferedPosition === 'number' &&
      nextBufferedPosition >= 0 &&
      Math.abs(nextBufferedPosition - lastBufferedPositionRef.current) >= 0.25
    ) {
      lastBufferedPositionRef.current = nextBufferedPosition
      setBufferedPosition(nextBufferedPosition)
    }

    const pendingSeekTargetValue = pendingSeekTarget.value
    const isTargetBuffered =
      pendingSeekTargetValue < 0 ||
      typeof nextBufferedPosition !== 'number' ||
      nextBufferedPosition >= pendingSeekTargetValue - 0.2

    if (
      pendingSeekTargetValue >= 0 &&
      !isScrubbing &&
      Math.abs(currentTime - pendingSeekTargetValue) < 0.45 &&
      isTargetBuffered
    ) {
      pendingSeekTarget.value = -1
      setPendingSeekRatio(null)
      triggerScrubSettleHaptic()
    }
  }

  const seekToRatio = useCallback(
    (ratio: number) => {
      if (durationSeconds <= 0) {
        return
      }

      const safeRatio = clamp(ratio, 0, 1)
      lastScrubRatio.value = safeRatio
      const nextPosition = safeRatio * durationSeconds
      pendingSeekTarget.value = nextPosition
      setPendingSeekRatio(safeRatio)
      setScrubPosition(nextPosition)
      videoRef.current?.seekTo(nextPosition)
    },
    [durationSeconds, lastScrubRatio, pendingSeekTarget],
  )

  const beginScrub = useCallback(
    (touchX: number) => {
      if (durationSeconds <= 0 || scrubberWidth <= 0) {
        return
      }

      scrubReleaseHandled.value = 0
      resumeAfterScrub.value = isPausedByUser ? 0 : 1
      setIsPausedByUser(true)
      setIsScrubbing(true)
      triggerScrubStartHaptic()
      seekToRatio(touchX / scrubberWidth)
    },
    [
      durationSeconds,
      isPausedByUser,
      resumeAfterScrub,
      scrubReleaseHandled,
      scrubberWidth,
      seekToRatio,
      setIsPausedByUser,
      triggerScrubStartHaptic,
    ],
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

  const finishScrub = useCallback(
    (touchX?: number, velocityX = 0) => {
      if (scrubReleaseHandled.value === 1) {
        return
      }

      scrubReleaseHandled.value = 1

      if (typeof touchX === 'number' && durationSeconds > 0 && scrubberWidth > 0) {
        const baseRatio = clamp(touchX / scrubberWidth, 0, 1)
        const momentumSeconds =
          Math.abs(velocityX) > 260
            ? clamp((velocityX / Math.max(scrubberWidth, 1)) * (durationSeconds * 0.018), -3.5, 3.5)
            : 0
        const nextRatio = clamp(baseRatio + momentumSeconds / Math.max(durationSeconds, 1), 0, 1)
        timelinePreviewRatio.value = withTiming(nextRatio, {
          duration: 90,
          easing: TIMELINE_MOTION_EASING,
        })
        seekToRatio(nextRatio)
      }

      setIsScrubbing(false)

      if (resumeAfterScrub.value === 1) {
        setIsPausedByUser(false)
      }
    },
    [
      durationSeconds,
      resumeAfterScrub,
      scrubReleaseHandled,
      scrubberWidth,
      seekToRatio,
      setIsPausedByUser,
      timelinePreviewRatio,
    ],
  )

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
          const ratio = scrubberWidth > 0 ? clamp(event.x / scrubberWidth, 0, 1) : 0
          timelinePreviewRatio.value = ratio
          scheduleOnRN(beginScrub, event.x)
        })
        .onUpdate((event) => {
          const ratio = scrubberWidth > 0 ? clamp(event.x / scrubberWidth, 0, 1) : 0
          timelinePreviewRatio.value = ratio
          scheduleOnRN(updateScrub, event.x)
        })
        .onEnd((event) => {
          const ratio = scrubberWidth > 0 ? clamp(event.x / scrubberWidth, 0, 1) : 0
          timelinePreviewRatio.value = ratio
          scheduleOnRN(finishScrub, event.x, event.velocityX)
        })
        .onFinalize(() => {
          scheduleOnRN(finishScrub, lastScrubRatio.value * scrubberWidth, 0)
        }),
    [
      beginScrub,
      durationSeconds,
      finishScrub,
      isActive,
      lastScrubRatio,
      playbackState.isPlayable,
      scrubberWidth,
      timelinePreviewRatio,
      updateScrub,
    ],
  )

  useEffect(() => {
    timelineInteractionProgress.value = withTiming(showScrubber ? 1 : 0, {
      duration: showScrubber ? 160 : 210,
      easing: TIMELINE_MOTION_EASING,
    })
  }, [showScrubber, timelineInteractionProgress])

  useEffect(() => {
    onTimelineInteractionChange?.(isScrubbing)

    return () => {
      onTimelineInteractionChange?.(false)
    }
  }, [isScrubbing, onTimelineInteractionChange])

  const timelineFillStyle = useAnimatedStyle(() => ({
    width: scrubberWidth * timelinePreviewRatio.value,
  }))

  const timelineOverlayStyle = useAnimatedStyle(() => ({
    opacity: timelineInteractionProgress.value,
    transform: [
      {
        translateY: interpolate(timelineInteractionProgress.value, [0, 1], [6, 0]),
      },
    ],
  }))

  const timelineBaseStyle = useAnimatedStyle(() => ({
    opacity: 1 - timelineInteractionProgress.value,
  }))

  const timelineChipStyle = useAnimatedStyle(() => {
    const maxTranslate = Math.max(8, scrubberWidth - timelineChipWidth - 8)
    const translateX = Math.max(
      8,
      Math.min(maxTranslate, scrubberWidth * timelinePreviewRatio.value - timelineChipWidth / 2),
    )

    return {
      opacity: timelineInteractionProgress.value,
      transform: [
        { translateX },
        { translateY: interpolate(timelineInteractionProgress.value, [0, 1], [8, 0]) },
      ],
    }
  })

  const resetTimelineState = useCallback(
    ({
      includeDuration = false,
      resetReadyState = false,
    }: { includeDuration?: boolean; resetReadyState?: boolean } = {}) => {
      pendingSeekTarget.value = -1
      lastScrubRatio.value = 0
      resumeAfterScrub.value = 0
      scrubReleaseHandled.value = 0
      timelinePreviewRatio.value = 0
      timelineInteractionProgress.value = 0
      lastBufferedPositionRef.current = 0
      lastPlaybackPositionRef.current = 0
      setBufferedPosition(0)
      if (includeDuration) {
        setDurationSeconds(0)
      }
      if (resetReadyState) {
        setIsReady(false)
      }
      setHasPlaybackError(false)
      setIsPausedByUser(false)
      setIsScrubbing(false)
      setPendingSeekRatio(null)
      setPlaybackPosition(0)
      setScrubPosition(0)
    },
    [
      lastScrubRatio,
      pendingSeekTarget,
      resumeAfterScrub,
      scrubReleaseHandled,
      timelineInteractionProgress,
      timelinePreviewRatio,
      setIsPausedByUser,
    ],
  )

  useEffect(() => {
    resetTimelineState({ includeDuration: true, resetReadyState: true })
  }, [resetTimelineState, videoSourceKey])

  useEffect(() => {
    if (!isActive) {
      resetTimelineState({ resetReadyState: !shouldWarmVideo })
      return
    }

    setHasPlaybackError(false)
  }, [isActive, resetTimelineState, shouldWarmVideo])

  useEffect(() => {
    if (isActive) {
      onIntentionalPauseChange?.(isPausedByUser)
    }
  }, [isActive, isPausedByUser, onIntentionalPauseChange])

  const setVideoRef = useCallback(
    (player: ReelVideoHandle | null) => {
      videoRef.current = player
      onPlayerChange?.(displayReel.id, player)
    },
    [displayReel.id, onPlayerChange],
  )

  useEffect(
    () => () => {
      onPlayerChange?.(displayReel.id, null)
    },
    [displayReel.id, onPlayerChange],
  )

  return (
    <View className="flex-1 overflow-hidden bg-[#050505]" style={{ height }}>
      <View className="flex-1 overflow-hidden bg-[#050505]">
        {shouldRenderImmersiveBackground && posterUri ? (
          <>
            <Image
              pointerEvents="none"
              source={{ uri: posterUri }}
              contentFit="cover"
              blurRadius={24}
              style={styles.immersiveBackground}
            />
            <View pointerEvents="none" style={styles.immersiveBackgroundDim} />
          </>
        ) : null}

        <View pointerEvents="none" style={styles.mediaStage}>
          <View
            style={
              isContainedPlayback
                ? [styles.containedMediaFrame, { aspectRatio: containedMediaAspectRatio }]
                : styles.fill
            }
          >
            {posterUri ? (
              <Image
                source={{ uri: posterUri }}
                contentFit={playbackContentFit}
                style={styles.video}
              />
            ) : (
              <View style={styles.video} />
            )}

            {shouldRenderVideo ? (
              <ReelVideo
                ref={setVideoRef}
                uri={offlineVideoSource.uri}
                {...(posterUri ? { posterUri } : {})}
                shouldPlay={isActive && !isPausedByUser && !hasPlaybackError}
                loop
                muted={isMuted || !isActive}
                contentFit={playbackContentFit}
                disableOrientationAwareContentFit={stablePlaybackContentFit !== null}
                resetOnPause={false}
                externallyManagedPlayback
                onReady={() => {
                  if (
                    !isCurrentReelPlayerCallback(
                      displayReel.id,
                      playerGeneration,
                      playerIdentityRef.current,
                    )
                  ) {
                    return
                  }

                  setIsReady(true)
                }}
                onError={() => {
                  if (
                    !isCurrentReelPlayerCallback(
                      displayReel.id,
                      playerGeneration,
                      playerIdentityRef.current,
                    )
                  ) {
                    return
                  }

                  setHasPlaybackError(true)
                }}
                {...(isActive
                  ? {
                      onProgress: (progress: ReelVideoProgress) => {
                        if (
                          isCurrentReelPlayerCallback(
                            displayReel.id,
                            playerGeneration,
                            playerIdentityRef.current,
                          )
                        ) {
                          handleProgress(progress)
                        }
                      },
                    }
                  : {})}
                style={[styles.videoOverlay, { opacity: shouldShowVideoLayer ? 1 : 0 }]}
              />
            ) : null}
          </View>
        </View>

        <LinearGradient
          colors={['rgba(0,0,0,0.10)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.92)']}
          locations={[0, 0.48, 1]}
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
              <View className="items-center">
                <TouchableOpacity
                  className="mb-4 h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/40"
                  activeOpacity={0.84}
                  onPress={(event) => {
                    event.stopPropagation()
                    onToggleMuted()
                  }}
                >
                  <Ionicons
                    name={isMuted ? 'volume-mute' : 'volume-high'}
                    size={16}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  className="h-[68px] w-[68px] items-center justify-center rounded-full border border-white/15 bg-black/40"
                  activeOpacity={0.84}
                  onPress={(event) => {
                    event.stopPropagation()
                    setIsPausedByUser(false)
                  }}
                >
                  <Ionicons name="play" size={30} color="#FFFFFF" style={{ marginLeft: 3 }} />
                </TouchableOpacity>
              </View>
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
                <Animated.View
                  className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-white/18"
                  style={timelineBaseStyle}
                >
                  <View
                    className="absolute inset-y-0 left-0 bg-white/24"
                    style={{ width: `${bufferedRatio * 100}%` }}
                  />
                  <Animated.View
                    className="absolute inset-y-0 left-0 rounded-full bg-white/90"
                    style={timelineFillStyle}
                  />
                </Animated.View>

                <Animated.View
                  pointerEvents="none"
                  className="absolute inset-x-0 bottom-0"
                  style={timelineOverlayStyle}
                >
                  <Animated.View
                    className="absolute rounded-full bg-black/58 px-3 py-1.5"
                    style={[
                      { bottom: TIMELINE_CHIP_BOTTOM_OFFSET, width: timelineChipWidth },
                      timelineChipStyle,
                    ]}
                  >
                    <View className="flex-row items-center justify-center">
                      <Text className="text-xs2 font-medium text-white">{timelineLabel}</Text>
                    </View>
                  </Animated.View>

                  <View
                    className="absolute inset-x-0 bottom-0 h-[4px] rounded-full bg-white/18"
                    style={{ height: TIMELINE_ACTIVE_HEIGHT }}
                  >
                    <View
                      className="absolute inset-y-0 left-0 bg-white/28"
                      style={{ width: `${bufferedRatio * 100}%` }}
                    />
                    <Animated.View
                      className="absolute inset-y-0 left-0 rounded-full bg-white"
                      style={timelineFillStyle}
                    />
                  </View>
                </Animated.View>
              </View>
            </View>
          </GestureDetector>
        ) : null}

        {showLoadingRail ? <ReelLoadingRail bottomOffset={scrubRailBottom} /> : null}

        {(!playbackState.isPlayable && !offlineVideoSource.isOfflineVideoUnavailable) ||
        hasPlaybackError ? (
          <View
            pointerEvents={isFailed ? 'auto' : 'none'}
            className="absolute inset-0 items-center justify-center px-8"
          >
            <View className="w-full max-w-[300px] items-center rounded-[28px] bg-black/58 px-6 py-6">
              {hasPlaybackError ? (
                <>
                  <View className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-white/10">
                    <Ionicons name="alert-circle-outline" size={26} color="#FF935B" />
                  </View>
                  <Text className="text-center font-heading text-xl text-white">
                    Playback unavailable
                  </Text>
                  <Text className="mt-2 text-center text-sm2 leading-5 text-white/70">
                    This reel could not be played.
                  </Text>
                </>
              ) : isFailed ? (
                <>
                  <View className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-white/10">
                    <Ionicons name="cloud-offline-outline" size={25} color="#FF935B" />
                  </View>
                  <Text className="text-center font-heading text-xl text-white">Upload failed</Text>
                  <Text className="mt-2 text-center text-sm2 leading-5 text-white/70">
                    {processingMessage || 'Something went wrong while uploading this reel.'}
                  </Text>

                  {canManageReel ? (
                    <TouchableOpacity
                      accessibilityLabel="Retry reel upload"
                      accessibilityRole="button"
                      className="mt-4 h-11 items-center justify-center rounded-full bg-brand px-5"
                      activeOpacity={0.84}
                      disabled={reprocessReel.isPending}
                      onPress={() => {
                        setHasPlaybackError(false)

                        reprocessReel.mutate(displayReel.id)
                      }}
                      style={reprocessReel.isPending ? { opacity: 0.72 } : undefined}
                    >
                      <Text className="text-center font-medium text-white">
                        {reprocessReel.isPending ? 'Retrying...' : 'Try again'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : typeof processingProgress === 'number' ? (
                <>
                  <View className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-white/10">
                    <Ionicons name="cloud-upload-outline" size={26} color="#FF935B" />
                  </View>
                  <Text className="text-center font-heading text-xl text-white">Uploading</Text>
                  <View className="mt-4 w-full">
                    <View className="h-2 overflow-hidden rounded-full bg-white/16">
                      <View
                        className="h-full overflow-hidden rounded-full bg-brand"
                        style={{ width: `${processingProgress}%` }}
                      >
                        <Animated.View
                          className="absolute inset-y-0 left-0 w-14 bg-white/35"
                          style={uploadRailShimmerStyle}
                        />
                      </View>
                    </View>
                    <Text className="mt-2 text-center text-base2 font-medium text-white/80">
                      {processingProgress}%
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <View className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-white/10">
                    <Ionicons name="sync-outline" size={25} color="#FF935B" />
                  </View>
                  <Text className="text-center font-heading text-xl text-white">Processing</Text>
                  <Text className="mt-2 text-center text-sm2 leading-5 text-white/70">
                    Your reel is being processed...
                  </Text>
                </>
              )}
            </View>
          </View>
        ) : null}

        <View
          pointerEvents="box-none"
          className="absolute inset-x-0"
          style={{ bottom: metadataBottom }}
        >
          <View className="px-4">
            <View className="flex-row items-start">
              <View className="max-w-[82%] flex-1 pr-3">
                <View className="flex-row items-center">
                  <TouchableOpacity
                    accessibilityLabel={
                      canOpenAuthorProfile ? `Open ${authorUsernameLine}'s profile` : undefined
                    }
                    accessibilityRole={canOpenAuthorProfile ? 'button' : undefined}
                    activeOpacity={0.84}
                    className="h-11 w-11 items-center justify-center rounded-full"
                    disabled={!canOpenAuthorProfile}
                    onPress={handleAuthorPress}
                  >
                    {effectiveAuthor?.avatarUrl ? (
                      <Image
                        source={{ uri: effectiveAuthor.avatarUrl }}
                        contentFit="cover"
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: 21,
                          backgroundColor: '#121212',
                        }}
                      />
                    ) : (
                      <View className="h-[42px] w-[42px] items-center justify-center rounded-full bg-[#2F6FED]">
                        <Text className="font-heading text-sm text-white">{avatarInitials}</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.84}
                    className="ml-3 min-w-0 flex-1 py-2"
                    disabled={!canOpenAuthorProfile}
                    onPress={handleAuthorPress}
                  >
                    <Text
                      className="font-semibold text-md text-white"
                      numberOfLines={1}
                      style={{
                        textShadowColor: 'rgba(0, 0, 0, 0.7)',
                        textShadowOffset: { width: 0, height: 1 },
                        textShadowRadius: 3,
                      }}
                    >
                      {authorUsernameLine}
                    </Text>
                  </TouchableOpacity>
                </View>

                {captionText ? (
                  <View className="mt-2">
                    <Text
                      className="text-base2 font-medium leading-6 text-white"
                      numberOfLines={isCaptionExpanded ? undefined : 1}
                    >
                      {captionText}
                    </Text>
                    {canExpandMetadata ? (
                      <TouchableOpacity
                        accessibilityLabel={
                          isCaptionExpanded ? 'Show less reel details' : 'Show more reel details'
                        }
                        accessibilityRole="button"
                        activeOpacity={0.76}
                        className="min-h-7 self-start justify-center"
                        onPress={() => {
                          setIsCaptionExpanded((current) => !current)
                        }}
                      >
                        <Text className="text-sm2 font-semibold text-white/75">
                          {isCaptionExpanded ? 'less' : '… more'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}

                {hashtagLine ? (
                  <Text
                    className="mt-2 text-sm2 font-semibold leading-5 text-[#FFB18E]"
                    numberOfLines={isCaptionExpanded ? undefined : 1}
                  >
                    {hashtagLine}
                  </Text>
                ) : null}
              </View>

              <View className="ml-auto items-center gap-2">
                <TouchableOpacity
                  accessibilityLabel="Share reel"
                  accessibilityRole="button"
                  className="h-11 w-11 items-center justify-center"
                  activeOpacity={0.84}
                  onPress={() => {
                    setShowShareSheet(true)
                  }}
                >
                  <Ionicons name="paper-plane-outline" size={24} color="#FFFFFF" />
                </TouchableOpacity>

                {canManageReel ? (
                  <TouchableOpacity
                    accessibilityLabel="More reel actions"
                    accessibilityRole="button"
                    className="h-11 w-11 items-center justify-center"
                    activeOpacity={0.84}
                    onPress={() => {
                      setShowActionsMenu(true)
                    }}
                  >
                    <Ionicons name="ellipsis-horizontal" size={25} color="#FFFFFF" />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        </View>

        <ReelShareSheet
          visible={showShareSheet}
          reel={displayReel}
          onClose={() => {
            setShowShareSheet(false)
          }}
        />

        <ReelActionsMenu
          visible={showActionsMenu}
          onEdit={() => {
            router.push(`/reels/${displayReel.id}/edit`)
          }}
          onDelete={() => {
            setShowDeleteModal(true)
          }}
          onClose={() => {
            setShowActionsMenu(false)
          }}
        />

        <DeleteReelModal
          visible={showDeleteModal}
          reel={displayReel}
          isDeleting={deleteReel.isPending}
          onConfirm={() => {
            deleteReel.mutate(displayReel.id, {
              onSuccess: () => {
                setShowDeleteModal(false)
                setShowActionsMenu(false)
                onDeleted?.(displayReel.id)
              },
            })
          }}
          onCancel={() => {
            setShowDeleteModal(false)
          }}
        />
      </View>
    </View>
  )
}

const areReelFeedItemPropsEqual = (previous: ReelFeedItemProps, next: ReelFeedItemProps) =>
  previous.reel === next.reel &&
  previous.description === next.description &&
  previous.height === next.height &&
  previous.isActive === next.isActive &&
  previous.shouldWarmVideo === next.shouldWarmVideo &&
  previous.offlineVideoCachePriority === next.offlineVideoCachePriority &&
  previous.enableStatusPolling === next.enableStatusPolling &&
  previous.hideCaption === next.hideCaption &&
  previous.isMuted === next.isMuted &&
  previous.bottomContentInset === next.bottomContentInset &&
  previous.onToggleMuted === next.onToggleMuted &&
  previous.onDeleted === next.onDeleted &&
  previous.onIntentionalPauseChange === next.onIntentionalPauseChange &&
  previous.onPlaybackProgress === next.onPlaybackProgress &&
  previous.onTimelineInteractionChange === next.onTimelineInteractionChange &&
  previous.onPlayerChange === next.onPlayerChange

export const ReelFeedItem = memo(ReelFeedItemComponent, areReelFeedItemPropsEqual)
