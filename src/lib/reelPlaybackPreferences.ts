import AsyncStorage from '@react-native-async-storage/async-storage'

const LIVE_TRANSCRIPTION_ENABLED_KEY = 'reel-live-transcription-enabled'
const PLAYBACK_SPEED_KEY = 'reel-playback-speed'
const CAPTION_LANGUAGE_KEY = 'reel-caption-language'

export const DEFAULT_LIVE_TRANSCRIPTION_ENABLED = true
export const SUPPORTED_REEL_PLAYBACK_SPEEDS = [0.5, 1, 1.5, 2] as const
export type ReelPlaybackSpeed = (typeof SUPPORTED_REEL_PLAYBACK_SPEEDS)[number]
export const DEFAULT_REEL_PLAYBACK_SPEED: ReelPlaybackSpeed = 1

/** "original" shows the spoken language; the others are translated captions. */
export const REEL_CAPTION_LANGUAGES = ['original', 'vi', 'en'] as const
export type ReelCaptionLanguage = (typeof REEL_CAPTION_LANGUAGES)[number]
export const DEFAULT_REEL_CAPTION_LANGUAGE: ReelCaptionLanguage = 'original'

export const parseStoredCaptionLanguage = (value: string | null): ReelCaptionLanguage => {
  if (!value) {
    return DEFAULT_REEL_CAPTION_LANGUAGE
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return REEL_CAPTION_LANGUAGES.some((language) => language === parsed)
      ? (parsed as ReelCaptionLanguage)
      : DEFAULT_REEL_CAPTION_LANGUAGE
  } catch {
    return DEFAULT_REEL_CAPTION_LANGUAGE
  }
}

const parseStoredLiveTranscriptionPreference = (value: string | null) => {
  if (!value) {
    return DEFAULT_LIVE_TRANSCRIPTION_ENABLED
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'boolean' ? parsed : DEFAULT_LIVE_TRANSCRIPTION_ENABLED
  } catch {
    return DEFAULT_LIVE_TRANSCRIPTION_ENABLED
  }
}

const parseStoredPlaybackSpeed = (value: string | null): ReelPlaybackSpeed => {
  if (!value) {
    return DEFAULT_REEL_PLAYBACK_SPEED
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return SUPPORTED_REEL_PLAYBACK_SPEEDS.some((speed) => speed === parsed)
      ? (parsed as ReelPlaybackSpeed)
      : DEFAULT_REEL_PLAYBACK_SPEED
  } catch {
    return DEFAULT_REEL_PLAYBACK_SPEED
  }
}

export const getLiveTranscriptionPreference = async () => {
  try {
    return parseStoredLiveTranscriptionPreference(
      await AsyncStorage.getItem(LIVE_TRANSCRIPTION_ENABLED_KEY),
    )
  } catch {
    return DEFAULT_LIVE_TRANSCRIPTION_ENABLED
  }
}

export const getReelPlaybackSpeedPreference = async () => {
  try {
    return parseStoredPlaybackSpeed(await AsyncStorage.getItem(PLAYBACK_SPEED_KEY))
  } catch {
    return DEFAULT_REEL_PLAYBACK_SPEED
  }
}

export const setLiveTranscriptionPreference = async (enabled: boolean) => {
  await AsyncStorage.setItem(LIVE_TRANSCRIPTION_ENABLED_KEY, JSON.stringify(enabled))
}

export const setReelPlaybackSpeedPreference = async (playbackSpeed: ReelPlaybackSpeed) => {
  await AsyncStorage.setItem(PLAYBACK_SPEED_KEY, JSON.stringify(playbackSpeed))
}

export const getReelCaptionLanguagePreference = async () => {
  try {
    return parseStoredCaptionLanguage(await AsyncStorage.getItem(CAPTION_LANGUAGE_KEY))
  } catch {
    return DEFAULT_REEL_CAPTION_LANGUAGE
  }
}

export const setReelCaptionLanguagePreference = async (language: ReelCaptionLanguage) => {
  await AsyncStorage.setItem(CAPTION_LANGUAGE_KEY, JSON.stringify(language))
}
