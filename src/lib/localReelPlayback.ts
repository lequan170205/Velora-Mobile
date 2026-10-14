import AsyncStorage from '@react-native-async-storage/async-storage'

import { getOrCreatePushTokenInstallationId } from './notifications/pushTokenOperationState'

import type { ReelPublishSource } from '../types/reel-creator'
import type { ReelEditPayload, Reel } from '../types/reel.types'

type LegacyFileInfo = { exists: true; size?: number } | { exists: false; size?: undefined }

type LegacyFileSystemModule = {
  documentDirectory: string | null
  makeDirectoryAsync: (uri: string, options?: { intermediates?: boolean }) => Promise<void>
  getInfoAsync: (uri: string) => Promise<LegacyFileInfo>
  copyAsync: (options: { from: string; to: string }) => Promise<void>
  moveAsync: (options: { from: string; to: string }) => Promise<void>
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const FileSystem = require('expo-file-system/legacy') as LegacyFileSystemModule

export const LOCAL_REEL_PLAYBACK_RETENTION_MS = 1000 * 60 * 60 * 24 * 14

const LOCAL_REEL_STORAGE_PREFIX = 'velora.reels.local-playback:'
const LOCAL_REEL_DIRECTORY = `${FileSystem.documentDirectory ?? ''}velora-reel-local/`

export interface LocalReelPlaybackRecord {
  version: 1
  reelId: string
  ownerId: string
  deviceId: string
  publishIntentId: string
  localUri: string
  localThumbnailUri?: string
  edit?: ReelEditPayload
  sourceWidth?: number
  sourceHeight?: number
  createdAt: number
  lastAccessedAt: number
  expiresAt: number
}

type RecordMap = Map<string, LocalReelPlaybackRecord>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const storageKey = (ownerId: string) => `${LOCAL_REEL_STORAGE_PREFIX}${ownerId}`
const ownerDirectory = (ownerId: string) => `${LOCAL_REEL_DIRECTORY}${sanitizePathPart(ownerId)}/`

const sanitizePathPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_')

const getExtension = (value: string | null | undefined, fallback = '.mp4') => {
  if (!value) {
    return fallback
  }

  const match = value.split('?')[0]?.match(/\.[a-zA-Z0-9]+$/)
  return match?.[0] ?? fallback
}

const getFileInfo = async (uri: string) => {
  try {
    return await FileSystem.getInfoAsync(uri)
  } catch {
    return null
  }
}

const fileExists = async (uri: string) => Boolean((await getFileInfo(uri))?.exists)

const deviceIdPromise = getOrCreatePushTokenInstallationId()
let cachedDeviceId: string | null = null
void deviceIdPromise.then((deviceId) => {
  cachedDeviceId = deviceId
})

const getDeviceId = async () => {
  if (cachedDeviceId) {
    return cachedDeviceId
  }

  cachedDeviceId = await deviceIdPromise
  return cachedDeviceId
}

const recordQueues = new Map<string, Promise<void>>()
const pinnedPlaybackKeys = new Set<string>()
let localPlaybackAuthGeneration = 0
let activeLocalPlaybackOwnerId: string | null = null

const playbackKey = (ownerId: string, reelId: string) => `${ownerId}:${reelId}`

export const beginLocalReelPlaybackAuthBoundary = (ownerId: string | null) => {
  localPlaybackAuthGeneration += 1
  activeLocalPlaybackOwnerId = ownerId
  return localPlaybackAuthGeneration
}

export const getLocalReelPlaybackAuthGeneration = () => localPlaybackAuthGeneration

const isCurrentAuthContext = (ownerId: string, generation: number) =>
  activeLocalPlaybackOwnerId === ownerId && localPlaybackAuthGeneration === generation

const assertCurrentAuthContext = (ownerId: string, generation: number) => {
  if (!isCurrentAuthContext(ownerId, generation)) {
    throw new Error('The authenticated Reel playback owner changed during the operation.')
  }
}

const runSerialized = async <T>(ownerId: string, operation: () => Promise<T>) => {
  const previous = recordQueues.get(ownerId) ?? Promise.resolve()
  let resolveCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve
  })
  recordQueues.set(ownerId, current)
  await previous.catch(() => undefined)

  try {
    return await operation()
  } finally {
    resolveCurrent()
    if (recordQueues.get(ownerId) === current) {
      recordQueues.delete(ownerId)
    }
  }
}

const readRecords = async (ownerId: string): Promise<LocalReelPlaybackRecord[]> => {
  const rawValue = await AsyncStorage.getItem(storageKey(ownerId))
  if (!rawValue) {
    return []
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((value): value is LocalReelPlaybackRecord => {
      if (!isRecord(value)) {
        return false
      }

      return (
        value.version === 1 &&
        value.ownerId === ownerId &&
        typeof value.reelId === 'string' &&
        typeof value.deviceId === 'string' &&
        typeof value.localUri === 'string' &&
        typeof value.expiresAt === 'number'
      )
    })
  } catch {
    return []
  }
}

const writeRecords = async (ownerId: string, records: LocalReelPlaybackRecord[]) => {
  if (records.length === 0) {
    await AsyncStorage.removeItem(storageKey(ownerId))
    return
  }

  await AsyncStorage.setItem(storageKey(ownerId), JSON.stringify(records))
}

const removeRecordFiles = async (record: LocalReelPlaybackRecord) => {
  await FileSystem.deleteAsync(record.localUri, { idempotent: true }).catch(() => undefined)
  if (record.localThumbnailUri) {
    await FileSystem.deleteAsync(record.localThumbnailUri, { idempotent: true }).catch(
      () => undefined,
    )
  }
}

const cacheRecord = (record: LocalReelPlaybackRecord) => {
  localRecordsByReelId.set(record.reelId, record)
}

const localRecordsByReelId: RecordMap = new Map()

const getStoredRecord = async (ownerId: string, reelId: string) => {
  const memoryRecord = localRecordsByReelId.get(reelId)
  if (memoryRecord) {
    return memoryRecord
  }

  const records = await runSerialized(ownerId, () => readRecords(ownerId))
  const record = records.find((candidate) => candidate.reelId === reelId) ?? null
  if (record) {
    cacheRecord(record)
  }
  return record
}

const saveRecord = async (
  record: LocalReelPlaybackRecord,
  generation = localPlaybackAuthGeneration,
) => {
  assertCurrentAuthContext(record.ownerId, generation)
  await runSerialized(record.ownerId, async () => {
    assertCurrentAuthContext(record.ownerId, generation)
    const records = await readRecords(record.ownerId)
    const nextRecords = records.filter((candidate) => candidate.reelId !== record.reelId)
    nextRecords.push(record)
    await writeRecords(record.ownerId, nextRecords)
  })
  cacheRecord(record)
}

const removeStoredRecord = async (record: LocalReelPlaybackRecord) => {
  let removedRecord: LocalReelPlaybackRecord | null = null
  await runSerialized(record.ownerId, async () => {
    const records = await readRecords(record.ownerId)
    removedRecord = records.find((candidate) => candidate.reelId === record.reelId) ?? null
    await writeRecords(
      record.ownerId,
      records.filter((candidate) => candidate.reelId !== record.reelId),
    )
  })
  localRecordsByReelId.delete(record.reelId)
  pinnedPlaybackKeys.delete(playbackKey(record.ownerId, record.reelId))
  await removeRecordFiles(removedRecord ?? record)
}

const touchStoredRecord = async (
  ownerId: string,
  reelId: string,
  touchedAt: number,
  generation: number,
) => {
  assertCurrentAuthContext(ownerId, generation)
  let touchedRecord: LocalReelPlaybackRecord | null = null
  await runSerialized(ownerId, async () => {
    assertCurrentAuthContext(ownerId, generation)
    const records = await readRecords(ownerId)
    const current = records.find((record) => record.reelId === reelId)
    if (!current) {
      return
    }

    const updated = { ...current, lastAccessedAt: touchedAt }
    touchedRecord = updated
    await writeRecords(
      ownerId,
      records.map((record) => (record.reelId === reelId ? updated : record)),
    )
  })

  if (touchedRecord) {
    cacheRecord(touchedRecord)
  }
  return touchedRecord
}

const ensureLocalDirectory = async (ownerId: string) => {
  if (!FileSystem.documentDirectory) {
    throw new Error('Durable reel storage is unavailable on this device.')
  }

  await FileSystem.makeDirectoryAsync(ownerDirectory(ownerId), { intermediates: true })
}

const retainLocalFile = async (from: string, to: string, ownerId: string, generation: number) => {
  if (from === to || (await fileExists(to))) return
  const stagingUri = `${to}.pending`
  await FileSystem.deleteAsync(stagingUri, { idempotent: true })
  try {
    await FileSystem.copyAsync({ from, to: stagingUri })
    const copied = await getFileInfo(stagingUri)
    const original = await getFileInfo(from)
    if (
      !copied?.exists ||
      copied.size === 0 ||
      (original?.exists && typeof original.size === 'number' && copied.size !== original.size)
    ) {
      throw new Error('The selected reel video could not be retained completely.')
    }
    assertCurrentAuthContext(ownerId, generation)
    await FileSystem.moveAsync({ from: stagingUri, to })
  } finally {
    await FileSystem.deleteAsync(stagingUri, { idempotent: true }).catch(() => undefined)
  }
}

export const pinAuthorizedLocalReelPlayback = (ownerId: string, reelId: string) => {
  if (activeLocalPlaybackOwnerId === ownerId) {
    pinnedPlaybackKeys.add(playbackKey(ownerId, reelId))
  }
}

export const unpinAuthorizedLocalReelPlayback = (ownerId: string, reelId: string) => {
  pinnedPlaybackKeys.delete(playbackKey(ownerId, reelId))
}

export const prepareLocalReelSource = async ({
  ownerId,
  publishIntentId,
  source,
}: {
  ownerId: string
  publishIntentId: string
  source: ReelPublishSource
}) => {
  const generation = localPlaybackAuthGeneration
  assertCurrentAuthContext(ownerId, generation)
  await ensureLocalDirectory(ownerId)
  const baseDirectory = `${ownerDirectory(ownerId)}publish-${sanitizePathPart(publishIntentId)}/`
  await FileSystem.makeDirectoryAsync(baseDirectory, { intermediates: true })

  const localUri = `${baseDirectory}source${getExtension(source.fileName ?? source.uri)}`
  await retainLocalFile(source.uri, localUri, ownerId, generation)

  let localThumbnailUri: string | undefined
  if (source.localThumbnailUri) {
    localThumbnailUri = `${baseDirectory}thumbnail${getExtension(source.localThumbnailUri, '.jpg')}`
    await retainLocalFile(source.localThumbnailUri, localThumbnailUri, ownerId, generation)
  }

  if (!(await fileExists(localUri))) {
    throw new Error('The selected reel video could not be retained on this device.')
  }

  assertCurrentAuthContext(ownerId, generation)

  const deviceId = await getDeviceId()
  assertCurrentAuthContext(ownerId, generation)

  return {
    deviceId,
    localUri,
    ...(localThumbnailUri ? { localThumbnailUri } : {}),
  }
}

export const discardPreparedLocalReelSource = async (ownerId: string, publishIntentId: string) => {
  assertCurrentAuthContext(ownerId, localPlaybackAuthGeneration)
  await FileSystem.deleteAsync(
    `${ownerDirectory(ownerId)}publish-${sanitizePathPart(publishIntentId)}/`,
    { idempotent: true },
  )
}

export const commitLocalReelPlayback = async ({
  edit,
  expiresAt = Date.now() + LOCAL_REEL_PLAYBACK_RETENTION_MS,
  localThumbnailUri,
  localUri,
  ownerId,
  publishIntentId,
  reelId,
  sourceHeight,
  sourceWidth,
}: {
  edit?: ReelEditPayload
  expiresAt?: number
  localThumbnailUri?: string
  localUri: string
  ownerId: string
  publishIntentId: string
  reelId: string
  sourceHeight?: number
  sourceWidth?: number
}) => {
  const generation = localPlaybackAuthGeneration
  assertCurrentAuthContext(ownerId, generation)
  await ensureLocalDirectory(ownerId)
  const finalDirectory = `${ownerDirectory(ownerId)}reel-${sanitizePathPart(reelId)}/`
  await FileSystem.makeDirectoryAsync(finalDirectory, { intermediates: true })
  const finalUri = `${finalDirectory}source${getExtension(localUri)}`

  if (localUri !== finalUri && !(await fileExists(finalUri))) {
    await FileSystem.moveAsync({ from: localUri, to: finalUri })
  }

  let finalThumbnailUri: string | undefined
  if (localThumbnailUri) {
    finalThumbnailUri = `${finalDirectory}thumbnail${getExtension(localThumbnailUri, '.jpg')}`
    if (localThumbnailUri !== finalThumbnailUri && !(await fileExists(finalThumbnailUri))) {
      await FileSystem.moveAsync({ from: localThumbnailUri, to: finalThumbnailUri })
    }
  }

  if (!(await fileExists(finalUri))) {
    throw new Error('The retained reel source is no longer available.')
  }

  try {
    assertCurrentAuthContext(ownerId, generation)
  } catch (error) {
    await FileSystem.deleteAsync(finalUri, { idempotent: true }).catch(() => undefined)
    if (finalThumbnailUri) {
      await FileSystem.deleteAsync(finalThumbnailUri, { idempotent: true }).catch(() => undefined)
    }
    throw error
  }

  const now = Date.now()
  const record: LocalReelPlaybackRecord = {
    version: 1,
    reelId,
    ownerId,
    deviceId: await getDeviceId(),
    publishIntentId,
    localUri: finalUri,
    ...(finalThumbnailUri ? { localThumbnailUri: finalThumbnailUri } : {}),
    ...(edit ? { edit } : {}),
    ...(typeof sourceWidth === 'number' ? { sourceWidth } : {}),
    ...(typeof sourceHeight === 'number' ? { sourceHeight } : {}),
    createdAt: now,
    lastAccessedAt: now,
    expiresAt,
  }

  await saveRecord(record, generation)
  return record
}

export const getSyncAuthorizedLocalReelPlayback = (reelId: string, ownerId: string) => {
  const record = localRecordsByReelId.get(reelId)
  if (
    !record ||
    activeLocalPlaybackOwnerId !== ownerId ||
    record.ownerId !== ownerId ||
    record.deviceId !== cachedDeviceId
  ) {
    return null
  }

  return record.expiresAt > Date.now() ? record : null
}

export const resolveAuthorizedLocalReelPlayback = async (
  reel: Pick<Reel, 'id' | 'userId'>,
  ownerId: string,
) => {
  const generation = localPlaybackAuthGeneration
  if (!ownerId || reel.userId !== ownerId || !isCurrentAuthContext(ownerId, generation)) {
    return null
  }

  const record = await getStoredRecord(ownerId, reel.id)
  if (!record || !isCurrentAuthContext(ownerId, generation)) {
    return null
  }

  const deviceId = await getDeviceId()
  if (!isCurrentAuthContext(ownerId, generation)) {
    return null
  }

  if (
    record.ownerId !== ownerId ||
    record.deviceId !== deviceId ||
    record.expiresAt <= Date.now()
  ) {
    await removeStoredRecord(record)
    return null
  }

  if (!(await fileExists(record.localUri))) {
    if (!isCurrentAuthContext(ownerId, generation)) {
      return null
    }
    await removeStoredRecord(record)
    return null
  }

  return touchStoredRecord(ownerId, reel.id, Date.now(), generation)
}

export const releaseAuthorizedLocalReelPlayback = async (ownerId: string, reelId: string) => {
  const generation = localPlaybackAuthGeneration
  if (!isCurrentAuthContext(ownerId, generation)) {
    return
  }

  const record = await getStoredRecord(ownerId, reelId)
  if (!record || !isCurrentAuthContext(ownerId, generation)) {
    return
  }
  const deviceId = await getDeviceId()
  if (
    !isCurrentAuthContext(ownerId, generation) ||
    record.ownerId !== ownerId ||
    record.deviceId !== deviceId
  ) {
    return
  }

  await removeStoredRecord(record)
}

export const cleanupExpiredLocalReelPlayback = async (ownerId: string) => {
  const generation = localPlaybackAuthGeneration
  if (!ownerId || !isCurrentAuthContext(ownerId, generation)) {
    return
  }

  const deviceId = await getDeviceId()
  const expired: LocalReelPlaybackRecord[] = []
  await runSerialized(ownerId, async () => {
    assertCurrentAuthContext(ownerId, generation)
    const records = await readRecords(ownerId)
    const retained: LocalReelPlaybackRecord[] = []
    for (const record of records) {
      if (pinnedPlaybackKeys.has(playbackKey(ownerId, record.reelId))) {
        retained.push(record)
        cacheRecord(record)
        continue
      }

      if (
        record.ownerId !== ownerId ||
        record.deviceId !== deviceId ||
        record.expiresAt <= Date.now()
      ) {
        expired.push(record)
        continue
      }

      retained.push(record)
      cacheRecord(record)
    }
    await writeRecords(ownerId, retained)
  })
  if (!isCurrentAuthContext(ownerId, generation)) {
    return
  }
  await Promise.all(expired.map((record) => removeRecordFiles(record)))
  expired.forEach((record) => localRecordsByReelId.delete(record.reelId))
}

export const revokeLocalReelPlaybackForOwner = async (ownerId: string) => {
  if (!ownerId) {
    return
  }

  let records: LocalReelPlaybackRecord[] = []
  await runSerialized(ownerId, async () => {
    records = await readRecords(ownerId)
    await writeRecords(ownerId, [])
  })
  records.forEach((record) => pinnedPlaybackKeys.delete(playbackKey(ownerId, record.reelId)))
  await Promise.all(records.map((record) => removeRecordFiles(record)))
  records.forEach((record) => localRecordsByReelId.delete(record.reelId))
}
