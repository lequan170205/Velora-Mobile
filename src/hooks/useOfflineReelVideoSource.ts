import { useEffect, useMemo, useState } from 'react'

import { cacheOfflineReelVideo, getCachedOfflineReelVideo } from '../lib/offlineReelVideoCache'

import { useIsOnline } from './useIsOnline'

import type { OfflineReelVideoRecord } from '../lib/offlineReelVideoCache'
import type { Reel } from '../types/reel.types'

interface UseOfflineReelVideoSourceOptions {
  enabled?: boolean
  preferOffline?: boolean
}

export function useOfflineReelVideoSource(
  reel: Pick<Reel, 'id' | 'streamUrl' | 'thumbnailUrl' | 'localThumbnailUri' | 'status'>,
  options: UseOfflineReelVideoSourceOptions = {},
) {
  const isOnline = useIsOnline()
  const [offlineRecord, setOfflineRecord] = useState<OfflineReelVideoRecord | null>(null)
  const [isDownloadingOfflineVideo, setIsDownloadingOfflineVideo] = useState(false)

  const shouldPrepareOfflineVideo =
    (options.enabled ?? true) && reel.status === 'COMPLETED' && Boolean(reel.streamUrl)

  useEffect(() => {
    let isMounted = true

    setOfflineRecord(null)

    if (!reel.id) {
      return () => {
        isMounted = false
      }
    }

    void getCachedOfflineReelVideo(reel.id).then((record) => {
      if (isMounted) {
        setOfflineRecord(record)
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

    setIsDownloadingOfflineVideo(true)

    const cacheInput = {
      id: reel.id,
      streamUrl: reel.streamUrl,
      ...(reel.thumbnailUrl ? { thumbnailUrl: reel.thumbnailUrl } : {}),
    }

    void cacheOfflineReelVideo(cacheInput)
      .then((record) => {
        if (isMounted && record) {
          setOfflineRecord(record)
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsDownloadingOfflineVideo(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [isOnline, reel.id, reel.streamUrl, reel.thumbnailUrl, shouldPrepareOfflineVideo])

  return useMemo(() => {
    const shouldUseOfflineVideo = Boolean(offlineRecord) && (!isOnline || options.preferOffline)

    const uri =
      shouldUseOfflineVideo && offlineRecord ? offlineRecord.localManifestUri : reel.streamUrl

    const posterUri =
      shouldUseOfflineVideo && offlineRecord?.localThumbnailUri
        ? offlineRecord.localThumbnailUri
        : reel.thumbnailUrl || reel.localThumbnailUri || offlineRecord?.localThumbnailUri

    return {
      uri,
      posterUri,
      isOnline,
      isOfflineVideoReady: Boolean(offlineRecord),
      isOfflineVideoActive: shouldUseOfflineVideo,
      isOfflineVideoUnavailable: !isOnline && !offlineRecord,
      isDownloadingOfflineVideo,
    }
  }, [
    isDownloadingOfflineVideo,
    isOnline,
    offlineRecord,
    options.preferOffline,
    reel.localThumbnailUri,
    reel.streamUrl,
    reel.thumbnailUrl,
  ])
}
