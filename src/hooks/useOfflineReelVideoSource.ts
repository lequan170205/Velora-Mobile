import { useEffect, useMemo, useState } from 'react'

import {
  getSyncAuthorizedLocalReelPlayback,
  resolveAuthorizedLocalReelPlayback,
} from '../lib/localReelPlayback'
import {
  cacheTemporaryReelVideo,
  getCachedTemporaryReelVideo,
  getSyncCachedTemporaryReelVideo,
  getTemporaryReelVideoCacheStatus,
  isHlsReelUrl,
  subscribeTemporaryReelVideoCacheStatus,
} from '../lib/offlineReelVideoCache'
import { getReelPlaybackAvailability, isRemoteReelPlaybackReady } from '../lib/reelProcessing'
import { useNetworkStatus } from '../providers/NetworkProvider'
import { useAuthStore } from '../stores/authStore'

import type {
  TemporaryReelVideoCacheRecord,
  TemporaryReelVideoCacheStatus,
} from '../lib/offlineReelVideoCache'
import type { Reel } from '../types/reel.types'

interface UseOfflineReelVideoSourceOptions {
  enabled?: boolean
  preferOffline?: boolean
  cachePriority?: number
  shouldPrepareOfflineVideo?: boolean
}

export function useOfflineReelVideoSource(
  reel: Pick<
    Reel,
    | 'id'
    | 'userId'
    | 'streamUrl'
    | 'thumbnailUrl'
    | 'localThumbnailUri'
    | 'status'
    | 'mediaStatus'
    | 'hlsMasterUrl'
    | 'hlsMasterKey'
  >,
  options: UseOfflineReelVideoSourceOptions = {},
) {
  const { isOnline } = useNetworkStatus()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const viewerId = useAuthStore((state) => state.user?.id ?? '')
  const [offlineRecord, setOfflineRecord] = useState<TemporaryReelVideoCacheRecord | null>(() =>
    reel.id ? getSyncCachedTemporaryReelVideo(reel.id) : null,
  )
  const [localRecord, setLocalRecord] = useState(() =>
    reel.id && viewerId === reel.userId
      ? getSyncAuthorizedLocalReelPlayback(reel.id, viewerId)
      : null,
  )
  const [cacheStatus, setCacheStatus] = useState<TemporaryReelVideoCacheStatus>(() =>
    offlineRecord ? 'CACHED' : 'NOT_CACHED',
  )

  const shouldPrepareOfflineVideo =
    (options.enabled ?? true) &&
    (options.shouldPrepareOfflineVideo ?? true) &&
    reel.status === 'COMPLETED' &&
    isRemoteReelPlaybackReady(reel as Reel) &&
    isHlsReelUrl(reel.streamUrl)

  const isRemotePlaybackReady = isRemoteReelPlaybackReady(reel as Reel)
  const canUseLocalPlayback = Boolean(
    isAuthenticated && reel.id && viewerId && reel.userId === viewerId,
  )
  const authorizedLocalRecord =
    canUseLocalPlayback && localRecord?.reelId === reel.id && localRecord.ownerId === viewerId
      ? getSyncAuthorizedLocalReelPlayback(reel.id, viewerId)
      : null
  const shouldUseLocalVideo =
    Boolean(authorizedLocalRecord) && (!isRemotePlaybackReady || !isOnline)

  useEffect(() => {
    if (!reel.id) {
      return undefined
    }

    return subscribeTemporaryReelVideoCacheStatus(reel.id, setCacheStatus)
  }, [reel.id])

  useEffect(() => {
    let isMounted = true
    const syncRecord = canUseLocalPlayback
      ? getSyncAuthorizedLocalReelPlayback(reel.id, viewerId)
      : null

    setLocalRecord(syncRecord)

    if (!canUseLocalPlayback) {
      return () => {
        isMounted = false
      }
    }

    void resolveAuthorizedLocalReelPlayback({ id: reel.id, userId: reel.userId }, viewerId).then(
      (record) => {
        if (isMounted) {
          setLocalRecord(record)
        }
      },
    )

    return () => {
      isMounted = false
    }
  }, [reel.id, reel.userId, viewerId, canUseLocalPlayback])

  useEffect(() => {
    let isMounted = true

    const syncRecord = reel.id ? getSyncCachedTemporaryReelVideo(reel.id) : null
    setOfflineRecord(syncRecord)
    if (syncRecord) {
      setCacheStatus('CACHED')
    }

    if (!reel.id) {
      return () => {
        isMounted = false
      }
    }

    void getCachedTemporaryReelVideo(reel.id).then((record) => {
      if (isMounted && record) {
        setOfflineRecord(record)
      }
    })

    void getTemporaryReelVideoCacheStatus(reel.id).then((status) => {
      if (isMounted) {
        setCacheStatus(status)
      }
    })

    return () => {
      isMounted = false
    }
  }, [reel.id])

  useEffect(() => {
    let isMounted = true

    if (!isOnline || !shouldPrepareOfflineVideo) {
      return () => {
        isMounted = false
      }
    }

    const cacheInput = {
      id: reel.id,
      streamUrl: reel.streamUrl,
      ...(reel.thumbnailUrl ? { thumbnailUrl: reel.thumbnailUrl } : {}),
    }

    void cacheTemporaryReelVideo(cacheInput, {
      priority: options.cachePriority ?? 50,
    }).then((record) => {
      if (isMounted && record) {
        setOfflineRecord(record)
      }
    })

    return () => {
      isMounted = false
    }
  }, [
    isOnline,
    options.cachePriority,
    reel.id,
    reel.streamUrl,
    reel.thumbnailUrl,
    shouldPrepareOfflineVideo,
  ])

  return useMemo(() => {
    const shouldUseOfflineVideo =
      isRemotePlaybackReady &&
      Boolean(offlineRecord) &&
      (!isOnline || options.preferOffline !== false)
    const shouldUseOfflineVideoSource = !shouldUseLocalVideo && shouldUseOfflineVideo

    const uri =
      shouldUseLocalVideo && authorizedLocalRecord
        ? authorizedLocalRecord.localUri
        : shouldUseOfflineVideoSource && offlineRecord
          ? offlineRecord.localManifestUri
          : isOnline && isRemotePlaybackReady
            ? reel.hlsMasterUrl || reel.streamUrl
            : ''

    const posterUri =
      shouldUseLocalVideo && authorizedLocalRecord?.localThumbnailUri
        ? authorizedLocalRecord.localThumbnailUri
        : shouldUseOfflineVideoSource && offlineRecord?.localThumbnailUri
          ? offlineRecord.localThumbnailUri
          : reel.thumbnailUrl || reel.localThumbnailUri || offlineRecord?.localThumbnailUri

    const isDownloadingOfflineVideo = cacheStatus === 'QUEUED' || cacheStatus === 'DOWNLOADING'

    return {
      uri,
      posterUri,
      isOnline,
      cacheStatus,
      authSessionKey: `${isAuthenticated ? 'authenticated' : 'anonymous'}:${viewerId || 'none'}`,
      isLocalVideoReady: Boolean(authorizedLocalRecord),
      isLocalVideoActive: shouldUseLocalVideo,
      localVideoUri: authorizedLocalRecord?.localUri ?? null,
      localThumbnailUri: authorizedLocalRecord?.localThumbnailUri ?? null,
      localEdit: authorizedLocalRecord?.edit,
      localSourceWidth: authorizedLocalRecord?.sourceWidth,
      localSourceHeight: authorizedLocalRecord?.sourceHeight,
      isRemotePlaybackReady,
      playbackAvailability: getReelPlaybackAvailability(reel as Reel, shouldUseLocalVideo),
      isOfflineVideoReady: Boolean(offlineRecord),
      isOfflineVideoActive: shouldUseOfflineVideoSource,
      isOfflineVideoUnavailable: !isOnline && !offlineRecord && !authorizedLocalRecord,
      isDownloadingOfflineVideo,
    }
  }, [
    cacheStatus,
    isOnline,
    isRemotePlaybackReady,
    authorizedLocalRecord,
    offlineRecord,
    options.preferOffline,
    reel,
    shouldUseLocalVideo,
    viewerId,
    isAuthenticated,
  ])
}
