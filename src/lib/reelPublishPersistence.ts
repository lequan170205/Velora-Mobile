import AsyncStorage from '@react-native-async-storage/async-storage'

import type { ReelPublishSource, ReelSeriesDraftSelection } from '../types/reel-creator'
import type { CreateReelPayload, Reel, ReelVisibility } from '../types/reel.types'

const REEL_PUBLISH_STORAGE_PREFIX = 'velora.reels.publish-operations:'

export type ReelPublishCompletedStep =
  | 'source_prepared'
  | 'upload_url_persisted'
  | 'media_uploaded'
  | 'reel_created'
  | 'visibility_applied'
  | 'series_attached'
  | 'local_playback_committed'

export type ReelPublishPayload = Omit<CreateReelPayload, 'mediaKey' | 'publishIntentId'>

export interface ReelPublishOperation {
  version: 1
  userId: string
  deviceId: string
  publishIntentId: string
  createdAt: number
  updatedAt: number
  state: 'pending' | 'cancelled' | 'completed'
  requiresCancellation?: boolean
  source: ReelPublishSource
  payload: ReelPublishPayload
  seriesSelection?: ReelSeriesDraftSelection | null
  mediaKey?: string
  uploadUrl?: string
  uploadUrlExpiresAt?: number
  uploadedAt?: number
  reelId?: string
  canonicalReel?: Reel
  visibilityApplied?: boolean
  createdSeriesId?: string
  seriesAttached?: boolean
  localPlaybackUri?: string
  localThumbnailUri?: string
  completedSteps: ReelPublishCompletedStep[]
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getStorageKey = (userId: string) => `${REEL_PUBLISH_STORAGE_PREFIX}${userId}`

export class ReelPublishStorageError extends Error {
  readonly userId: string
  readonly recoverable = true

  constructor(userId: string, message: string) {
    super(message)
    this.name = 'ReelPublishStorageError'
    this.userId = userId
  }
}

const storageQueues = new Map<string, Promise<void>>()

const runSerialized = async <T>(userId: string, operation: () => Promise<T>) => {
  const previous = storageQueues.get(userId) ?? Promise.resolve()
  let resolveCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve
  })
  storageQueues.set(userId, current)

  await previous.catch(() => undefined)

  try {
    return await operation()
  } finally {
    resolveCurrent()
    if (storageQueues.get(userId) === current) {
      storageQueues.delete(userId)
    }
  }
}

const readOperations = async (userId: string): Promise<ReelPublishOperation[]> => {
  const rawValue = await AsyncStorage.getItem(getStorageKey(userId))

  if (!rawValue) {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawValue) as unknown
  } catch {
    throw new ReelPublishStorageError(
      userId,
      'A saved Reel publish record is unreadable. Keep it for recovery before retrying.',
    )
  }

  if (!Array.isArray(parsed)) {
    throw new ReelPublishStorageError(
      userId,
      'A saved Reel publish record has an invalid shape. Keep it for recovery before retrying.',
    )
  }

  const operations: ReelPublishOperation[] = []
  for (const value of parsed) {
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      value.userId !== userId ||
      typeof value.deviceId !== 'string' ||
      typeof value.publishIntentId !== 'string' ||
      value.publishIntentId.length === 0 ||
      (value.state !== 'pending' && value.state !== 'cancelled' && value.state !== 'completed') ||
      (value.requiresCancellation !== undefined &&
        typeof value.requiresCancellation !== 'boolean') ||
      !isRecord(value.source) ||
      typeof value.source.uri !== 'string' ||
      !isRecord(value.payload) ||
      !Array.isArray(value.completedSteps)
    ) {
      throw new ReelPublishStorageError(
        userId,
        'A saved Reel publish record is invalid. Keep it for recovery before retrying.',
      )
    }

    operations.push(value as unknown as ReelPublishOperation)
  }

  return operations
}

export const listReelPublishOperations = (userId: string) => {
  if (!userId) {
    return Promise.resolve([] as ReelPublishOperation[])
  }

  return runSerialized(userId, () => readOperations(userId))
}

export const getPendingReelPublishOperation = async (userId: string) => {
  const operations = await listReelPublishOperations(userId)
  return operations.find((operation) => operation.state === 'pending') ?? null
}

export const saveReelPublishOperation = async (operation: ReelPublishOperation) => {
  if (!operation.userId || !operation.publishIntentId) {
    throw new Error('Cannot persist a reel publish operation without an owner and intent.')
  }

  await runSerialized(operation.userId, async () => {
    const operations = await readOperations(operation.userId)
    const nextOperation = {
      ...operation,
      updatedAt: Date.now(),
    }
    const existingIndex = operations.findIndex(
      (candidate) => candidate.publishIntentId === operation.publishIntentId,
    )

    if (existingIndex === -1) {
      operations.push(nextOperation)
    } else {
      operations[existingIndex] = nextOperation
    }

    await AsyncStorage.setItem(getStorageKey(operation.userId), JSON.stringify(operations))
  })
}

export const removeReelPublishOperation = async (userId: string, publishIntentId: string) => {
  if (!userId || !publishIntentId) {
    return
  }

  await runSerialized(userId, async () => {
    const operations = await readOperations(userId)
    const nextOperations = operations.filter(
      (operation) => operation.publishIntentId !== publishIntentId,
    )

    if (nextOperations.length === 0) {
      await AsyncStorage.removeItem(getStorageKey(userId))
      return
    }

    await AsyncStorage.setItem(getStorageKey(userId), JSON.stringify(nextOperations))
  })
}

export const cancelReelPublishOperation = async (userId: string, publishIntentId: string) => {
  if (!userId || !publishIntentId) {
    return
  }

  await runSerialized(userId, async () => {
    const operations = await readOperations(userId)
    const nextOperations = operations.map((operation) =>
      operation.publishIntentId === publishIntentId
        ? { ...operation, state: 'cancelled' as const, updatedAt: Date.now() }
        : operation,
    )
    await AsyncStorage.setItem(getStorageKey(userId), JSON.stringify(nextOperations))
  })
}

export const markReelPublishStep = async (
  operation: ReelPublishOperation,
  step: ReelPublishCompletedStep,
  patch: Partial<ReelPublishOperation> = {},
) => {
  const completedSteps = operation.completedSteps.includes(step)
    ? operation.completedSteps
    : [...operation.completedSteps, step]
  const nextOperation: ReelPublishOperation = {
    ...operation,
    ...patch,
    completedSteps,
    updatedAt: Date.now(),
  }

  await saveReelPublishOperation(nextOperation)
  return nextOperation
}

export const createReelPublishOperation = ({
  deviceId,
  payload,
  publishIntentId,
  seriesSelection,
  source,
  userId,
}: {
  deviceId: string
  payload: ReelPublishPayload
  publishIntentId: string
  seriesSelection?: ReelSeriesDraftSelection | null
  source: ReelPublishSource
  userId: string
}): ReelPublishOperation => ({
  version: 1,
  userId,
  deviceId,
  publishIntentId,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  state: 'pending',
  source,
  payload,
  ...(seriesSelection ? { seriesSelection } : {}),
  completedSteps: [],
})

export const isReelPublishPayloadCompatible = (
  operation: ReelPublishOperation,
  payload: ReelPublishPayload,
  sourceUri: string,
) =>
  operation.source.uri === sourceUri &&
  JSON.stringify(operation.payload) === JSON.stringify(payload)

export const getReelPublishVisibility = (operation: ReelPublishOperation): ReelVisibility | null =>
  operation.payload.visibility ?? null
