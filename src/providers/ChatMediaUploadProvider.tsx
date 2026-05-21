import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useEffect, useRef } from 'react'
import { AppState, Platform, unstable_batchedUpdates } from 'react-native'

import { conversationApi } from '../api/conversation.api'
import { mediaApi } from '../api/media.api'
import { getMediaPlaceholderLabel } from '../lib/chatMedia'
import {
  patchConversationMessagesInCache,
  upsertConversationSummaryInCache,
  upsertMessageIntoConversationCache,
} from '../lib/chatMessageCache'
import { mergeMessageRecords } from '../lib/messageIdentity'
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

export function ChatMediaUploadProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const uploadTaskRef = useRef<UploadTask | null>(null)
  const thumbnailTaskRef = useRef<UploadTask | null>(null)
  const processingJobIdRef = useRef<string | null>(null)
  const reconcileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeJobId = useChatMediaUploadStore((state) => state.activeJobId)
  const queuedJobId = useChatMediaUploadStore((state) =>
    state.activeJobId ? null : (state.queue[0] ?? null),
  )
  const appState = useChatMediaUploadStore((state) => state.appState)
  const reconcileVersion = useChatMediaUploadStore((state) => state.reconcileVersion)

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
          uploadStage: _previousUploadStage,
          uploadStartedAt: _previousUploadStartedAt,
          lastProgressAt: _previousLastProgressAt,
          ...restMedia
        } = message.media ?? {}

        const resolvedWidth = job.width ?? restMedia.width
        const resolvedHeight = job.height ?? restMedia.height
        const resolvedDurationMs = job.durationMs ?? restMedia.durationMs
        const nextMedia: MessageMedia = {
          ...restMedia,
          ...(job.preparedMedia ?? {}),
          ...(job.fileKey ? { fileKey: job.fileKey } : {}),
          ...(job.thumbnailKey ? { thumbnailKey: job.thumbnailKey } : {}),
          ...(job.localPosterUri ? { localPosterUri: job.localPosterUri } : {}),
          localFileUri: job.fileUri,
          displayWidth: job.displayWidth,
          displayHeight: job.displayHeight,
          mimeType: job.fileType,
          uploadStage: job.uploadStage,
          ...(resolvedWidth ? { width: resolvedWidth } : {}),
          ...(resolvedHeight ? { height: resolvedHeight } : {}),
          ...(resolvedDurationMs ? { durationMs: resolvedDurationMs } : {}),
          ...(job.failureReason ? { failureReason: job.failureReason } : {}),
          ...(job.uploadStartedAt ? { uploadStartedAt: job.uploadStartedAt } : {}),
          ...(job.lastProgressAt ? { lastProgressAt: job.lastProgressAt } : {}),
        }

        return {
          ...message,
          content: job.content,
          type: job.type,
          status: job.uploadStage === 'failed' ? 'FAILED' : 'SENT',
          media: nextMedia,
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

  const setJobStage = useCallback(
    (
      clientMessageId: string,
      uploadStage: ChatMediaUploadJob['uploadStage'],
      options?: { failureReason?: string; syncOptimistic?: boolean },
    ) => {
      useChatMediaUploadStore
        .getState()
        .setJobStage(
          clientMessageId,
          uploadStage,
          options?.failureReason ? { failureReason: options.failureReason } : undefined,
        )
      if (options?.syncOptimistic !== false) {
        syncOptimisticMessageFromJob(clientMessageId)
      }
    },
    [syncOptimisticMessageFromJob],
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

    if (!job || state.activeJobId !== clientMessageId) {
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

      if (finalUri.startsWith('ph://') || finalUri.startsWith('assets-library://')) {
        const fileExt = fileType.split('/')[1] || 'mp4'
        const docDir = LegacyFileSystem.documentDirectory
        const baseDir = docDir?.endsWith('/') ? docDir : `${docDir}/`

        const tempPath = `${baseDir}temp_upload_${clientMessageId}.${fileExt}`

        await LegacyFileSystem.copyAsync({
          from: finalUri,
          to: tempPath,
        })

        finalUri = tempPath
      }

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
          patchJob(clientMessageId, thumbnailKey ? { thumbnailKey } : {}, { syncOptimistic: false })

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

      const savedMessage = await conversationApi.sendMessage(job.conversationId, {
        clientMessageId,
        content: job.content,
        media: preparedMedia,
        type: job.type,
        signalType: 0,
        ...(job.replyToId ? { replyToId: job.replyToId } : {}),
      })

      const optimisticMessage =
        useChatStore
          .getState()
          .optimisticMessages[
            job.conversationId
          ]?.find((message) => message.id === clientMessageId) ?? null

      const confirmedMessage = optimisticMessage
        ? (mergeMessageRecords(optimisticMessage, {
            ...savedMessage,
            media: preparedMedia,
          }) as Message)
        : ({
            ...savedMessage,
            media: preparedMedia,
          } as Message)
      const sanitizedConfirmedMedia = sanitizeConfirmedMedia(confirmedMessage.media)

      const sanitizedConfirmedMessage: Message = {
        ...confirmedMessage,
        ...(sanitizedConfirmedMedia ? { media: sanitizedConfirmedMedia } : {}),
      }

      upsertMessageIntoConversationCache(queryClient, sanitizedConfirmedMessage)
      upsertConversationSummaryInCache(queryClient, {
        id: sanitizedConfirmedMessage.conversationId,
        lastMessage: sanitizedConfirmedMessage.content ?? getMediaPlaceholderLabel(job.type),
        lastMessageAt: sanitizedConfirmedMessage.createdAt,
        updatedAt: sanitizedConfirmedMessage.updatedAt,
      })

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
      patchJob,
      queryClient,
      requireRunnableJob,
      runUploadTask,
      setJobStage,
    ],
  )

  const markJobsFailed = useCallback(
    (jobs: ChatMediaUploadJob[], failureReason: string) => {
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
                }
              : message,
          )
        })
      })
    },
    [clearJobProgress, queryClient, setJobStage],
  )

  const markJobFailed = useCallback(
    async (clientMessageId: string, failureReason: string) => {
      const job = useChatMediaUploadStore.getState().jobsById[clientMessageId]
      if (!job) {
        return
      }

      markJobsFailed([job], failureReason)
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

    markJobsFailed(staleJobs, 'Upload timed out. Please retry.')
  }, [appState, markJobsFailed, reconcileVersion])

  return <>{children}</>
}
