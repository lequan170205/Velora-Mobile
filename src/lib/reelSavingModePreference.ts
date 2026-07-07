import AsyncStorage from '@react-native-async-storage/async-storage'

const REEL_SAVING_MODE_ENABLED_KEY = 'reel-saving-mode-enabled'

export const DEFAULT_REEL_SAVING_MODE_ENABLED = true

const parseStoredPreference = (value: string | null) => {
  if (!value) {
    return DEFAULT_REEL_SAVING_MODE_ENABLED
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'boolean' ? parsed : DEFAULT_REEL_SAVING_MODE_ENABLED
  } catch {
    return DEFAULT_REEL_SAVING_MODE_ENABLED
  }
}

export const getReelSavingModePreference = async () => {
  try {
    return parseStoredPreference(await AsyncStorage.getItem(REEL_SAVING_MODE_ENABLED_KEY))
  } catch {
    return DEFAULT_REEL_SAVING_MODE_ENABLED
  }
}

export const setReelSavingModePreference = async (enabled: boolean) => {
  await AsyncStorage.setItem(REEL_SAVING_MODE_ENABLED_KEY, JSON.stringify(enabled))
}
