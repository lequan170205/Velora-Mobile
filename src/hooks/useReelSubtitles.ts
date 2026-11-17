import { type QueryClient, useQuery } from '@tanstack/react-query'

import { reelsApi } from '../api/reels.api'
import { queryKeys } from '../constants/queryKeys'
import { normalizeSubtitleCues } from '../lib/reelSubtitles'
import { useAuthStore } from '../stores/authStore'

import type { ReelCaptionLanguage } from '../lib/reelPlaybackPreferences'
import type { ReelSubtitleCue } from '../types/reel.types'

// A translation is stored on the server, so it only changes when the reel's transcript is rebuilt.
const SUBTITLES_STALE_TIME_MS = 60 * 60 * 1000

const getSubtitlesQueryOptions = (
  viewerId: string,
  reelId: string | undefined,
  language: ReelCaptionLanguage,
) => {
  const translated = language === 'original' ? null : language

  return {
    queryKey: queryKeys.reels.subtitles(viewerId, reelId || 'unknown', language),
    queryFn: async (): Promise<ReelSubtitleCue[]> => {
      if (!reelId || !translated) {
        throw new Error('Missing reel or caption language')
      }

      const subtitles = await reelsApi.getSubtitles(reelId, translated)
      return normalizeSubtitleCues(subtitles.cues)
    },
    staleTime: SUBTITLES_STALE_TIME_MS,
    // A first translation can take up to two minutes, so a silent retry would double the wait; the sheet offers Retry.
    retry: false,
  }
}

/**
 * Warms the translated captions for a reel the viewer is about to reach. The backend translates a reel when it
 * finishes processing, so this is normally a quick read; errors are ignored and surface only when the reel is shown.
 */
export const prefetchReelSubtitles = (
  queryClient: QueryClient,
  viewerId: string,
  reelId: string,
  language: ReelCaptionLanguage,
) => {
  if (language === 'original') {
    return Promise.resolve()
  }

  return queryClient.prefetchQuery(getSubtitlesQueryOptions(viewerId, reelId, language))
}

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

  return useQuery({
    ...getSubtitlesQueryOptions(viewerId, reelId, language),
    enabled: Boolean(reelId) && language !== 'original' && (options.enabled ?? true),
  })
}
