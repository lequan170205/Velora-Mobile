import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import {
  calculateChatMediaDisplaySize,
  getMediaUploadStage,
  getResolvedMediaUri,
  isRemoteMediaUri,
} from '../../lib/chatMedia'
import { formatDurationLabel } from '../../lib/reels'
import { useChatMediaUploadStore } from '../../stores/chatMediaUploadStore'
import { useChatStore } from '../../stores/chatStore'
import { useChatVideoPlaybackStore } from '../../stores/chatVideoPlaybackStore'
import { ReelVideo } from '../reels/ReelVideo'

import type { ChatMediaViewerOpenPayload } from './ChatMediaViewer'
import type { Message } from '../../types/conversation.types'

interface ChatMediaBubbleProps {
  message: Message
  delayLongPress?: number
  onLongPress?: () => void
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
  onOpenMedia,
}: ChatMediaBubbleProps) {
  const { width: screenWidth } = useWindowDimensions()
  const mediaRef = useRef<View>(null)
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
    const rawWidth =
      message.media?.width ||
      message.media?.displayWidth ||
      uploadJob?.displayWidth ||
      memoWidth ||
      200
    const rawHeight =
      message.media?.height ||
      message.media?.displayHeight ||
      uploadJob?.displayHeight ||
      memoHeight ||
      200
    const maxWidth = Math.max(196, Math.min(Math.floor(screenWidth * 0.65), 260))

    return calculateChatMediaDisplaySize({ height: rawHeight, maxWidth, width: rawWidth })
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
  const cachePolicy = isRemoteMediaUri(posterUri ?? mediaUri) ? 'memory-disk' : 'memory'

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

    mediaRef.current?.measureInWindow((x, y, width, height) => {
      onOpenMedia({
        autoplayVideo,
        messageId: clientMessageId,
        sourceFrame: { height, width, x, y },
      })
    })
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

  const renderImage = () =>
    mediaUri ? (
      <Image
        accessibilityLabel="Photo attachment"
        cachePolicy={cachePolicy}
        contentFit="cover"
        recyclingKey={mediaUri}
        source={{ uri: mediaUri }}
        style={{ backgroundColor: '#EFEFEF', height: mediaHeight, width: mediaWidth }}
        transition={150}
      />
    ) : (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: '#EDEDED',
          height: mediaHeight,
          justifyContent: 'center',
          width: mediaWidth,
        }}
      >
        <MaterialIcons color="#A1A1AA" name="image" size={28} />
      </View>
    )

  const renderVideoPoster = () =>
    posterUri ? (
      <Image
        accessibilityLabel="Video attachment"
        cachePolicy={cachePolicy}
        contentFit="cover"
        recyclingKey={posterUri}
        source={{ uri: posterUri }}
        style={{ backgroundColor: '#0C0C0D', height: mediaHeight, width: mediaWidth }}
        transition={150}
      />
    ) : (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: '#101012',
          height: mediaHeight,
          justifyContent: 'center',
          width: mediaWidth,
        }}
      >
        <MaterialIcons color="#D4D4D8" name="videocam" size={30} />
      </View>
    )

  return (
    <View
      collapsable={false}
      ref={mediaRef}
      style={{
        backgroundColor: '#111111',
        borderRadius: 18,
        height: mediaHeight,
        overflow: 'hidden',
        width: mediaWidth,
      }}
    >
      {isVideo ? (
        <Pressable
          accessibilityLabel="Open video"
          accessibilityRole="button"
          {...(delayLongPress ? { delayLongPress } : {})}
          {...(onLongPress ? { onLongPress } : {})}
          onPress={() => openViewer(true)}
          style={{ height: mediaHeight, width: mediaWidth }}
        >
          {isInlineVideoActive && mediaUri ? (
            <ReelVideo
              contentFit="cover"
              key={`inline-video-${clientMessageId}-${mediaStage}`}
              muted={false}
              nativeControls={false}
              resetOnPause
              shouldPlay
              style={{ height: mediaHeight, width: mediaWidth }}
              uri={mediaUri}
              {...(posterUri ? { posterUri } : {})}
            />
          ) : (
            renderVideoPoster()
          )}
          {canPlayInline ? (
            <TouchableOpacity
              accessibilityLabel={isInlineVideoActive ? 'Pause video' : 'Play video inline'}
              accessibilityRole="button"
              activeOpacity={0.9}
              {...(delayLongPress ? { delayLongPress } : {})}
              {...(onLongPress ? { onLongPress } : {})}
              onPress={(event) => {
                event.stopPropagation()
                setActiveMessage(message.conversationId, isInlineVideoActive ? null : message.id)
              }}
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
        </Pressable>
      ) : (
        <Pressable
          accessibilityLabel="Open photo"
          accessibilityRole="button"
          {...(delayLongPress ? { delayLongPress } : {})}
          {...(onLongPress ? { onLongPress } : {})}
          onPress={() => openViewer(false)}
        >
          {renderImage()}
        </Pressable>
      )}

      {durationLabel ? (
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
      ) : null}

      {stageLabel || isFailed ? (
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
                  onPress={handleRetry}
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
                  onPress={() => requestCancel(clientMessageId)}
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
      ) : null}
    </View>
  )
}
