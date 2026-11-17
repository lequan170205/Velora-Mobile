import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_LIVE_TRANSCRIPTION_ENABLED,
  DEFAULT_REEL_CAPTION_LANGUAGE,
  DEFAULT_REEL_PLAYBACK_SPEED,
  getLiveTranscriptionPreference,
  getReelCaptionLanguagePreference,
  getReelPlaybackSpeedPreference,
  type ReelCaptionLanguage,
  type ReelPlaybackSpeed,
  setLiveTranscriptionPreference,
  setReelCaptionLanguagePreference,
  setReelPlaybackSpeedPreference,
} from '../lib/reelPlaybackPreferences'

interface ReelPlaybackPreferencesState {
  liveTranscriptionEnabled: boolean
  playbackSpeed: ReelPlaybackSpeed
  captionLanguage: ReelCaptionLanguage
  isReelPlaybackPreferencesHydrated: boolean
}

const listeners = new Set<(state: ReelPlaybackPreferencesState) => void>()

let stateVersion = 0
let hydrationPromise: Promise<void> | null = null
let currentState: ReelPlaybackPreferencesState = {
  liveTranscriptionEnabled: DEFAULT_LIVE_TRANSCRIPTION_ENABLED,
  playbackSpeed: DEFAULT_REEL_PLAYBACK_SPEED,
  captionLanguage: DEFAULT_REEL_CAPTION_LANGUAGE,
  isReelPlaybackPreferencesHydrated: false,
}

const emitState = () => {
  listeners.forEach((listener) => {
    listener(currentState)
  })
}

const updateState = (nextState: ReelPlaybackPreferencesState) => {
  if (
    currentState.liveTranscriptionEnabled === nextState.liveTranscriptionEnabled &&
    currentState.playbackSpeed === nextState.playbackSpeed &&
    currentState.captionLanguage === nextState.captionLanguage &&
    currentState.isReelPlaybackPreferencesHydrated === nextState.isReelPlaybackPreferencesHydrated
  ) {
    return
  }

  currentState = nextState
  emitState()
}

const ensureReelPlaybackPreferencesHydrated = async () => {
  if (currentState.isReelPlaybackPreferencesHydrated) {
    return
  }

  if (hydrationPromise) {
    await hydrationPromise
    return
  }

  const hydrationVersion = stateVersion

  hydrationPromise = Promise.all([
    getLiveTranscriptionPreference(),
    getReelPlaybackSpeedPreference(),
    getReelCaptionLanguagePreference(),
  ])
    .then(([liveTranscriptionEnabled, playbackSpeed, captionLanguage]) => {
      if (hydrationVersion !== stateVersion && currentState.isReelPlaybackPreferencesHydrated) {
        return
      }

      updateState({
        liveTranscriptionEnabled,
        playbackSpeed,
        captionLanguage,
        isReelPlaybackPreferencesHydrated: true,
      })
    })
    .catch(() => {
      if (hydrationVersion !== stateVersion && currentState.isReelPlaybackPreferencesHydrated) {
        return
      }

      updateState({
        ...currentState,
        isReelPlaybackPreferencesHydrated: true,
      })
    })
    .finally(() => {
      hydrationPromise = null
    })

  await hydrationPromise
}

const setLiveTranscriptionEnabledState = async (liveTranscriptionEnabled: boolean) => {
  stateVersion += 1

  updateState({
    ...currentState,
    liveTranscriptionEnabled,
    isReelPlaybackPreferencesHydrated: true,
  })

  try {
    await setLiveTranscriptionPreference(liveTranscriptionEnabled)
  } catch (error) {
    console.warn('[Reels] Failed to persist live transcription preference', error)
  }
}

const setPlaybackSpeedState = async (playbackSpeed: ReelPlaybackSpeed) => {
  stateVersion += 1

  updateState({
    ...currentState,
    playbackSpeed,
    isReelPlaybackPreferencesHydrated: true,
  })

  try {
    await setReelPlaybackSpeedPreference(playbackSpeed)
  } catch (error) {
    console.warn('[Reels] Failed to persist playback speed preference', error)
  }
}

const setCaptionLanguageState = async (captionLanguage: ReelCaptionLanguage) => {
  stateVersion += 1

  updateState({
    ...currentState,
    captionLanguage,
    isReelPlaybackPreferencesHydrated: true,
  })

  try {
    await setReelCaptionLanguagePreference(captionLanguage)
  } catch (error) {
    console.warn('[Reels] Failed to persist caption language preference', error)
  }
}

export function useReelPlaybackPreferences() {
  const [state, setState] = useState(currentState)

  useEffect(() => {
    listeners.add(setState)
    void ensureReelPlaybackPreferencesHydrated()

    return () => {
      listeners.delete(setState)
    }
  }, [])

  const setLiveTranscriptionEnabled = useCallback((liveTranscriptionEnabled: boolean) => {
    void setLiveTranscriptionEnabledState(liveTranscriptionEnabled)
  }, [])

  const setPlaybackSpeed = useCallback((playbackSpeed: ReelPlaybackSpeed) => {
    void setPlaybackSpeedState(playbackSpeed)
  }, [])

  const setCaptionLanguage = useCallback((captionLanguage: ReelCaptionLanguage) => {
    void setCaptionLanguageState(captionLanguage)
  }, [])

  return {
    liveTranscriptionEnabled: state.liveTranscriptionEnabled,
    playbackSpeed: state.playbackSpeed,
    captionLanguage: state.captionLanguage,
    isReelPlaybackPreferencesHydrated: state.isReelPlaybackPreferencesHydrated,
    setLiveTranscriptionEnabled,
    setPlaybackSpeed,
    setCaptionLanguage,
  }
}
