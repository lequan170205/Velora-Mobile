import { useQuery } from '@tanstack/react-query'

import { reelsApi } from '../api/reels.api'
import { queryKeys } from '../constants/queryKeys'
import { normalizeSubtitleCues } from '../lib/reelSubtitles'
import { useAuthStore } from '../stores/authStore'

import type { ReelCaptionLanguage } from '../lib/reelPlaybackPreferences'
import type { ReelSubtitleCue } from '../types/reel.types'

// A translation is stored on the server, so it only changes when the reel's transcript is rebuilt.
const SUBTITLES_STALE_TIME_MS = 60 * 60 * 1000

/**
 * Translated captions for one reel. Nothing is requested for the spoken language ("original"), which keeps using the
 * timed transcript that is already part of the reel detail.
 */
export function useReelSubtitles(
  reelId: string | undefined,
  language: ReelCaptionLanguage,
  options: { enabled?: boolean } = {},
) {
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous')
  const translated = language === 'original' ? null : language

  return useQuery({
    queryKey: queryKeys.reels.subtitles(viewerId, reelId || 'unknown', language),
    queryFn: async (): Promise<ReelSubtitleCue[]> => {
      if (!reelId || !translated) {
        throw new Error('Missing reel or caption language')
      }

      const subtitles = await reelsApi.getSubtitles(reelId, translated)
      return normalizeSubtitleCues(subtitles.cues)
    },
    enabled: Boolean(reelId) && translated !== null && (options.enabled ?? true),
    staleTime: SUBTITLES_STALE_TIME_MS,
    retry: 1,
  })
}
