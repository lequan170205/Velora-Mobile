import { Image } from 'expo-image'
import React, { useState } from 'react'

import { useReelDetail } from '../../hooks/useReels'

import { getReelThumbnailCacheKey } from './ChatReelCard'

/**
 * Thumbnail for a replied-to reel. The URL stored on the message is signed and can expire, so a
 * failed load falls back to the reel's current thumbnail (usually already cached by the reel card)
 * instead of leaving a black tile. Renders nothing when no image is usable.
 */
export function ReplyReelThumbnail({
  height,
  reelId,
  thumbnailKey,
  uri,
  width,
}: {
  height: number
  reelId?: string | undefined
  thumbnailKey?: string | undefined
  uri: string
  width: number
}) {
  const normalizedReelId = reelId?.trim() || null
  const [failedUris, setFailedUris] = useState<string[]>([])
  const { data: reelDetail } = useReelDetail(normalizedReelId ?? undefined, {
    enabled: Boolean(normalizedReelId) && failedUris.includes(uri),
  })
  const thumbnail =
    [
      { uri, key: thumbnailKey },
      { uri: reelDetail?.thumbnailUrl, key: reelDetail?.thumbnailKey },
    ].find(
      (candidate): candidate is { uri: string; key: string | undefined } =>
        Boolean(candidate.uri) && !failedUris.includes(candidate.uri ?? ''),
    ) ?? null

  if (!thumbnail) {
    return null
  }

  return (
    <Image
      source={{
        uri: thumbnail.uri,
        cacheKey: getReelThumbnailCacheKey(normalizedReelId, thumbnail.key, thumbnail.uri),
      }}
      cachePolicy="memory-disk"
      contentFit="cover"
      onError={() => {
        const failedUri = thumbnail.uri
        setFailedUris((current) =>
          current.includes(failedUri) ? current : [...current, failedUri],
        )
      }}
      style={{ width, height }}
    />
  )
}
