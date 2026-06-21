import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { Alert, useWindowDimensions } from 'react-native'

import type { InfiniteData } from '@tanstack/react-query'

import { queryKeys } from '../constants/queryKeys'
import {
  calculateChatMediaDisplaySize,
  getChatMediaMaxWidth,
  getMediaPlaceholderLabel,
  getResolvedMediaPosterUri,
  getResolvedMediaUri,
  resolveAllowedChatMediaType,
} from '../lib/chatMedia'
import { upsertConversationSummaryInCache } from '../lib/chatMessageCache'
import { createClientMessageId } from '../lib/clientMessageId'
import { getReplyPreviewSenderName } from '../lib/replyPreview'
import { useAuthStore } from '../stores/authStore'
import { useChatMediaUploadStore } from '../stores/chatMediaUploadStore'
import { useChatStore } from '../stores/chatStore'

import type { ChatMediaUploadJob } from '../stores/chatMediaUploadStore'
import type { OptimisticSortAnchor } from '../stores/chatStore'
import type { Conversation, Message } from '../types/conversation.types'
import type { ImagePickerAsset } from 'expo-image-picker'

type EnqueuedMediaBatch = {
  batchId: string
  clientMessageIds: string[]
}

type EnqueueMediaAssetsOptions = {
  onWillCommitBatch?: (batch: EnqueuedMediaBatch) => void
}

const isPersistedServerMessageId = (messageId?: string | null): messageId is string => {
  return Boolean(messageId && !messageId.startsWith('temp-'))
}

const createMediaBatchId = () => `media-batch-${createClientMessageId()}`

const getMessageCreatedAtMs = (message?: Message | null) => {
  const createdAtMs = message?.createdAt ? Date.parse(message.createdAt) : NaN
  return Number.isFinite(createdAtMs) ? createdAtMs : 0
}

const compareMessagesNewestFirst = (left: Message, right: Message) => {
  const timestampDelta = getMessageCreatedAtMs(right) - getMessageCreatedAtMs(left)

  if (timestampDelta !== 0) {
    return timestampDelta
  }

  return (right.id || right._id || '').localeCompare(left.id || left._id || '')
}

const getLatestPersistedServerFrontier = ({
  conversation,
  conversationId,
  queryClient,
}: {
  conversation?: Conversation | null
  conversationId: string
  queryClient: ReturnType<typeof useQueryClient>
}) => {
  const cachedMessages = queryClient.getQueryData<InfiniteData<Message[]> | Message[] | undefined>(
    queryKeys.conversations.messages(conversationId),
  )
  const flattenedMessages = Array.isArray(cachedMessages)
    ? cachedMessages
    : (cachedMessages?.pages?.flat() ?? [])
  const latestPersistedMessage =
    [...flattenedMessages]
      .filter((message) => isPersistedServerMessageId(message.id))
      .sort(compareMessagesNewestFirst)[0] ?? null

  if (latestPersistedMessage?.id) {
    return {
      frontierCreatedAtMs: getMessageCreatedAtMs(latestPersistedMessage),
      frontierMessageId: latestPersistedMessage.id,
    }
  }

  const fallbackCreatedAtMs = Date.parse(
    conversation?.lastMessageAt ?? conversation?.updatedAt ?? conversation?.createdAt ?? '',
  )

  return {
    frontierCreatedAtMs: Number.isFinite(fallbackCreatedAtMs) ? fallbackCreatedAtMs : 0,
    frontierMessageId: null,
  }
}

const getNextOptimisticSequenceForFrontier = ({
  anchorsByMessageId,
  frontierCreatedAtMs,
  frontierMessageId,
}: {
  anchorsByMessageId: Record<string, OptimisticSortAnchor>
  frontierCreatedAtMs: number
  frontierMessageId: string | null
}) => {
  return Object.values(anchorsByMessageId).reduce((maxSequence, anchor) => {
    if (
      anchor.frontierCreatedAtMs !== frontierCreatedAtMs ||
      (anchor.frontierMessageId ?? null) !== frontierMessageId
    ) {
      return maxSequence
    }

    return Math.max(maxSequence, anchor.sequence)
  }, 0)
}

const getReplyPreview = ({
  conversation,
  currentUserId,
  replyToMessage,
}: {
  conversation?: Conversation | null
  currentUserId: string
  replyToMessage?: Message | null
}) => {
  if (!replyToMessage?.id) {
    return undefined
  }

  let thumbnailUri: string | undefined
  if (replyToMessage.type === 'video') {
    thumbnailUri = getResolvedMediaPosterUri(replyToMessage.media) ?? undefined
  } else if (replyToMessage.type === 'image') {
    thumbnailUri = getResolvedMediaUri(replyToMessage.media) ?? undefined
  }

  const mediaWidth = replyToMessage.media?.width ?? replyToMessage.media?.displayWidth ?? undefined
  const mediaHeight =
    replyToMessage.media?.height ?? replyToMessage.media?.displayHeight ?? undefined

  return {
    senderName: getReplyPreviewSenderName({
      conversation: conversation ?? null,
      currentUserId,
      senderEmail: replyToMessage.sender?.email ?? null,
      senderId: replyToMessage.senderId,
    }),
    senderId: replyToMessage.senderId,
    content: replyToMessage.content ?? '',
    ...(thumbnailUri ? { thumbnailUri } : {}),
    ...(mediaWidth ? { mediaWidth } : {}),
    ...(mediaHeight ? { mediaHeight } : {}),
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
  createdAt,
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
  createdAt: string
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
    createdAt,
    updatedAt: createdAt,
    ...(replyToId ? { replyToId } : {}),
    ...(replyPreview ? { replyPreview } : {}),
  }
}

export function useChatMediaUploads(conversationId: string) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const cachedConversationsData = queryClient.getQueryData<unknown>(queryKeys.conversations.all)
  const cachedConversations: Conversation[] = Array.isArray(cachedConversationsData)
    ? cachedConversationsData
    : (cachedConversationsData as { pages?: Conversation[][] })?.pages?.flat() || []
  const currentConversation =
    cachedConversations.find((conversation) => conversation.id === conversationId) ?? null
  const replyToMessage = useChatStore((state) => state.replyToMessage)
  const setReplyToMessage = useChatStore((state) => state.setReplyToMessage)
  const addOptimisticMessages = useChatStore((state) => state.addOptimisticMessages)
  const { width: screenWidth } = useWindowDimensions()

  const enqueueMediaAssets = useCallback(
    async (assets: ImagePickerAsset[], options?: EnqueueMediaAssetsOptions) => {
      if (!user?.id || assets.length === 0) {
        return null
      }

      const maxBubbleWidth = getChatMediaMaxWidth(screenWidth)
      const batchId = createMediaBatchId()
      const nextOptimisticMessages: Message[] = []
      const nextJobs: ChatMediaUploadJob[] = []
      const nextClientMessageIds: string[] = []
      const nextSortAnchorsByMessageId: Record<string, OptimisticSortAnchor> = {}
      const baseCreatedAtMs = Date.now()
      const replyPreview = getReplyPreview({
        conversation: currentConversation,
        currentUserId: user.id,
        replyToMessage,
      })
      const replyToId = replyToMessage?.id
      const existingSortAnchors =
        useChatStore.getState().optimisticSortAnchors[conversationId] ?? {}
      const frontier = getLatestPersistedServerFrontier({
        conversation: currentConversation,
        conversationId,
        queryClient,
      })
      const nextSequenceBase = getNextOptimisticSequenceForFrontier({
        anchorsByMessageId: existingSortAnchors,
        frontierCreatedAtMs: frontier.frontierCreatedAtMs,
        frontierMessageId: frontier.frontierMessageId,
      })

      for (const [assetIndex, asset] of assets.entries()) {
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
        nextClientMessageIds.push(clientMessageId)
        nextSortAnchorsByMessageId[clientMessageId] = {
          batchId,
          frontierCreatedAtMs: frontier.frontierCreatedAtMs,
          frontierMessageId: frontier.frontierMessageId,
          sequence: nextSequenceBase + assetIndex + 1,
        }
        const displaySize = calculateChatMediaDisplaySize({
          maxWidth: maxBubbleWidth,
          ...(asset.width ? { width: asset.width } : {}),
          ...(asset.height ? { height: asset.height } : {}),
        })
        const content = getMediaPlaceholderLabel(kind)
        const assetWidth = asset.width && asset.width > 0 ? asset.width : null
        const assetHeight = asset.height && asset.height > 0 ? asset.height : null
        const assetDurationMs = asset.duration && asset.duration > 0 ? asset.duration : null
        const createdAt = new Date(baseCreatedAtMs + assetIndex).toISOString()

        nextOptimisticMessages.push(
          buildOptimisticMessage({
            clientMessageId,
            content,
            conversationId,
            createdAt,
            currentUser: user,
            displayHeight: displaySize.displayHeight,
            displayWidth: displaySize.displayWidth,
            fileType,
            fileUri: asset.uri,
            type: kind,
            ...(assetWidth ? { width: assetWidth } : {}),
            ...(assetHeight ? { height: assetHeight } : {}),
            ...(assetDurationMs ? { durationMs: assetDurationMs } : {}),
            ...(replyToId ? { replyToId } : {}),
            ...(replyPreview ? { replyPreview } : {}),
          }),
        )

        nextJobs.push({
          batchId,
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
          createdAt,
          preparationStatus: 'preparing',
          cleanupPending: false,
        })
      }

      if (nextJobs.length === 0) {
        return null
      }

      const nextBatch = {
        batchId,
        clientMessageIds: nextClientMessageIds,
      } satisfies EnqueuedMediaBatch

      options?.onWillCommitBatch?.(nextBatch)
      addOptimisticMessages(conversationId, nextOptimisticMessages, nextSortAnchorsByMessageId)
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

      return nextBatch
    },
    [
      addOptimisticMessages,
      conversationId,
      currentConversation,
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
