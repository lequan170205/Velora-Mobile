import * as VideoThumbnails from 'expo-video-thumbnails'

import { stripHashtagsFromCaption } from './reels'

import type { StoredAsset, TimelineFrame } from '../types/reel-creator'

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const formatTrimClock = (timeMs: number) => {
  const safeSeconds = Math.max(0, Math.round(timeMs / 1000))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const buildDerivedTitle = (caption: string) => {
  const normalized = stripHashtagsFromCaption(caption).replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return 'Velora Reel'
  }

  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized
}

export const getComposerToken = (value: string) => {
  const match = value.match(/(^|\s)([#@][^\s#@]*)$/)
  return match ? match[2] : null
}

export const replaceComposerToken = (value: string, nextToken: string) => {
  const match = value.match(/(^|\s)([#@][^\s#@]*)$/)

  if (!match) {
    return `${value}${value.length > 0 && !value.endsWith(' ') ? ' ' : ''}${nextToken} `
  }

  const token = match[2]
  return `${value.slice(0, value.length - token.length)}${nextToken} `
}

export const getVideoDurationMs = (asset: StoredAsset | null, fallbackSeconds: number) => {
  if (asset?.duration && asset.duration > 0) {
    return asset.duration
  }

  return fallbackSeconds > 0 ? Math.round(fallbackSeconds * 1000) : 0
}

export const getOrientationMessage = (asset: StoredAsset | null) => {
  if (!asset?.width || !asset?.height) {
    return 'Optimized for 9:16 vertical video'
  }

  return asset.height >= asset.width
    ? 'Vertical framing looks ready'
    : 'This clip will be framed to 9:16'
}

export const getNearestFrame = (frames: TimelineFrame[], timeMs: number) => {
  if (frames.length === 0) {
    return null
  }

  return frames.reduce((closest, frame) =>
    Math.abs(frame.timeMs - timeMs) < Math.abs(closest.timeMs - timeMs) ? frame : closest,
  )
}

export const snapRatio = (ratio: number) => {
  const snapPoints = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]
  const nearestPoint = snapPoints.reduce((closest, point) =>
    Math.abs(point - ratio) < Math.abs(closest - ratio) ? point : closest,
  )

  return Math.abs(nearestPoint - ratio) < 0.02 ? nearestPoint : ratio
}

export async function buildTimelineFrames(asset: StoredAsset): Promise<TimelineFrame[]> {
  const durationMs = Math.max(asset.duration ?? 0, 0)
  const thumbnailTimes =
    durationMs > 0
      ? Array.from(new Set([0, 0.25, 0.5, 0.75].map((ratio) => Math.floor(durationMs * ratio))))
      : [0]

  const results = await Promise.allSettled(
    thumbnailTimes.map(async (timeMs) => {
      const thumbnail = await VideoThumbnails.getThumbnailAsync(asset.uri, {
        quality: 0.3,
        time: timeMs,
      })

      return {
        uri: thumbnail.uri,
        timeMs,
      }
    }),
  )

  return results
    .filter(
      (result): result is PromiseFulfilledResult<TimelineFrame> => result.status === 'fulfilled',
    )
    .map((result) => result.value)
}
