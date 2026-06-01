import { useQueryClient } from '@tanstack/react-query'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { useCallback } from 'react'
import { Alert, useWindowDimensions } from 'react-native'

import { createPendingMediaMessage } from '../database/messageSync'
import {
  calculateChatMediaDisplaySize,
  getMediaPlaceholderLabel,
  resolveAllowedChatMediaType,
} from '../lib/chatMedia'
import { upsertConversationSummaryInCache } from '../lib/chatMessageCache'
import { createClientMessageId } from '../lib/clientMessageId'
import { useAuthStore } from '../stores/authStore'
import { useChatMediaUploadStore } from '../stores/chatMediaUploadStore'
import { useChatStore } from '../stores/chatStore'

import type { ChatMediaUploadJob } from '../stores/chatMediaUploadStore'
import type { Message } from '../types/conversation.types'
import type { ImagePickerAsset } from 'expo-image-picker'

interface FileSystemCleanupModule {
  deleteAsync: (fileUri: string, options?: { idempotent?: boolean }) => Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const LegacyFileSystemCleanup = require('expo-file-system/legacy') as FileSystemCleanupModule

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
  content,
  conversationId,
  currentUser,
  displayHeight,
  displayWidth,
  durationMs,
  fileType,
  fileUri,
  height,
  localPosterUri,
  replyPreview,
  replyToId,
  type,
  width,
}: {
  clientMessageId: string
  content: string
  conversationId: string
  currentUser: NonNullable<ReturnType<typeof useAuthStore.getState>['user']>
  displayHeight: number
  displayWidth: number
  durationMs?: number
  fileType: string
  fileUri: string
  height?: number
  localPosterUri?: string
  replyPreview?: Message['replyPreview']
  replyToId?: string
  type: 'image' | 'video'
  width?: number
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
      ...(localPosterUri ? { localPosterUri } : {}),
    },
    type,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
    ...(replyToId ? { replyToId } : {}),
    ...(replyPreview ? { replyPreview } : {}),
  }
}

export function useChatMediaUploads(conversationId: string) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const replyToMessage = useChatStore((state) => state.replyToMessage)
  const setReplyToMessage = useChatStore((state) => state.setReplyToMessage)
  const addOptimisticMessages = useChatStore((state) => state.addOptimisticMessages)
  const { width: screenWidth } = useWindowDimensions()

  const enqueueMediaAssets = useCallback(
    async (assets: ImagePickerAsset[]) => {
      if (!user?.id || assets.length === 0) {
        return
      }

      const maxBubbleWidth = Math.max(196, Math.min(Math.floor(screenWidth * 0.62), 260))
      const nextOptimisticMessages: Message[] = []
      const nextJobs: ChatMediaUploadJob[] = []
      let failedPreparationCount = 0
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
        const createdAt = new Date().toISOString()
        const localPosterUri =
          kind === 'video'
            ? await VideoThumbnails.getThumbnailAsync(asset.uri, {
                quality: 0.65,
                time: asset.duration ? Math.floor(asset.duration / 2) : 2000,
              })
                .then((thumbnail) => thumbnail.uri)
                .catch(() => null)
            : null
        const pendingMedia: NonNullable<Message['media']> = {
          localFileUri: asset.uri,
          displayWidth: displaySize.displayWidth,
          displayHeight: displaySize.displayHeight,
          mimeType: fileType,
          uploadStage: 'queued',
          ...(assetWidth ? { width: assetWidth } : {}),
          ...(assetHeight ? { height: assetHeight } : {}),
          ...(assetDurationMs ? { durationMs: assetDurationMs } : {}),
          ...(localPosterUri ? { localPosterUri } : {}),
        }

        try {
          await createPendingMediaMessage({
            clientMessageId,
            content,
            conversationId,
            currentUser: user,
            media: pendingMedia,
            type: kind,
            ...(replyToId ? { replyToId } : {}),
            ...(replyPreview ? { replyPreview } : {}),
          })
        } catch (error) {
          failedPreparationCount += 1
          if (localPosterUri) {
            void LegacyFileSystemCleanup.deleteAsync(localPosterUri, { idempotent: true }).catch(
              () => undefined,
            )
          }
          console.error('[ChatMediaUploads] Failed to create pending media message', error)
          continue
        }

        nextOptimisticMessages.push(
          buildOptimisticMessage({
            clientMessageId,
            content,
            conversationId,
            currentUser: user,
            displayHeight: displaySize.displayHeight,
            displayWidth: displaySize.displayWidth,
            fileType,
            fileUri: asset.uri,
            type: kind,
            ...(assetWidth ? { width: assetWidth } : {}),
            ...(assetHeight ? { height: assetHeight } : {}),
            ...(assetDurationMs ? { durationMs: assetDurationMs } : {}),
            ...(localPosterUri ? { localPosterUri } : {}),
            ...(replyToId ? { replyToId } : {}),
            ...(replyPreview ? { replyPreview } : {}),
          }),
        )

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
          ...(localPosterUri ? { localPosterUri } : {}),
          ...(replyToId ? { replyToId } : {}),
          ...(replyPreview ? { replyPreview } : {}),
          uploadStage: 'queued',
          createdAt,
          cleanupPending: false,
        })
      }

      if (nextJobs.length === 0) {
        if (failedPreparationCount > 0) {
          Alert.alert('Could not attach media', 'Please try selecting the media again.')
        }
        return
      }

      addOptimisticMessages(conversationId, nextOptimisticMessages)
      useChatMediaUploadStore.getState().enqueueJobs(nextJobs)
      const lastQueuedJob = nextJobs[nextJobs.length - 1]
      if (lastQueuedJob) {
        upsertConversationSummaryInCache(queryClient, {
          id: conversationId,
          lastMessage: lastQueuedJob.content,
          lastMessageAt: lastQueuedJob.createdAt,
          updatedAt: lastQueuedJob.createdAt,
        })
      }
      setReplyToMessage(null)
      if (failedPreparationCount > 0) {
        Alert.alert('Some media were not attached', 'Please try selecting those items again.')
      }
    },
    [
      addOptimisticMessages,
      conversationId,
      queryClient,
      replyToMessage,
      screenWidth,
      setReplyToMessage,
      user,
    ],
  )

  return {
    enqueueMediaAssets,
  }
}
