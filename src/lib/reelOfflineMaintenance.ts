import {
  cleanupTemporaryReelVideoCache,
  setTemporaryReelVideoCacheDownloadsEnabled,
} from './offlineReelVideoCache'
import { getReelCachePolicy } from './reelCachePolicy'
import { flushQueuedReelEvents } from './reelEventsOutbox'
import { pruneCachedReelOfflineMetadata } from './reelOfflineCache'

const getCleanupOptions = async () => {
  const policy = await getReelCachePolicy()

  return typeof policy.maxVideoCacheBytes === 'number'
    ? { maxBytes: policy.maxVideoCacheBytes }
    : {}
}

export const runReelOfflineStartupMaintenance = async () => {
  setTemporaryReelVideoCacheDownloadsEnabled(true)

  const cleanupOptions = await getCleanupOptions()
  await cleanupTemporaryReelVideoCache(cleanupOptions)
  await pruneCachedReelOfflineMetadata()
  await flushQueuedReelEvents()
}

export const runReelOfflineAppActiveMaintenance = async () => {
  setTemporaryReelVideoCacheDownloadsEnabled(true)

  const cleanupOptions = await getCleanupOptions()
  await flushQueuedReelEvents()
  await cleanupTemporaryReelVideoCache(cleanupOptions)
}

export const runReelOfflineBackgroundMaintenance = async () => {
  setTemporaryReelVideoCacheDownloadsEnabled(false)
  await flushQueuedReelEvents()
}
