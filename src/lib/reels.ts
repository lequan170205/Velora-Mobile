import type { AllowedVideoType } from '../types/reel.types'

const HASHTAG_BODY_REGEX = '[A-Za-z0-9_]+'
const HASHTAG_MATCH_REGEX = new RegExp(`(^|[^A-Za-z0-9_])#(${HASHTAG_BODY_REGEX})`, 'g')

export interface CaptionSegment {
  text: string
  isHashtag: boolean
}

const extensionToMimeType: Record<string, AllowedVideoType> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
}

export const resolveAllowedVideoType = (
  mimeType?: string | null,
  fileNameOrUri?: string | null,
): AllowedVideoType | null => {
  if (mimeType === 'video/mp4' || mimeType === 'video/webm' || mimeType === 'video/quicktime') {
    return mimeType
  }

  if (!fileNameOrUri) {
    return null
  }

  const normalizedPath = fileNameOrUri.split('?')[0]?.toLowerCase() ?? ''
  const extension = normalizedPath.split('.').pop()

  if (!extension) {
    return null
  }

  return extensionToMimeType[extension] ?? null
}

export const getCaptionSegments = (value: string): CaptionSegment[] => {
  if (!value) {
    return []
  }

  const segments: CaptionSegment[] = []
  let cursor = 0

  for (const match of value.matchAll(HASHTAG_MATCH_REGEX)) {
    const boundary = match[1] ?? ''
    const hashtagBody = match[2] ?? ''
    const matchStart = match.index ?? 0
    const hashtagStart = matchStart + boundary.length
    const hashtagEnd = hashtagStart + hashtagBody.length + 1

    if (hashtagStart > cursor) {
      segments.push({
        text: value.slice(cursor, hashtagStart),
        isHashtag: false,
      })
    }

    segments.push({
      text: value.slice(hashtagStart, hashtagEnd),
      isHashtag: true,
    })

    cursor = hashtagEnd
  }

  if (cursor < value.length) {
    segments.push({
      text: value.slice(cursor),
      isHashtag: false,
    })
  }

  return segments
}

export const extractHashtags = (value: string) => {
  const segments = getCaptionSegments(value)

  return Array.from(
    new Set(
      segments
        .filter((segment) => segment.isHashtag)
        .map((segment) => segment.text.replace(/^#/, '').trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

export const formatViewCount = (count: number) => {
  if (count < 1000) {
    return `${count}`
  }

  if (count < 1000000) {
    const value = count >= 10000 ? (count / 1000).toFixed(0) : (count / 1000).toFixed(1)
    return `${value.replace(/\.0$/, '')}K`
  }

  const value = count >= 10000000 ? (count / 1000000).toFixed(0) : (count / 1000000).toFixed(1)
  return `${value.replace(/\.0$/, '')}M`
}

export const formatDurationLabel = (durationMs?: number | null) => {
  if (!durationMs || durationMs <= 0) {
    return null
  }

  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
