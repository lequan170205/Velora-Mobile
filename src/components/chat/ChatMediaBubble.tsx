import { MaterialIcons } from '@expo/vector-icons'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native'
import Animated, {
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import {
  calculateChatMediaDisplaySize,
  getChatMediaMaxWidth,
  getMediaUploadStage,
  getResolvedMediaUri,
} from '../../lib/chatMedia'
import { formatDurationLabel } from '../../lib/reels'
import { useChatMediaUploadStore } from '../../stores/chatMediaUploadStore'
import { useChatStore } from '../../stores/chatStore'
import { useChatVideoPlaybackStore } from '../../stores/chatVideoPlaybackStore'
import { ReelVideo } from '../reels/ReelVideo'

import { ChatMediaFrame } from './ChatMediaFrame'

import type { ChatMediaViewerOpenPayload } from './ChatMediaViewer'
import type { Message } from '../../types/conversation.types'

interface ChatMediaBubbleProps {
  message: Message
  delayLongPress?: number
  onLongPress?: () => void
  onPressIn?: () => void
  onOpenMedia?: (payload: ChatMediaViewerOpenPayload) => void
}

const getStageLabel = (stage: ReturnType<typeof getMediaUploadStage>) => {
  switch (stage) {
    case 'queued':
      return 'Queued'
    case 'uploading':
      return 'Uploading'
    case 'syncing':
      return 'Syncing'
    case 'processing':
      return 'Processing'
    case 'failed':
      return 'Failed'
    default:
      return null
  }
}

export function ChatMediaBubble({
  delayLongPress,
  message,
  onLongPress,
  onPressIn,
  onOpenMedia,
}: ChatMediaBubbleProps) {
  const { width: screenWidth } = useWindowDimensions()
  const mediaRef = useAnimatedRef<View>()
  const didLongPressRef = useRef(false)
  const clientMessageId = message.clientMessageId ?? message.id
  const uploadJob = useChatMediaUploadStore((state) => state.jobsById[clientMessageId] ?? null)
  const progress = useChatMediaUploadStore(
    (state) => state.progressById[clientMessageId]?.progress ?? 0,
  )
  const isCancelRequested = useChatMediaUploadStore((state) =>
    Boolean(state.cancelRequestById[clientMessageId]),
  )
  const retryJob = useChatMediaUploadStore((state) => state.retryJob)
  const requestCancel = useChatMediaUploadStore((state) => state.requestCancel)
  const setActiveMessage = useChatVideoPlaybackStore((state) => state.setActiveMessage)
  const isInlineVideoActive = useChatVideoPlaybackStore(
    (state) => state.activeMessageIdByConversation[message.conversationId] === message.id,
  )
  const [memoWidth, setMemoWidth] = useState(uploadJob?.displayWidth)
  const [memoHeight, setMemoHeight] = useState(uploadJob?.displayHeight)
  const [memoizedPoster, setMemoizedPoster] = useState(
    uploadJob?.localPosterUri ?? message.media?.localPosterUri ?? null,
  )
  const progressValue = useSharedValue(progress)

  useEffect(() => {
    if (uploadJob?.displayWidth) setMemoWidth(uploadJob.displayWidth)
    if (uploadJob?.displayHeight) setMemoHeight(uploadJob.displayHeight)
    if (uploadJob?.localPosterUri ?? message.media?.localPosterUri) {
      setMemoizedPoster(uploadJob?.localPosterUri ?? message.media?.localPosterUri ?? null)
    }
  }, [
    message.media?.localPosterUri,
    uploadJob?.displayHeight,
    uploadJob?.displayWidth,
    uploadJob?.localPosterUri,
  ])

  useEffect(() => {
    progressValue.value = withTiming(progress, { duration: 140 })
  }, [progress, progressValue])

  const { displayWidth: mediaWidth, displayHeight: mediaHeight } = useMemo(() => {
    const rawWidth = message.media?.width ?? uploadJob?.width ?? undefined
    const rawHeight = message.media?.height ?? uploadJob?.height ?? undefined
    const resolvedDisplayWidth =
      message.media?.displayWidth ?? uploadJob?.displayWidth ?? memoWidth ?? undefined
    const resolvedDisplayHeight =
      message.media?.displayHeight ?? uploadJob?.displayHeight ?? memoHeight ?? undefined

    if (rawWidth && rawHeight) {
      return calculateChatMediaDisplaySize({
        height: rawHeight,
        maxWidth: getChatMediaMaxWidth(screenWidth),
        width: rawWidth,
      })
    }

    if (resolvedDisplayWidth && resolvedDisplayHeight) {
      return {
        displayWidth: resolvedDisplayWidth,
        displayHeight: resolvedDisplayHeight,
      }
    }

    return calculateChatMediaDisplaySize({
      maxWidth: getChatMediaMaxWidth(screenWidth),
      ...(rawWidth ? { width: rawWidth } : {}),
      ...(rawHeight ? { height: rawHeight } : {}),
    })
  }, [memoHeight, memoWidth, message.media, screenWidth, uploadJob])

  const mediaStage = uploadJob?.uploadStage ?? getMediaUploadStage(message.media)
  const mediaUri = getResolvedMediaUri(message.media)
  const isProcessing = mediaStage === 'processing'
  const posterUri = isProcessing
    ? memoizedPoster
    : (message.media?.thumbnailUrl ?? memoizedPoster ?? null)
  const isVideo = message.type === 'video'
  const isFailed = mediaStage === 'failed' || message.status === 'FAILED'
  const isUploading =
    mediaStage === 'queued' || mediaStage === 'uploading' || mediaStage === 'syncing'
  const canCancel =
    isUploading && Boolean(uploadJob) && !uploadJob?.deliveryStartedAt && !isCancelRequested
  const canPlayInline = isVideo && !isUploading && !isFailed && Boolean(mediaUri)
  const stageLabel = getStageLabel(mediaStage)
  const durationLabel = formatDurationLabel(
    message.media?.durationMs ?? uploadJob?.durationMs ?? null,
  )

  const progressStyle = useAnimatedStyle(() => ({
    width: mediaWidth * progressValue.value,
  }))

  const openViewer = (autoplayVideo: boolean) => {
    if (!mediaUri || !onOpenMedia) {
      return
    }

    if (isInlineVideoActive) {
      setActiveMessage(message.conversationId, null)
    }

    onOpenMedia({
      autoplayVideo,
      messageId: clientMessageId,
      sourceRef: mediaRef,
    })
  }

  const handleMediaPressIn = () => {
    didLongPressRef.current = false
    onPressIn?.()
  }

  const handleMediaLongPress = () => {
    didLongPressRef.current = true
    onLongPress?.()
  }

  const handleMediaPress = () => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false
      return
    }

    openViewer(isVideo)
  }

  const handleInlinePlayPress = (event: GestureResponderEvent) => {
    event.stopPropagation()

    if (didLongPressRef.current) {
      didLongPressRef.current = false
      return
    }

    setActiveMessage(message.conversationId, isInlineVideoActive ? null : message.id)
  }

  const handleRetry = () => {
    retryJob(clientMessageId)
    useChatStore
      .getState()
      .updateOptimisticMessage(message.conversationId, clientMessageId, (current) => ({
        ...current,
        status: 'PENDING',
        media: {
          ...(current.media ?? {}),
          uploadStage: 'queued',
        },
      }))
  }

  const mediaFrameStyle = {
    borderRadius: 18,
    height: mediaHeight,
    width: mediaWidth,
  } as const
  const mediaBubbleStyle = {
    backgroundColor: '#111111',
    borderRadius: 18,
    height: mediaHeight,
    overflow: 'hidden',
    width: mediaWidth,
  } as const
  const mediaPressableStyle = {
    height: mediaHeight,
    width: mediaWidth,
  } as const
  const frameAccessibilityLabel = isVideo ? 'Video attachment' : 'Photo attachment'
  const pressableAccessibilityLabel = isVideo ? 'Open video' : 'Open photo'
  const frameKind = isVideo ? 'video' : 'image'
  const frameUri = isVideo ? posterUri : mediaUri

  const durationBadge = durationLabel ? (
    <View
      style={{
        backgroundColor: 'rgba(12,12,13,0.68)',
        borderRadius: 999,
        bottom: 10,
        paddingHorizontal: 8,
        paddingVertical: 4,
        position: 'absolute',
        right: 10,
      }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '600' }}>{durationLabel}</Text>
    </View>
  ) : null

  const statusOverlay =
    stageLabel || isFailed ? (
      <View
        pointerEvents="box-none"
        style={{
          backgroundColor: isFailed ? 'rgba(15,15,16,0.58)' : 'rgba(15,15,16,0.24)',
          inset: 0,
          justifyContent: 'flex-end',
          position: 'absolute',
        }}
      >
        <View pointerEvents="box-none" style={{ paddingBottom: 12, paddingHorizontal: 12 }}>
          {isUploading ? (
            <View
              style={{
                backgroundColor: 'rgba(255,255,255,0.16)',
                borderRadius: 999,
                height: 4,
                marginBottom: 10,
                overflow: 'hidden',
              }}
            >
              <Animated.View
                style={[
                  progressStyle,
                  { backgroundColor: '#FF6B2C', borderRadius: 999, height: 4 },
                ]}
              />
            </View>
          ) : null}
          <View
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ color: '#FFFFFF', flex: 1, fontSize: 12, fontWeight: '600' }}>
              {isFailed
                ? message.media?.failureReason || uploadJob?.failureReason || 'Upload failed'
                : isCancelRequested
                  ? 'Canceling'
                  : stageLabel}
            </Text>
            {isFailed ? (
              <TouchableOpacity
                accessibilityLabel="Retry upload"
                accessibilityRole="button"
                activeOpacity={0.86}
                onPress={(event) => {
                  event.stopPropagation()
                  handleRetry()
                }}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.14)',
                  borderRadius: 999,
                  marginLeft: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>Retry</Text>
              </TouchableOpacity>
            ) : canCancel ? (
              <TouchableOpacity
                accessibilityLabel="Cancel upload"
                accessibilityRole="button"
                activeOpacity={0.86}
                onPress={(event) => {
                  event.stopPropagation()
                  requestCancel(clientMessageId)
                }}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.14)',
                  borderRadius: 999,
                  marginLeft: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    ) : null

  return (
    <Animated.View collapsable={false} ref={mediaRef} style={mediaBubbleStyle}>
      <Pressable
        accessibilityLabel={pressableAccessibilityLabel}
        accessibilityRole="button"
        {...(delayLongPress ? { delayLongPress } : {})}
        {...(onLongPress ? { onLongPress: handleMediaLongPress } : {})}
        onPress={handleMediaPress}
        onPressIn={handleMediaPressIn}
        style={mediaPressableStyle}
      >
        <ChatMediaFrame
          accessibilityLabel={frameAccessibilityLabel}
          contentFit="contain"
          kind={frameKind}
          style={mediaFrameStyle}
          uri={frameUri}
        >
          {isVideo && isInlineVideoActive && mediaUri ? (
            <ReelVideo
              contentFit="contain"
              key={`inline-video-${clientMessageId}-${mediaStage}`}
              muted={false}
              nativeControls={false}
              resetOnPause
              shouldPlay
              style={{ height: mediaHeight, position: 'absolute', width: mediaWidth }}
              uri={mediaUri}
              {...(posterUri ? { posterUri } : {})}
            />
          ) : null}
          {isVideo && canPlayInline ? (
            <TouchableOpacity
              accessibilityLabel={isInlineVideoActive ? 'Pause video' : 'Play video inline'}
              accessibilityRole="button"
              activeOpacity={0.9}
              {...(delayLongPress ? { delayLongPress } : {})}
              {...(onLongPress ? { onLongPress: handleMediaLongPress } : {})}
              onPress={handleInlinePlayPress}
              onPressIn={handleMediaPressIn}
              style={{
                alignItems: 'center',
                backgroundColor: 'rgba(12,12,13,0.58)',
                borderColor: 'rgba(255,255,255,0.16)',
                borderRadius: 28,
                borderWidth: 1,
                height: 56,
                justifyContent: 'center',
                left: mediaWidth / 2 - 28,
                position: 'absolute',
                top: mediaHeight / 2 - 28,
                width: 56,
              }}
            >
              <MaterialIcons
                color="#FFFFFF"
                name={isInlineVideoActive ? 'pause' : 'play-arrow'}
                size={28}
              />
            </TouchableOpacity>
          ) : null}
          {isVideo ? durationBadge : null}
          {statusOverlay}
        </ChatMediaFrame>
      </Pressable>
    </Animated.View>
  )
}
