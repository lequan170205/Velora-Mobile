import type { ReelSubtitleCue } from '../types/reel.types'

// A line stays up through short pauses so it does not flicker, but never into the next line.
const SUBTITLE_LINGER_SECONDS = 0.25

export const normalizeSubtitleCues = (raw: unknown): ReelSubtitleCue[] => {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((item): ReelSubtitleCue | null => {
      if (!item || typeof item !== 'object') return null
      const cue = item as Record<string, unknown>
      if (
        typeof cue.text !== 'string' ||
        !cue.text.trim() ||
        typeof cue.start !== 'number' ||
        typeof cue.end !== 'number' ||
        !Number.isFinite(cue.start) ||
        !Number.isFinite(cue.end)
      ) {
        return null
      }

      return {
        index: typeof cue.index === 'number' ? cue.index : 0,
        start: cue.start,
        end: cue.end,
        text: cue.text.trim(),
      }
    })
    .filter((cue): cue is ReelSubtitleCue => cue !== null)
    .sort((a, b) => a.start - b.start)
}

/** The line to show at `position` seconds, or '' between lines. Cues are sorted by start time. */
export const getActiveSubtitleText = (
  cues: readonly ReelSubtitleCue[] | undefined,
  position: number,
): string => {
  if (!cues || cues.length === 0 || !Number.isFinite(position)) {
    return ''
  }

  let low = 0
  let high = cues.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (cues[middle].start <= position) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  if (found < 0) {
    return ''
  }

  const cue = cues[found]
  const nextStart = cues[found + 1]?.start ?? Infinity
  const hideAt = Math.min(cue.end + SUBTITLE_LINGER_SECONDS, nextStart)

  return position < hideAt ? cue.text : ''
}
