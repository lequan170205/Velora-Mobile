import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

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
  createdAt: string
  cleanupPending: boolean
}

interface QueueSlice {
  jobsById: Record<string, ChatMediaUploadJob>
  queue: string[]
  activeJobId: string | null
  enqueueJobs: (jobs: ChatMediaUploadJob[]) => void
  setActiveJobId: (clientMessageId: string | null) => void
  patchJob: (clientMessageId: string, patch: Partial<ChatMediaUploadJob>) => void
  setJobStage: (
    clientMessageId: string,
    uploadStage: MessageMediaUploadStage,
    options?: { failureReason?: string },
  ) => void
  retryJob: (clientMessageId: string) => void
  cancelJob: (clientMessageId: string) => void
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
  cancelJob: (clientMessageId) =>
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
            uploadStage: 'failed',
            failureReason: 'Upload cancelled',
          },
        },
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
      delete nextJobsById[clientMessageId]

      return {
        jobsById: nextJobsById,
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

export const useChatMediaUploadStore = create<ChatMediaUploadStore>()(
  subscribeWithSelector((...args) => ({
    ...createQueueSlice(...args),
    ...createProgressSlice(...args),
    ...createLifecycleSlice(...args),
  })),
)

export const selectChatMediaUploadJob = (clientMessageId?: string | null) => {
  return (state: ChatMediaUploadStore) =>
    (clientMessageId ? state.jobsById[clientMessageId] : undefined) ?? null
}

export const selectChatMediaUploadProgress = (clientMessageId?: string | null) => {
  return (state: ChatMediaUploadStore) =>
    (clientMessageId ? state.progressById[clientMessageId] : undefined) ?? null
}
