import * as VideoThumbnails from 'expo-video-thumbnails'
import { useCallback } from 'react'
import { Alert, useWindowDimensions } from 'react-native'

import {
  calculateChatMediaDisplaySize,
  getMediaPlaceholderLabel,
  resolveAllowedChatMediaType,
} from '../lib/chatMedia'
import { createClientMessageId } from '../lib/clientMessageId'
import { useAuthStore } from '../stores/authStore'
import { useChatMediaUploadStore } from '../stores/chatMediaUploadStore'
import { useChatStore } from '../stores/chatStore'

import type { ChatMediaUploadJob } from '../stores/chatMediaUploadStore'
import type { Message } from '../types/conversation.types'
import type { ImagePickerAsset } from 'expo-image-picker'

const getReplyPreview = ({
  currentUserId,
  replyToMessage,
}: {
  currentUserId: string
  replyToMessage?: Message | null
}) => {
  if (!replyToMessage?.id) {
    return undefined
  }

  return {
    senderName:
      replyToMessage.senderId === currentUserId
        ? 'You'
        : (replyToMessage.sender?.email?.split('@')[0] ?? 'User'),
    content: replyToMessage.content ?? '',
    type: (replyToMessage.type === 'voice' ? 'text' : replyToMessage.type) as
      | 'text'
      | 'image'
      | 'video'
      | 'file'
      | 'call',
  }
}

const buildOptimisticMessage = ({
  clientMessageId,
  conversationId,
  currentUser,
  type,
  content,
  fileUri,
  fileType,
  width,
  height,
  durationMs,
  displayWidth,
  displayHeight,
  replyToId,
  replyPreview,
}: {
  clientMessageId: string
  conversationId: string
  currentUser: NonNullable<ReturnType<typeof useAuthStore.getState>['user']>
  type: 'image' | 'video'
  content: string
  fileUri: string
  fileType: string
  width?: number
  height?: number
  durationMs?: number
  displayWidth: number
  displayHeight: number
  replyToId?: string
  replyPreview?: Message['replyPreview']
}): Message => {
  const now = new Date().toISOString()

  return {
    id: clientMessageId,
    clientMessageId,
    conversationId,
    senderId: currentUser.id,
    sender: currentUser,
    content,
    media: {
      localFileUri: fileUri,
      displayWidth,
      displayHeight,
      mimeType: fileType,
      uploadStage: 'queued',
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(durationMs ? { durationMs } : {}),
    },
    type,
    status: 'SENT',
    createdAt: now,
    updatedAt: now,
    ...(replyToId ? { replyToId } : {}),
    ...(replyPreview ? { replyPreview } : {}),
  }
}

export function useChatMediaUploads(conversationId: string) {
  const { user } = useAuthStore()
  const replyToMessage = useChatStore((state) => state.replyToMessage)
  const setReplyToMessage = useChatStore((state) => state.setReplyToMessage)
  const addOptimisticMessages = useChatStore((state) => state.addOptimisticMessages)
  const updateOptimisticMessage = useChatStore((state) => state.updateOptimisticMessage)
  const { width: screenWidth } = useWindowDimensions()

  const enqueueMediaAssets = useCallback(
    async (assets: ImagePickerAsset[]) => {
      if (!user?.id || assets.length === 0) {
        return
      }

      const maxBubbleWidth = Math.max(196, Math.min(Math.floor(screenWidth * 0.62), 260))
      const nextOptimisticMessages: Message[] = []
      const nextJobs: ChatMediaUploadJob[] = []
      const nextVideoPosterTasks: Promise<void>[] = []
      const replyPreview = getReplyPreview({
        currentUserId: user.id,
        replyToMessage,
      })
      const replyToId = replyToMessage?.id

      for (const asset of assets) {
        const kind = asset.type === 'video' ? 'video' : 'image'
        const fileType = resolveAllowedChatMediaType({
          mimeType: asset.mimeType ?? null,
          fileNameOrUri: asset.fileName ?? asset.uri,
          kind,
        })

        if (!fileType) {
          Alert.alert(
            'Unsupported media',
            kind === 'video'
              ? 'Video must be MP4, WebM, or MOV.'
              : 'Image must be JPEG, PNG, or WebP.',
          )
          continue
        }

        const clientMessageId = createClientMessageId()
        const displaySize = calculateChatMediaDisplaySize({
          maxWidth: maxBubbleWidth,
          ...(asset.width ? { width: asset.width } : {}),
          ...(asset.height ? { height: asset.height } : {}),
        })
        const content = getMediaPlaceholderLabel(kind)
        const assetWidth = asset.width && asset.width > 0 ? asset.width : null
        const assetHeight = asset.height && asset.height > 0 ? asset.height : null
        const assetDurationMs = asset.duration && asset.duration > 0 ? asset.duration : null

        const optimisticMessage = buildOptimisticMessage({
          clientMessageId,
          conversationId,
          currentUser: user,
          type: kind,
          content,
          fileUri: asset.uri,
          fileType,
          displayWidth: displaySize.displayWidth,
          displayHeight: displaySize.displayHeight,
          ...(assetWidth ? { width: assetWidth } : {}),
          ...(assetHeight ? { height: assetHeight } : {}),
          ...(assetDurationMs ? { durationMs: assetDurationMs } : {}),
          ...(replyToId ? { replyToId } : {}),
          ...(replyPreview ? { replyPreview } : {}),
        })

        nextOptimisticMessages.push(optimisticMessage)

        nextJobs.push({
          clientMessageId,
          conversationId,
          type: kind,
          content,
          fileUri: asset.uri,
          fileName: asset.fileName ?? `${kind}-${clientMessageId}`,
          fileType,
          displayWidth: displaySize.displayWidth,
          displayHeight: displaySize.displayHeight,
          ...(assetWidth ? { width: assetWidth } : {}),
          ...(assetHeight ? { height: assetHeight } : {}),
          ...(assetDurationMs ? { durationMs: assetDurationMs } : {}),
          ...(replyToId ? { replyToId } : {}),
          ...(replyPreview ? { replyPreview } : {}),
          uploadStage: 'queued',
          createdAt: optimisticMessage.createdAt,
          cleanupPending: false,
        })

        if (kind === 'video') {
          nextVideoPosterTasks.push(
            VideoThumbnails.getThumbnailAsync(asset.uri, {
              quality: 0.65,
              time: asset.duration ? Math.floor(asset.duration / 2) : 2000,
            })
              .then((thumbnail) => {
                useChatMediaUploadStore.getState().patchJob(clientMessageId, {
                  localPosterUri: thumbnail.uri,
                })
                updateOptimisticMessage(conversationId, clientMessageId, (message) => ({
                  ...message,
                  media: {
                    ...(message.media ?? {}),
                    localPosterUri: thumbnail.uri,
                  },
                }))
              })
              .catch(() => undefined),
          )
        }
      }

      if (nextJobs.length === 0) {
        return
      }

      addOptimisticMessages(conversationId, nextOptimisticMessages)
      useChatMediaUploadStore.getState().enqueueJobs(nextJobs)
      setReplyToMessage(null)

      if (nextVideoPosterTasks.length > 0) {
        void Promise.allSettled(nextVideoPosterTasks)
      }
    },
    [
      addOptimisticMessages,
      conversationId,
      replyToMessage,
      screenWidth,
      setReplyToMessage,
      updateOptimisticMessage,
      user,
    ],
  )

  return {
    enqueueMediaAssets,
  }
}
