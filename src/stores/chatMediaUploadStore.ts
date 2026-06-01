import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware'

import type { AllowedChatMediaType } from '../lib/chatMedia'
import type { Message, MessageMedia, MessageMediaUploadStage } from '../types/conversation.types'
import type { AppStateStatus } from 'react-native'
import type { StateCreator } from 'zustand'

export interface ChatMediaUploadProgress {
  totalBytesSent: number
  totalBytesExpectedToSend: number
  progress: number
}

export interface ChatMediaUploadJob {
  clientMessageId: string
  conversationId: string
  type: 'image' | 'video'
  content: string
  fileUri: string
  fileName: string
  fileType: AllowedChatMediaType
  width?: number
  height?: number
  durationMs?: number
  displayWidth: number
  displayHeight: number
  replyToId?: string
  replyPreview?: Message['replyPreview']
  localPosterUri?: string
  uploadStage: MessageMediaUploadStage
  failureReason?: string
  fileKey?: string
  thumbnailKey?: string
  preparedMedia?: MessageMedia
  uploadStartedAt?: number
  lastProgressAt?: number
  deliveryStartedAt?: number
  createdAt: string
  cleanupPending: boolean
}

interface QueueSlice {
  jobsById: Record<string, ChatMediaUploadJob>
  queue: string[]
  activeJobId: string | null
  cancelRequestById: Record<string, number>
  enqueueJobs: (jobs: ChatMediaUploadJob[]) => void
  setActiveJobId: (clientMessageId: string | null) => void
  patchJob: (clientMessageId: string, patch: Partial<ChatMediaUploadJob>) => void
  setJobStage: (
    clientMessageId: string,
    uploadStage: MessageMediaUploadStage,
    options?: { failureReason?: string },
  ) => void
  retryJob: (clientMessageId: string) => void
  requestCancel: (clientMessageId: string) => void
  acknowledgeCancel: (clientMessageId: string) => void
  removeJob: (clientMessageId: string) => void
}

interface ProgressSlice {
  progressById: Record<string, ChatMediaUploadProgress>
  setJobProgress: (
    clientMessageId: string,
    progress: {
      totalBytesSent: number
      totalBytesExpectedToSend: number
    },
  ) => void
  clearJobProgress: (clientMessageId: string) => void
}

interface LifecycleSlice {
  appState: AppStateStatus
  reconcileVersion: number
  setAppState: (appState: AppStateStatus) => void
  bumpReconcileVersion: () => void
}

type ChatMediaUploadStore = QueueSlice & ProgressSlice & LifecycleSlice

const createQueueSlice: StateCreator<ChatMediaUploadStore, [], [], QueueSlice> = (set) => ({
  jobsById: {},
  queue: [],
  activeJobId: null,
  cancelRequestById: {},
  enqueueJobs: (jobs) =>
    set((state) => {
      const nextJobsById = { ...state.jobsById }
      const nextQueue = [...state.queue]

      jobs.forEach((job) => {
        nextJobsById[job.clientMessageId] = job
        if (!nextQueue.includes(job.clientMessageId)) {
          nextQueue.push(job.clientMessageId)
        }
      })

      return {
        jobsById: nextJobsById,
        queue: nextQueue,
      }
    }),
  setActiveJobId: (clientMessageId) =>
    set((state) => ({
      activeJobId: clientMessageId,
      queue: clientMessageId
        ? state.queue.filter((queuedId) => queuedId !== clientMessageId)
        : state.queue,
    })),
  patchJob: (clientMessageId, patch) =>
    set((state) => {
      const currentJob = state.jobsById[clientMessageId]
      if (!currentJob) {
        return state
      }

      return {
        jobsById: {
          ...state.jobsById,
          [clientMessageId]: {
            ...currentJob,
            ...patch,
          },
        },
      }
    }),
  setJobStage: (clientMessageId, uploadStage, options) =>
    set((state) => {
      const currentJob = state.jobsById[clientMessageId]
      if (!currentJob) {
        return state
      }

      const nextJob: ChatMediaUploadJob = {
        ...currentJob,
        uploadStage,
        ...(options?.failureReason !== undefined ? { failureReason: options.failureReason } : {}),
      }

      return {
        jobsById: {
          ...state.jobsById,
          [clientMessageId]: nextJob,
        },
        activeJobId:
          state.activeJobId === clientMessageId && uploadStage === 'failed'
            ? null
            : state.activeJobId,
      }
    }),
  retryJob: (clientMessageId) =>
    set((state) => {
      const currentJob = state.jobsById[clientMessageId]
      if (!currentJob) {
        return state
      }

      const nextQueue = state.queue.includes(clientMessageId)
        ? state.queue
        : [...state.queue, clientMessageId]
      const {
        failureReason: _failureReason,
        uploadStartedAt: _uploadStartedAt,
        lastProgressAt: _lastProgressAt,
        deliveryStartedAt: _deliveryStartedAt,
        ...restJob
      } = currentJob

      return {
        jobsById: {
          ...state.jobsById,
          [clientMessageId]: {
            ...restJob,
            uploadStage: 'queued',
          },
        },
        queue: nextQueue,
        activeJobId: state.activeJobId === clientMessageId ? null : state.activeJobId,
      }
    }),
  requestCancel: (clientMessageId) =>
    set((state) => {
      const currentJob = state.jobsById[clientMessageId]
      if (!currentJob || currentJob.deliveryStartedAt || currentJob.uploadStage === 'processing') {
        return state
      }

      return {
        queue: state.queue.filter((queuedId) => queuedId !== clientMessageId),
        cancelRequestById: {
          ...state.cancelRequestById,
          [clientMessageId]: Date.now(),
        },
      }
    }),
  acknowledgeCancel: (clientMessageId) =>
    set((state) => {
      const nextJobsById = { ...state.jobsById }
      const nextRequests = { ...state.cancelRequestById }
      delete nextJobsById[clientMessageId]
      delete nextRequests[clientMessageId]

      return {
        jobsById: nextJobsById,
        cancelRequestById: nextRequests,
        queue: state.queue.filter((queuedId) => queuedId !== clientMessageId),
        activeJobId: state.activeJobId === clientMessageId ? null : state.activeJobId,
      }
    }),
  removeJob: (clientMessageId) =>
    set((state) => {
      if (!state.jobsById[clientMessageId]) {
        return state
      }

      const nextJobsById = { ...state.jobsById }
      const nextRequests = { ...state.cancelRequestById }
      delete nextJobsById[clientMessageId]
      delete nextRequests[clientMessageId]

      return {
        jobsById: nextJobsById,
        cancelRequestById: nextRequests,
        queue: state.queue.filter((queuedId) => queuedId !== clientMessageId),
        activeJobId: state.activeJobId === clientMessageId ? null : state.activeJobId,
      }
    }),
})

const createProgressSlice: StateCreator<ChatMediaUploadStore, [], [], ProgressSlice> = (set) => ({
  progressById: {},
  setJobProgress: (clientMessageId, progress) =>
    set((state) => {
      const expectedBytes =
        progress.totalBytesExpectedToSend > 0 ? progress.totalBytesExpectedToSend : 1

      return {
        progressById: {
          ...state.progressById,
          [clientMessageId]: {
            totalBytesSent: progress.totalBytesSent,
            totalBytesExpectedToSend: progress.totalBytesExpectedToSend,
            progress: Math.min(progress.totalBytesSent / expectedBytes, 1),
          },
        },
      }
    }),
  clearJobProgress: (clientMessageId) =>
    set((state) => {
      if (!state.progressById[clientMessageId]) {
        return state
      }

      const nextProgressById = { ...state.progressById }
      delete nextProgressById[clientMessageId]

      return {
        progressById: nextProgressById,
      }
    }),
})

const createLifecycleSlice: StateCreator<ChatMediaUploadStore, [], [], LifecycleSlice> = (set) => ({
  appState: 'active',
  reconcileVersion: 0,
  setAppState: (appState) => set(() => ({ appState })),
  bumpReconcileVersion: () =>
    set((state) => ({
      reconcileVersion: state.reconcileVersion + 1,
    })),
})

const normalizeHydratedJob = (job: ChatMediaUploadJob): ChatMediaUploadJob => {
  if (job.uploadStage === 'failed') {
    return job
  }

  const {
    deliveryStartedAt: _deliveryStartedAt,
    failureReason: _failureReason,
    lastProgressAt: _lastProgressAt,
    uploadStartedAt: _uploadStartedAt,
    ...restJob
  } = job

  return {
    ...restJob,
    uploadStage: 'queued',
  }
}

export const useChatMediaUploadStore = create<ChatMediaUploadStore>()(
  persist(
    subscribeWithSelector((...args) => ({
      ...createQueueSlice(...args),
      ...createProgressSlice(...args),
      ...createLifecycleSlice(...args),
    })),
    {
      name: 'chat-media-upload-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        cancelRequestById: state.cancelRequestById,
        jobsById: state.jobsById,
        queue: state.queue,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Record<string, unknown>
        const persistedJobs =
          (persisted.jobsById as Record<string, ChatMediaUploadJob> | undefined) ?? {}
        const persistedQueue = (persisted.queue as string[] | undefined) ?? []
        const cancelRequestById =
          (persisted.cancelRequestById as Record<string, number> | undefined) ?? {}
        const jobsById = Object.fromEntries(
          Object.entries(persistedJobs).map(([clientMessageId, job]) => [
            clientMessageId,
            normalizeHydratedJob(job),
          ]),
        )
        const queue = Array.from(
          new Set(
            [
              ...persistedQueue,
              ...Object.values(jobsById)
                .filter(
                  (job) => job.uploadStage !== 'failed' && !cancelRequestById[job.clientMessageId],
                )
                .map((job) => job.clientMessageId),
            ].filter((clientMessageId) => jobsById[clientMessageId]),
          ),
        )

        return {
          ...currentState,
          activeJobId: null,
          cancelRequestById,
          jobsById,
          progressById: {},
          queue,
        }
      },
    },
  ),
)

export const selectChatMediaUploadJob = (clientMessageId?: string | null) => {
  return (state: ChatMediaUploadStore) =>
    (clientMessageId ? state.jobsById[clientMessageId] : undefined) ?? null
}

export const selectChatMediaUploadProgress = (clientMessageId?: string | null) => {
  return (state: ChatMediaUploadStore) =>
    (clientMessageId ? state.progressById[clientMessageId] : undefined) ?? null
}
