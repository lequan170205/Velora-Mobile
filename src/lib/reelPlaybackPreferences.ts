import AsyncStorage from '@react-native-async-storage/async-storage'

const LIVE_TRANSCRIPTION_ENABLED_KEY = 'reel-live-transcription-enabled'
const PLAYBACK_SPEED_KEY = 'reel-playback-speed'

export const DEFAULT_LIVE_TRANSCRIPTION_ENABLED = true
export const SUPPORTED_REEL_PLAYBACK_SPEEDS = [0.5, 1, 1.5, 2] as const
export type ReelPlaybackSpeed = (typeof SUPPORTED_REEL_PLAYBACK_SPEEDS)[number]
export const DEFAULT_REEL_PLAYBACK_SPEED: ReelPlaybackSpeed = 1

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
