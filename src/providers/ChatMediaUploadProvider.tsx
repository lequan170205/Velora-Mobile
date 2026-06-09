import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useEffect, useRef } from 'react'
import { AppState, Platform, unstable_batchedUpdates } from 'react-native'

import { conversationApi } from '../api/conversation.api'
import { mediaApi } from '../api/media.api'
import { queryKeys } from '../constants/queryKeys'
import {
  deletePendingMediaMessage,
  markMediaMessageFailed,
  patchLocalMediaMessage,
  upsertRemoteMessage,
} from '../database/messageSync'
import { getMediaPlaceholderLabel } from '../lib/chatMedia'
import {
  patchConversationMessagesInCache,
  patchExistingMessageAcrossConversationCaches,
  upsertConversationSummaryInCache,
  upsertMessageIntoConversationCache,
} from '../lib/chatMessageCache'
import { useAuthStore } from '../stores/authStore'
import { useChatMediaUploadStore } from '../stores/chatMediaUploadStore'
import { useChatStore } from '../stores/chatStore'

import type { ChatMediaUploadJob } from '../stores/chatMediaUploadStore'
import type { Message, MessageMedia } from '../types/conversation.types'

interface UploadProgressData {
  totalBytesSent: number
  totalBytesExpectedToSend: number
}

interface UploadResult {
  status?: number
}

interface UploadTask {
  uploadAsync: () => Promise<UploadResult | null>
  cancelAsync: () => Promise<void>
}

interface LegacyFileSystemModule {
  documentDirectory: string | null
  copyAsync: (options: { from: string; to: string }) => Promise<void>

  createUploadTask: (
    url: string,
    fileUri: string,
    options: {
      headers: Record<string, string>
      httpMethod: 'PUT'
      uploadType: string
      sessionType?: string
    },
    callback?: (progress: UploadProgressData) => void,
  ) => UploadTask
  deleteAsync: (fileUri: string, options?: { idempotent?: boolean }) => Promise<void>
  FileSystemUploadType: {
    BINARY_CONTENT: string
  }
  FileSystemSessionType: {
    BACKGROUND: string
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const LegacyFileSystem = require('expo-file-system/legacy') as LegacyFileSystemModule

const FOREGROUND_RECONCILE_GRACE_MS = 2_000
const JOB_STALE_TIMEOUT_MS = 45_000

const isSuccessfulUpload = (status?: number) => Boolean(status && status >= 200 && status < 300)

const getUploadFailureReason = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  return 'Upload failed unexpectedly'
}

const mergePreparedMediaWithJob = (job: ChatMediaUploadJob, media: MessageMedia): MessageMedia => {
  return {
    ...media,
    displayWidth: media.displayWidth ?? job.displayWidth,
    displayHeight: media.displayHeight ?? job.displayHeight,
    mimeType: media.mimeType ?? job.fileType,
    ...((media.width ?? job.width) ? { width: media.width ?? job.width } : {}),
    ...((media.height ?? job.height) ? { height: media.height ?? job.height } : {}),
    ...((media.durationMs ?? job.durationMs)
      ? { durationMs: media.durationMs ?? job.durationMs }
      : {}),
  }
}

const sanitizeConfirmedMedia = (media?: MessageMedia | null): MessageMedia | undefined => {
  if (!media) return undefined

  const isProcessing = media.status === 'processing' || media.uploadStage === 'processing'

  const {
    uploadStage: _uploadStage,
    uploadStartedAt: _uploadStartedAt,
    lastProgressAt: _lastProgressAt,
    failureReason,
    localFileUri,
    localPosterUri,
    ...restMedia
  } = media

  return {
    ...restMedia,
    ...(failureReason && media.status === 'failed' ? { failureReason } : {}),
    ...(localFileUri && (!media.fileUrl || isProcessing) ? { localFileUri } : {}),
    ...(localPosterUri && (!media.thumbnailUrl || isProcessing) ? { localPosterUri } : {}),
  }
}

const mergeReplyPreview = (
  remoteReplyPreview?: Message['replyPreview'],
  localReplyPreview?: Message['replyPreview'],
): Message['replyPreview'] | undefined => {
  if (!remoteReplyPreview) {
    return localReplyPreview
  }

  if (!localReplyPreview) {
    return remoteReplyPreview
  }

  if (typeof remoteReplyPreview === 'string' || typeof localReplyPreview === 'string') {
    return remoteReplyPreview
  }

  if (remoteReplyPreview.thumbnailUri || !localReplyPreview.thumbnailUri) {
    return {
      ...remoteReplyPreview,
      ...(remoteReplyPreview.senderId ? {} : { senderId: localReplyPreview.senderId }),
      ...(remoteReplyPreview.mediaWidth ? {} : { mediaWidth: localReplyPreview.mediaWidth }),
      ...(remoteReplyPreview.mediaHeight ? {} : { mediaHeight: localReplyPreview.mediaHeight }),
    }
  }

  return {
    ...remoteReplyPreview,
    thumbnailUri: localReplyPreview.thumbnailUri,
    ...(remoteReplyPreview.senderId ? {} : { senderId: localReplyPreview.senderId }),
    ...(remoteReplyPreview.mediaWidth ? {} : { mediaWidth: localReplyPreview.mediaWidth }),
    ...(remoteReplyPreview.mediaHeight ? {} : { mediaHeight: localReplyPreview.mediaHeight }),
  }
}

export function ChatMediaUploadProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const uploadTaskRef = useRef<UploadTask | null>(null)
  const thumbnailTaskRef = useRef<UploadTask | null>(null)
  const processingJobIdRef = useRef<string | null>(null)
  const reconcileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localMediaMutationQueueRef = useRef<Map<string, Promise<void>>>(new Map())

  const activeJobId = useChatMediaUploadStore((state) => state.activeJobId)
  const queuedJobId = useChatMediaUploadStore((state) =>
    state.activeJobId ? null : (state.queue[0] ?? null),
  )
  const appState = useChatMediaUploadStore((state) => state.appState)
  const reconcileVersion = useChatMediaUploadStore((state) => state.reconcileVersion)
  const cancelRequestById = useChatMediaUploadStore((state) => state.cancelRequestById)

  const syncOptimisticMessageFromJob = useCallback((clientMessageId: string) => {
    const job = useChatMediaUploadStore.getState().jobsById[clientMessageId]
    if (!job) {
      return
    }

    useChatStore
      .getState()
      .updateOptimisticMessage(job.conversationId, clientMessageId, (message) => {
        const {
          failureReason: _previousFailureReason,
          lastProgressAt: _previousLastProgressAt,
          uploadStage: _previousUploadStage,
          uploadStartedAt: _previousUploadStartedAt,
          ...restMedia
        } = message.media ?? {}
        const resolvedDurationMs = job.durationMs ?? restMedia.durationMs
        const resolvedHeight = job.height ?? restMedia.height
        const resolvedWidth = job.width ?? restMedia.width
        const nextMedia: MessageMedia = {
          ...restMedia,
          ...(job.preparedMedia ?? {}),
          ...(job.fileKey ? { fileKey: job.fileKey } : {}),
          ...(job.thumbnailKey ? { thumbnailKey: job.thumbnailKey } : {}),
          ...(job.localPosterUri ? { localPosterUri: job.localPosterUri } : {}),
          localFileUri: job.fileUri,
          displayHeight: job.displayHeight,
          displayWidth: job.displayWidth,
          mimeType: job.fileType,
          uploadStage: job.uploadStage,
          ...(resolvedDurationMs ? { durationMs: resolvedDurationMs } : {}),
          ...(resolvedHeight ? { height: resolvedHeight } : {}),
          ...(resolvedWidth ? { width: resolvedWidth } : {}),
          ...(job.failureReason ? { failureReason: job.failureReason } : {}),
          ...(job.lastProgressAt ? { lastProgressAt: job.lastProgressAt } : {}),
          ...(job.uploadStartedAt ? { uploadStartedAt: job.uploadStartedAt } : {}),
        }

        return {
          ...message,
          content: job.content,
          media: nextMedia,
          status: job.uploadStage === 'failed' ? 'FAILED' : 'PENDING',
          type: job.type,
        }
      })
  }, [])

  const patchJob = useCallback(
    (
      clientMessageId: string,
      patch: Partial<ChatMediaUploadJob>,
      options?: { syncOptimistic?: boolean },
    ) => {
      useChatMediaUploadStore.getState().patchJob(clientMessageId, patch)
      if (options?.syncOptimistic !== false) {
        syncOptimisticMessageFromJob(clientMessageId)
      }
    },
    [syncOptimisticMessageFromJob],
  )

  const enqueueLocalMediaMutation = useCallback(
    (clientMessageId: string, operation: () => Promise<void>) => {
      const queue = localMediaMutationQueueRef.current
      const previousMutation = queue.get(clientMessageId) ?? Promise.resolve()
      const nextMutation = previousMutation.catch(() => undefined).then(operation)

      queue.set(clientMessageId, nextMutation)
      void nextMutation
        .catch(() => undefined)
        .then(() => {
          if (queue.get(clientMessageId) === nextMutation) {
            queue.delete(clientMessageId)
          }
        })

      return nextMutation
    },
    [],
  )

  const setJobStage = useCallback(
    (
      clientMessageId: string,
      uploadStage: ChatMediaUploadJob['uploadStage'],
      options?: { failureReason?: string },
    ) => {
      const store = useChatMediaUploadStore.getState()
      store.setJobStage(
        clientMessageId,
        uploadStage,
        options?.failureReason ? { failureReason: options.failureReason } : undefined,
      )
      syncOptimisticMessageFromJob(clientMessageId)

      const job = store.jobsById[clientMessageId]
      if (job) {
        void enqueueLocalMediaMutation(clientMessageId, () =>
          patchLocalMediaMessage({
            clientMessageId,
            conversationId: job.conversationId,
            mediaPatch: {
              uploadStage,
              ...(options?.failureReason ? { failureReason: options.failureReason } : {}),
            },
            ...(uploadStage !== 'failed' ? { clearFailureReason: true } : {}),
          }),
        ).catch((error) => {
          console.error('[ChatMediaUpload] Failed to persist media upload stage', error)
        })
      }
    },
    [enqueueLocalMediaMutation, syncOptimisticMessageFromJob],
  )

  const clearJobProgress = useCallback((clientMessageId: string) => {
    useChatMediaUploadStore.getState().clearJobProgress(clientMessageId)
  }, [])

  const cleanupLocalPoster = useCallback(async (job: ChatMediaUploadJob) => {
    if (!job.localPosterUri) {
      return
    }

    try {
      await LegacyFileSystem.deleteAsync(job.localPosterUri, { idempotent: true })
    } catch {
      // Ignore cleanup failures for temp poster files.
    }
  }, [])

  const requireRunnableJob = useCallback((clientMessageId: string) => {
    const state = useChatMediaUploadStore.getState()
    const job = state.jobsById[clientMessageId]

    if (!job || state.activeJobId !== clientMessageId || state.cancelRequestById[clientMessageId]) {
      throw new Error('Upload aborted')
    }

    return job
  }, [])

  const runUploadTask = useCallback(
    async ({
      clientMessageId,
      fileUri,
      fileType,
      uploadUrl,
      kind,
      trackProgress,
    }: {
      clientMessageId: string
      fileUri: string
      fileType: string
      uploadUrl: string
      kind: 'file' | 'thumbnail'
      trackProgress: boolean
    }) => {
      let finalUri = fileUri
      let temporaryUploadUri: string | null = null

      if (finalUri.startsWith('ph://') || finalUri.startsWith('assets-library://')) {
        const fileExt = fileType.split('/')[1] || 'mp4'
        const docDir = LegacyFileSystem.documentDirectory
        if (!docDir) {
          throw new Error('No local storage is available to prepare upload.')
        }
        const baseDir = docDir.endsWith('/') ? docDir : `${docDir}/`

        const tempPath = `${baseDir}temp_upload_${clientMessageId}.${fileExt}`

        await LegacyFileSystem.copyAsync({
          from: finalUri,
          to: tempPath,
        })

        finalUri = tempPath
        temporaryUploadUri = tempPath
      }

      try {
        const uploadTask = LegacyFileSystem.createUploadTask(
          uploadUrl,
          finalUri,
          {
            headers: { 'Content-Type': fileType },
            httpMethod: 'PUT',
            uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
            ...(Platform.OS === 'ios'
              ? { sessionType: LegacyFileSystem.FileSystemSessionType.BACKGROUND }
              : {}),
          },
          trackProgress
            ? (progress) => {
                useChatMediaUploadStore.getState().setJobProgress(clientMessageId, progress)
                useChatMediaUploadStore.getState().patchJob(clientMessageId, {
                  lastProgressAt: Date.now(),
                })
              }
            : undefined,
        )

        if (kind === 'thumbnail') {
          thumbnailTaskRef.current = uploadTask
        } else {
          uploadTaskRef.current = uploadTask
        }

        const result = await uploadTask.uploadAsync()
        if (!result || !isSuccessfulUpload(result.status)) {
          throw new Error(`Upload failed with status ${result?.status ?? 'unknown'}`)
        }

        return result
      } finally {
        if (temporaryUploadUri) {
          await LegacyFileSystem.deleteAsync(temporaryUploadUri, { idempotent: true }).catch(
            () => undefined,
          )
        }
      }
    },
    [],
  )

  const finalizeAndSendJob = useCallback(
    async (clientMessageId: string) => {
      let job = requireRunnableJob(clientMessageId)
      let preparedMedia = job.preparedMedia

      if (!preparedMedia) {
        patchJob(clientMessageId, {
          uploadStartedAt: Date.now(),
          lastProgressAt: Date.now(),
        })
        setJobStage(clientMessageId, 'uploading')
        job = requireRunnableJob(clientMessageId)

        const upload = await mediaApi.getChatUploadUrl({
          fileType: job.fileType,
          purpose: 'chat',
        })
        patchJob(clientMessageId, { fileKey: upload.key }, { syncOptimistic: false })

        await runUploadTask({
          clientMessageId,
          fileUri: job.fileUri,
          fileType: job.fileType,
          uploadUrl: upload.uploadUrl,
          kind: 'file',
          trackProgress: true,
        })

        let thumbnailKey: string | undefined
        if (job.type === 'video' && job.localPosterUri) {
          const thumbnailUpload = await mediaApi.getChatUploadUrl({
            fileType: 'image/jpeg',
            purpose: 'chat_thumbnail',
          })
          thumbnailKey = thumbnailUpload.key
          patchJob(clientMessageId, thumbnailKey ? { thumbnailKey } : {}, {
            syncOptimistic: false,
          })

          await runUploadTask({
            clientMessageId,
            fileUri: job.localPosterUri,
            fileType: 'image/jpeg',
            uploadUrl: thumbnailUpload.uploadUrl,
            kind: 'thumbnail',
            trackProgress: false,
          })
        }

        requireRunnableJob(clientMessageId)
        setJobStage(clientMessageId, 'syncing')

        preparedMedia = mergePreparedMediaWithJob(
          requireRunnableJob(clientMessageId),
          await mediaApi.finalizeChatUpload({
            key: upload.key,
            fileType: job.fileType,
            ...(thumbnailKey ? { thumbnailKey } : {}),
          }),
        )

        const nextJobPatch: Partial<ChatMediaUploadJob> = {
          preparedMedia,
          fileKey: preparedMedia.fileKey ?? upload.key,
        }
        const resolvedThumbnailKey = preparedMedia.thumbnailKey ?? thumbnailKey
        if (resolvedThumbnailKey) {
          nextJobPatch.thumbnailKey = resolvedThumbnailKey
        }

        patchJob(clientMessageId, nextJobPatch)
      }

      job = requireRunnableJob(clientMessageId)
      const localReadyMedia: MessageMedia = {
        ...preparedMedia,
        ...(job.fileUri ? { localFileUri: job.fileUri } : {}),
        ...(job.localPosterUri ? { localPosterUri: job.localPosterUri } : {}),
        uploadStage: preparedMedia?.status === 'processing' ? 'processing' : 'ready',
      }

      patchJob(clientMessageId, { deliveryStartedAt: Date.now() }, { syncOptimistic: false })
      await enqueueLocalMediaMutation(clientMessageId, () =>
        patchLocalMediaMessage({
          clientMessageId,
          conversationId: job.conversationId,
          clearFailureReason: true,
          mediaPatch: localReadyMedia,
        }),
      )

      const savedMessage = await conversationApi.sendMessage(job.conversationId, {
        clientMessageId,
        content: job.content,
        media: preparedMedia,
        type: job.type,
        signalType: 0,
        ...(job.replyToId ? { replyToId: job.replyToId } : {}),
      })
      const mergedReplyPreview = mergeReplyPreview(savedMessage.replyPreview, job.replyPreview)

      const confirmedMessage: Message = {
        ...savedMessage,
        clientMessageId,
        content: savedMessage.content ?? job.content,
        media: savedMessage.media ?? preparedMedia,
        status: savedMessage.status ?? 'SENT',
        type: savedMessage.type ?? job.type,
        ...(job.replyToId && !savedMessage.replyToId && !savedMessage.reply_to_id
          ? {
              replyToId: job.replyToId,
              reply_to_id: job.replyToId,
            }
          : {}),
        ...(mergedReplyPreview ? { replyPreview: mergedReplyPreview } : {}),
      }
      const sanitizedConfirmedMedia = sanitizeConfirmedMedia(confirmedMessage.media)

      const sanitizedConfirmedMessage: Message = {
        ...confirmedMessage,
        ...(sanitizedConfirmedMedia ? { media: sanitizedConfirmedMedia } : {}),
      }

      try {
        await upsertRemoteMessage({
          currentUser: useAuthStore.getState().user ?? null,
          message: sanitizedConfirmedMessage,
        })
      } catch (error) {
        console.error('[ChatMediaUpload] Failed to persist confirmed media message locally', error)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.messages(job.conversationId),
        })
      }

      try {
        upsertMessageIntoConversationCache(queryClient, sanitizedConfirmedMessage)
        patchExistingMessageAcrossConversationCaches(queryClient, sanitizedConfirmedMessage)
        upsertConversationSummaryInCache(queryClient, {
          id: sanitizedConfirmedMessage.conversationId,
          lastMessage: sanitizedConfirmedMessage.content ?? getMediaPlaceholderLabel(job.type),
          lastMessageAt: sanitizedConfirmedMessage.createdAt,
          updatedAt: sanitizedConfirmedMessage.updatedAt,
        })
      } catch (error) {
        console.error('[ChatMediaUpload] Failed to sync confirmed media message cache', error)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.messages(job.conversationId),
        })
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
      }

      useChatStore.getState().confirmMessage(clientMessageId, sanitizedConfirmedMessage)
      clearJobProgress(clientMessageId)

      const isProcessing = sanitizedConfirmedMessage.media?.status === 'processing'
      if (sanitizedConfirmedMessage.media?.thumbnailUrl && !isProcessing) {
        await cleanupLocalPoster(job)
      }

      useChatMediaUploadStore.getState().removeJob(clientMessageId)
    },
    [
      cleanupLocalPoster,
      clearJobProgress,
      enqueueLocalMediaMutation,
      patchJob,
      queryClient,
      requireRunnableJob,
      runUploadTask,
      setJobStage,
    ],
  )

  const markJobsFailed = useCallback(
    async (jobs: ChatMediaUploadJob[], failureReason: string) => {
      if (jobs.length === 0) {
        return
      }

      const jobIdsByConversation = new Map<string, Set<string>>()
      jobs.forEach((job) => {
        const currentIds = jobIdsByConversation.get(job.conversationId) ?? new Set<string>()
        currentIds.add(job.clientMessageId)
        jobIdsByConversation.set(job.conversationId, currentIds)
      })

      unstable_batchedUpdates(() => {
        jobs.forEach((job) => {
          clearJobProgress(job.clientMessageId)
          setJobStage(job.clientMessageId, 'failed', { failureReason })
        })

        jobIdsByConversation.forEach((jobIds, conversationId) => {
          patchConversationMessagesInCache(queryClient, conversationId, (message) =>
            message.clientMessageId && jobIds.has(message.clientMessageId)
              ? {
                  ...message,
                  media: {
                    ...(message.media ?? {}),
                    failureReason,
                    uploadStage: 'failed',
                  },
                  status: 'FAILED',
                }
              : message,
          )
        })
      })

      await Promise.allSettled(
        jobs.map((job) =>
          enqueueLocalMediaMutation(job.clientMessageId, () =>
            markMediaMessageFailed({
              clientMessageId: job.clientMessageId,
              conversationId: job.conversationId,
              failureReason,
            }),
          ),
        ),
      )
    },
    [clearJobProgress, enqueueLocalMediaMutation, queryClient, setJobStage],
  )

  const markJobFailed = useCallback(
    async (clientMessageId: string, failureReason: string) => {
      const job = useChatMediaUploadStore.getState().jobsById[clientMessageId]
      if (!job) {
        return
      }

      await markJobsFailed([job], failureReason)
    },
    [markJobsFailed],
  )

  const processJob = useCallback(
    async (clientMessageId: string) => {
      if (processingJobIdRef.current === clientMessageId) {
        return
      }

      processingJobIdRef.current = clientMessageId
      useChatMediaUploadStore.getState().setActiveJobId(clientMessageId)
      syncOptimisticMessageFromJob(clientMessageId)

      try {
        await finalizeAndSendJob(clientMessageId)
      } catch (error) {
        const failureReason = getUploadFailureReason(error)

        if (failureReason !== 'Upload aborted') {
          await markJobFailed(clientMessageId, failureReason)
        }
      } finally {
        processingJobIdRef.current = null
        uploadTaskRef.current = null
        thumbnailTaskRef.current = null

        if (useChatMediaUploadStore.getState().activeJobId === clientMessageId) {
          useChatMediaUploadStore.getState().setActiveJobId(null)
        }
      }
    },
    [finalizeAndSendJob, markJobFailed, syncOptimisticMessageFromJob],
  )

  const cancelPendingJob = useCallback(
    async (clientMessageId: string) => {
      const store = useChatMediaUploadStore.getState()
      const job = store.jobsById[clientMessageId]

      if (!job || job.deliveryStartedAt) {
        return
      }

      if (store.activeJobId === clientMessageId) {
        await Promise.allSettled([
          uploadTaskRef.current?.cancelAsync(),
          thumbnailTaskRef.current?.cancelAsync(),
        ])
      }

      await Promise.allSettled([
        deletePendingMediaMessage({
          clientMessageId,
          conversationId: job.conversationId,
        }),
        cleanupLocalPoster(job),
      ])

      useChatStore.getState().removeOptimisticMessage(job.conversationId, clientMessageId)
      clearJobProgress(clientMessageId)
      useChatMediaUploadStore.getState().acknowledgeCancel(clientMessageId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    },
    [cleanupLocalPoster, clearJobProgress, queryClient],
  )

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const store = useChatMediaUploadStore.getState()
      const previousAppState = store.appState

      store.setAppState(nextAppState)

      if (previousAppState !== 'active' && nextAppState === 'active') {
        if (reconcileTimeoutRef.current) {
          clearTimeout(reconcileTimeoutRef.current)
        }

        reconcileTimeoutRef.current = setTimeout(() => {
          reconcileTimeoutRef.current = null
          useChatMediaUploadStore.getState().bumpReconcileVersion()
        }, FOREGROUND_RECONCILE_GRACE_MS)
        return
      }

      if (reconcileTimeoutRef.current) {
        clearTimeout(reconcileTimeoutRef.current)
        reconcileTimeoutRef.current = null
      }
    })

    return () => {
      if (reconcileTimeoutRef.current) {
        clearTimeout(reconcileTimeoutRef.current)
        reconcileTimeoutRef.current = null
      }
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    Object.keys(cancelRequestById).forEach((clientMessageId) => {
      void cancelPendingJob(clientMessageId)
    })
  }, [cancelPendingJob, cancelRequestById])

  useEffect(() => {
    if (!queuedJobId || activeJobId || appState !== 'active') {
      return
    }

    void processJob(queuedJobId)
  }, [activeJobId, appState, processJob, queuedJobId])

  useEffect(() => {
    if (appState !== 'active') {
      return
    }

    const now = Date.now()
    const store = useChatMediaUploadStore.getState()
    const pendingJobs = Object.values(store.jobsById).filter(
      (job) => job.uploadStage === 'uploading' || job.uploadStage === 'syncing',
    )
    const staleJobs = pendingJobs.filter((job) => {
      const heartbeatAt = job.lastProgressAt ?? job.uploadStartedAt ?? now
      return now - heartbeatAt >= JOB_STALE_TIMEOUT_MS
    })

    if (staleJobs.length === 0) {
      return
    }

    staleJobs.forEach((job) => {
      if (store.activeJobId === job.clientMessageId) {
        void uploadTaskRef.current?.cancelAsync().catch(() => undefined)
        void thumbnailTaskRef.current?.cancelAsync().catch(() => undefined)
      }
    })

    void markJobsFailed(staleJobs, 'Upload timed out. Please retry.')
  }, [appState, markJobsFailed, reconcileVersion])

  return <>{children}</>
}
