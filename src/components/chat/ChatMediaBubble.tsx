import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

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

import type { Message } from '../../types/conversation.types'

interface ChatMediaBubbleProps {
  message: Message
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

export function ChatMediaBubble({ message }: ChatMediaBubbleProps) {
  const insets = useSafeAreaInsets()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const [isViewerVisible, setIsViewerVisible] = useState(false)
  const [isViewerVideoPlaying, setIsViewerVideoPlaying] = useState(true)
  const clientMessageId = message.clientMessageId ?? message.id
  const uploadStage = useChatMediaUploadStore(
    (state) => state.jobsById[clientMessageId]?.uploadStage ?? null,
  )
  const uploadFailureReason = useChatMediaUploadStore(
    (state) => state.jobsById[clientMessageId]?.failureReason ?? null,
  )
  const uploadDisplayWidth = useChatMediaUploadStore(
    (state) => state.jobsById[clientMessageId]?.displayWidth,
  )
  const uploadDisplayHeight = useChatMediaUploadStore(
    (state) => state.jobsById[clientMessageId]?.displayHeight,
  )

  const [memoWidth, setMemoWidth] = useState(uploadDisplayWidth)
  const [memoHeight, setMemoHeight] = useState(uploadDisplayHeight)

  useEffect(() => {
    if (uploadDisplayWidth) setMemoWidth(uploadDisplayWidth)
    if (uploadDisplayHeight) setMemoHeight(uploadDisplayHeight)
  }, [uploadDisplayWidth, uploadDisplayHeight])

  const { displayWidth: mediaWidth, displayHeight: mediaHeight } = useMemo(() => {
    const rawWidth =
      message.media?.width || message.media?.displayWidth || uploadDisplayWidth || memoWidth || 200
    const rawHeight =
      message.media?.height ||
      message.media?.displayHeight ||
      uploadDisplayHeight ||
      memoHeight ||
      200
    const maxWidth = Math.max(196, Math.min(Math.floor(screenWidth * 0.65), 260))

    return calculateChatMediaDisplaySize({
      width: rawWidth,
      height: rawHeight,
      maxWidth,
    })
  }, [message.media, uploadDisplayWidth, uploadDisplayHeight, memoWidth, memoHeight, screenWidth])

  const uploadDurationMs = useChatMediaUploadStore(
    (state) => state.jobsById[clientMessageId]?.durationMs ?? null,
  )
  const uploadLocalPosterUri = useChatMediaUploadStore(
    (state) => state.jobsById[clientMessageId]?.localPosterUri ?? null,
  )
  const retryJob = useChatMediaUploadStore((state) => state.retryJob)
  const setActiveMessage = useChatVideoPlaybackStore((state) => state.setActiveMessage)
  const isInlineVideoActive = useChatVideoPlaybackStore(
    (state) => state.activeMessageIdByConversation[message.conversationId] === message.id,
  )
  const progressValue = useSharedValue(
    useChatMediaUploadStore.getState().progressById[clientMessageId]?.progress ?? 0,
  )

  const mediaStage = uploadStage ?? getMediaUploadStage(message.media)
  const mediaUri = getResolvedMediaUri(message.media)

  const currentLocalPoster = uploadLocalPosterUri ?? message.media?.localPosterUri ?? null

  const [memoizedPoster, setMemoizedPoster] = useState(currentLocalPoster)

  useEffect(() => {
    if (currentLocalPoster) {
      setMemoizedPoster(currentLocalPoster)
    }
  }, [currentLocalPoster])

  const isProcessing = mediaStage === 'processing'

  const posterUri = isProcessing
    ? (memoizedPoster ?? null)
    : (message.media?.thumbnailUrl ?? memoizedPoster ?? null)
  const isVideo = message.type === 'video'
  const isFailed = mediaStage === 'failed' || message.status === 'FAILED'
  const isUploading =
    mediaStage === 'queued' || mediaStage === 'uploading' || mediaStage === 'syncing'
  const durationLabel = formatDurationLabel(message.media?.durationMs ?? uploadDurationMs ?? null)
  const cachePolicy = isRemoteMediaUri(posterUri ?? mediaUri) ? 'memory-disk' : 'memory'
  const stageLabel = getStageLabel(mediaStage)
  const canPlayInline = isVideo && !isUploading && !isFailed && Boolean(mediaUri)

  useEffect(() => {
    const unsubscribe = useChatMediaUploadStore.subscribe(
      (state) => state.progressById[clientMessageId]?.progress ?? 0,
      (nextProgress) => {
        progressValue.value = withTiming(nextProgress, { duration: 140 })
      },
      { fireImmediately: true },
    )

    return unsubscribe
  }, [clientMessageId, progressValue])

  const progressStyle = useAnimatedStyle(() => ({
    width: mediaWidth * progressValue.value,
  }))

  const handleRetry = () => {
    retryJob(clientMessageId)
    useChatStore
      .getState()
      .updateOptimisticMessage(message.conversationId, clientMessageId, (current) => ({
        ...current,
        status: 'SENT',
        media: {
          ...(current.media ?? {}),
          uploadStage: 'queued',
        },
      }))
  }

  const openViewer = () => {
    if (isInlineVideoActive) {
      setActiveMessage(message.conversationId, null)
    }

    setIsViewerVideoPlaying(true)
    setIsViewerVisible(true)
  }

  const closeViewer = () => {
    setIsViewerVisible(false)
    setIsViewerVideoPlaying(false)
  }

  const renderImagePoster = () => {
    if (mediaUri) {
      return (
        <Image
          key={`img-${clientMessageId}-${mediaStage}-${mediaWidth}x${mediaHeight}`}
          recyclingKey={mediaUri}
          transition={150}
          source={{ uri: mediaUri }}
          cachePolicy={cachePolicy}
          contentFit="cover"
          style={{
            width: mediaWidth,
            height: mediaHeight,
            backgroundColor: '#EFEFEF',
          }}
        />
      )
    }

    return (
      <View
        style={{
          width: mediaWidth,
          height: mediaHeight,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#EDEDED',
        }}
      >
        <MaterialIcons name="image" size={28} color="#A1A1AA" />
      </View>
    )
  }

  const renderVideoIdle = () => {
    if (posterUri) {
      return (
        <Image
          key={`video-poster-${clientMessageId}-${mediaStage}-${mediaWidth}x${mediaHeight}`}
          recyclingKey={posterUri}
          transition={150}
          source={{ uri: posterUri }}
          cachePolicy={cachePolicy}
          contentFit="cover"
          style={{
            width: mediaWidth,
            height: mediaHeight,
            backgroundColor: '#0C0C0D',
          }}
        />
      )
    }

    return (
      <View
        style={{
          width: mediaWidth,
          height: mediaHeight,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#101012',
        }}
      >
        <MaterialIcons name="videocam" size={30} color="#D4D4D8" />
      </View>
    )
  }

  return (
    <>
      <View
        style={{
          width: mediaWidth,
          height: mediaHeight,
          overflow: 'hidden',
          borderRadius: 18,
          backgroundColor: '#111111',
        }}
      >
        {isVideo ? (
          isInlineVideoActive && mediaUri ? (
            <Pressable onPress={openViewer} style={{ width: mediaWidth, height: mediaHeight }}>
              <ReelVideo
                key={`inline-video-${clientMessageId}-${mediaStage}-${mediaWidth}x${mediaHeight}`}
                uri={mediaUri}
                shouldPlay
                muted={false}
                nativeControls={false}
                contentFit="cover"
                resetOnPause
                style={{ width: mediaWidth, height: mediaHeight }}
                {...(posterUri ? { posterUri } : {})}
              />
            </Pressable>
          ) : (
            <Pressable onPress={openViewer} style={{ width: mediaWidth, height: mediaHeight }}>
              {renderVideoIdle()}
              {canPlayInline ? (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    setActiveMessage(message.conversationId, message.id)
                  }}
                  style={{
                    position: 'absolute',
                    left: mediaWidth / 2 - 28,
                    top: mediaHeight / 2 - 28,
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(12,12,13,0.58)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.16)',
                  }}
                >
                  <MaterialIcons name="play-arrow" size={28} color="#FFFFFF" />
                </TouchableOpacity>
              ) : null}
            </Pressable>
          )
        ) : (
          <Pressable onPress={openViewer}>{renderImagePoster()}</Pressable>
        )}

        {durationLabel ? (
          <View
            style={{
              position: 'absolute',
              right: 10,
              bottom: 10,
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: 'rgba(12,12,13,0.68)',
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#FFFFFF' }}>
              {durationLabel}
            </Text>
          </View>
        ) : null}

        {stageLabel || isFailed ? (
          <View
            pointerEvents={isFailed ? 'auto' : 'none'}
            style={{
              position: 'absolute',
              inset: 0,
              justifyContent: 'flex-end',
              backgroundColor: isFailed ? 'rgba(15, 15, 16, 0.58)' : 'rgba(15, 15, 16, 0.24)',
            }}
          >
            <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
              {isUploading ? (
                <View
                  style={{
                    height: 4,
                    borderRadius: 999,
                    overflow: 'hidden',
                    backgroundColor: 'rgba(255,255,255,0.16)',
                    marginBottom: 10,
                  }}
                >
                  <Animated.View
                    style={[
                      progressStyle,
                      {
                        height: 4,
                        borderRadius: 999,
                        backgroundColor: '#FF6B2C',
                      },
                    ]}
                  />
                </View>
              ) : null}

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={{ flex: 1, fontSize: 12, fontWeight: '600', color: '#FFFFFF' }}>
                  {isFailed
                    ? message.media?.failureReason || uploadFailureReason || 'Upload failed'
                    : stageLabel}
                </Text>

                {isFailed ? (
                  <TouchableOpacity
                    activeOpacity={0.86}
                    onPress={handleRetry}
                    style={{
                      marginLeft: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 999,
                      backgroundColor: 'rgba(255,255,255,0.14)',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>Retry</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <Modal
        visible={isViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={closeViewer}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.96)',
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 18,
              paddingTop: 10,
              paddingBottom: 12,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF' }}>
              {isVideo ? 'Video' : 'Photo'}
            </Text>
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={closeViewer}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.12)',
              }}
            >
              <MaterialIcons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 12,
            }}
          >
            {isVideo && mediaUri ? (
              <View
                style={{
                  width: screenWidth - 24,
                  height: Math.min(screenHeight * 0.72, screenWidth * 1.3),
                  borderRadius: 24,
                  overflow: 'hidden',
                  backgroundColor: '#000000',
                }}
              >
                <ReelVideo
                  uri={mediaUri}
                  shouldPlay={isViewerVideoPlaying}
                  nativeControls
                  contentFit="contain"
                  style={{ width: '100%', height: '100%' }}
                  {...(posterUri ? { posterUri } : {})}
                />
              </View>
            ) : mediaUri ? (
              <Image
                key={`viewer-img-${clientMessageId}`}
                recyclingKey={mediaUri}
                transition={150}
                source={{ uri: mediaUri }}
                cachePolicy={cachePolicy}
                contentFit="contain"
                style={{
                  width: screenWidth - 24,
                  height: screenHeight * 0.78,
                }}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  )
}
