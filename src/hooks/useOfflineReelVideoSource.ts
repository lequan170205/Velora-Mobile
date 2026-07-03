import { useEffect, useMemo, useState } from 'react'

import {
  cacheTemporaryReelVideo,
  getCachedTemporaryReelVideo,
  getTemporaryReelVideoCacheStatus,
  subscribeTemporaryReelVideoCacheStatus,
} from '../lib/offlineReelVideoCache'
import { useNetworkStatus } from '../providers/NetworkProvider'

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
  reel: Pick<Reel, 'id' | 'streamUrl' | 'thumbnailUrl' | 'localThumbnailUri' | 'status'>,
  options: UseOfflineReelVideoSourceOptions = {},
) {
  const { isOnline } = useNetworkStatus()
  const [offlineRecord, setOfflineRecord] = useState<TemporaryReelVideoCacheRecord | null>(null)
  const [cacheStatus, setCacheStatus] = useState<TemporaryReelVideoCacheStatus>('NOT_CACHED')

  const shouldPrepareOfflineVideo =
    (options.enabled ?? true) &&
    (options.shouldPrepareOfflineVideo ?? true) &&
    reel.status === 'COMPLETED' &&
    Boolean(reel.streamUrl)

  useEffect(() => {
    if (!reel.id) {
      return undefined
    }

    return subscribeTemporaryReelVideoCacheStatus(reel.id, setCacheStatus)
  }, [reel.id])

  useEffect(() => {
    let isMounted = true

    setOfflineRecord(null)

    if (!reel.id) {
      return () => {
        isMounted = false
      }
    }

    void getCachedTemporaryReelVideo(reel.id).then((record) => {
      if (isMounted) {
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
    const shouldUseOfflineVideo = Boolean(offlineRecord) && (!isOnline || options.preferOffline)

    const uri =
      shouldUseOfflineVideo && offlineRecord
        ? offlineRecord.localManifestUri
        : isOnline
          ? reel.streamUrl
          : ''

    const posterUri =
      shouldUseOfflineVideo && offlineRecord?.localThumbnailUri
        ? offlineRecord.localThumbnailUri
        : reel.thumbnailUrl || reel.localThumbnailUri || offlineRecord?.localThumbnailUri

    const isDownloadingOfflineVideo = cacheStatus === 'QUEUED' || cacheStatus === 'DOWNLOADING'

    return {
      uri,
      posterUri,
      isOnline,
      cacheStatus,
      isOfflineVideoReady: Boolean(offlineRecord),
      isOfflineVideoActive: shouldUseOfflineVideo,
      isOfflineVideoUnavailable: !isOnline && !offlineRecord,
      isDownloadingOfflineVideo,
    }
  }, [
    cacheStatus,
    isOnline,
    offlineRecord,
    options.preferOffline,
    reel.localThumbnailUri,
    reel.streamUrl,
    reel.thumbnailUrl,
  ])
}
