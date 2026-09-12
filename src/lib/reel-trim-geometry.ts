import type { ReelTrim } from '../types/reel-creator'

export const MIN_TRIM_DURATION_MS = 1000
export const FULL_RANGE_TRIM_TOLERANCE_MS = 50

export type TrimRange = {
  startMs: number
  endMs: number
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const getSafeDuration = (sourceDurationMs?: number | null) =>
  isFiniteNumber(sourceDurationMs) && sourceDurationMs > 0 ? Math.round(sourceDurationMs) : null

export const getTrimDurationMs = (
  trim: ReelTrim | null | undefined,
  sourceDurationMs?: number | null,
) => {
  if (trim && isFiniteNumber(trim.startMs) && isFiniteNumber(trim.endMs)) {
    return Math.max(0, trim.endMs - trim.startMs)
  }

  return Math.max(0, getSafeDuration(sourceDurationMs) ?? 0)
}

export const isFullRangeTrim = (
  trim: ReelTrim | null | undefined,
  sourceDurationMs?: number | null,
) => {
  const durationMs = getSafeDuration(sourceDurationMs)

  return Boolean(
    trim &&
    durationMs !== null &&
    Math.abs(trim.startMs) <= FULL_RANGE_TRIM_TOLERANCE_MS &&
    Math.abs(trim.endMs - durationMs) <= FULL_RANGE_TRIM_TOLERANCE_MS,
  )
}

export const sanitizeTrim = (value: unknown, sourceDurationMs?: number | null): ReelTrim | null => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isFiniteNumber(value.startMs) ||
    !isFiniteNumber(value.endMs)
  ) {
    return null
  }

  const durationMs = getSafeDuration(sourceDurationMs)
  const startMs = Math.max(0, Math.round(value.startMs))
  const unclampedEndMs = Math.max(0, Math.round(value.endMs))
  const endMs = durationMs === null ? unclampedEndMs : Math.min(durationMs, unclampedEndMs)

  if (endMs - startMs < MIN_TRIM_DURATION_MS) {
    return null
  }

  const trim: ReelTrim = { version: 1, startMs, endMs }
  return isFullRangeTrim(trim, durationMs) ? null : trim
}

export const isValidTrim = (
  value: unknown,
  sourceDurationMs?: number | null,
): value is ReelTrim => {
  if (!isRecord(value) || value.version !== 1) {
    return false
  }

  const sanitized = sanitizeTrim(value, sourceDurationMs)
  return (
    sanitized !== null && sanitized.startMs === value.startMs && sanitized.endMs === value.endMs
  )
}

export const clampTrimRange = (
  startMs: number,
  endMs: number,
  sourceDurationMs: number,
): TrimRange => {
  const durationMs = getSafeDuration(sourceDurationMs) ?? 0

  if (durationMs <= 0) {
    return { startMs: 0, endMs: 0 }
  }

  if (durationMs < MIN_TRIM_DURATION_MS) {
    return { startMs: 0, endMs: durationMs }
  }

  const safeStartMs = clamp(
    isFiniteNumber(startMs) ? startMs : 0,
    0,
    durationMs - MIN_TRIM_DURATION_MS,
  )
  const safeEndMs = clamp(
    isFiniteNumber(endMs) ? endMs : durationMs,
    safeStartMs + MIN_TRIM_DURATION_MS,
    durationMs,
  )

  return {
    startMs: Math.round(safeStartMs),
    endMs: Math.round(safeEndMs),
  }
}

export const getTrimRange = (
  trim: ReelTrim | null | undefined,
  sourceDurationMs: number,
): TrimRange => {
  const durationMs = getSafeDuration(sourceDurationMs) ?? 0

  return trim
    ? clampTrimRange(trim.startMs, trim.endMs, durationMs)
    : { startMs: 0, endMs: durationMs }
}

export const getTrimPlaybackSeekTarget = (
  trim: ReelTrim | null | undefined,
  currentTimeSeconds: number,
  durationSeconds: number,
  endToleranceSeconds = 0.12,
) => {
  if (
    !trim ||
    !isFiniteNumber(trim.startMs) ||
    !isFiniteNumber(trim.endMs) ||
    !isFiniteNumber(currentTimeSeconds) ||
    !isFiniteNumber(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return null
  }

  const startSeconds = Math.max(0, trim.startMs / 1000)
  const effectiveEndSeconds = Math.min(Math.max(startSeconds, trim.endMs / 1000), durationSeconds)

  if (
    effectiveEndSeconds - startSeconds < MIN_TRIM_DURATION_MS / 1000 ||
    currentTimeSeconds < effectiveEndSeconds - endToleranceSeconds
  ) {
    return null
  }

  return startSeconds
}

export const timeMsToTimelineX = (
  timeMs: number,
  sourceDurationMs: number,
  timelineWidth: number,
) => {
  if (sourceDurationMs <= 0 || timelineWidth <= 0) {
    return 0
  }

  return (clamp(timeMs, 0, sourceDurationMs) / sourceDurationMs) * timelineWidth
}

export const timelineXToTimeMs = (x: number, sourceDurationMs: number, timelineWidth: number) => {
  if (sourceDurationMs <= 0 || timelineWidth <= 0) {
    return 0
  }

  return Math.round((clamp(x, 0, timelineWidth) / timelineWidth) * sourceDurationMs)
}

export const formatTrimTime = (timeMs: number) => {
  const safeMs = Math.max(0, Math.round(timeMs))
  const minutes = Math.floor(safeMs / 60_000)
  const seconds = Math.floor((safeMs % 60_000) / 1000)
  const tenths = Math.floor((safeMs % 1000) / 100)

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`
}

export const formatTrimDurationLabel = (durationMs: number) => {
  const safeMs = Math.max(0, Math.round(durationMs))

  if (safeMs >= 60_000) {
    return formatTrimTime(safeMs).replace(/\.0$/, '')
  }

  return `${(safeMs / 1000).toFixed(1).replace(/\.0$/, '')}s`
}
