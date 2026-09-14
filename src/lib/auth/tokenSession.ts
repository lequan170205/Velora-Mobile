import * as SecureStore from 'expo-secure-store'

import type { MobileAuthTokenPair } from '../../types/auth.types'

const REFRESH_TOKEN_KEY = 'velora.auth.refresh-token'
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  // Incoming-call cold-start recovery can need auth while the device is locked.
  // Keep the credential device-bound while allowing access after the first unlock.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

let accessToken: string | null = null

export const authTokenSession = {
  getAccessToken: () => accessToken,

  hasAccessToken: () => Boolean(accessToken),

  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS),

  installTokenPair: async ({ accessToken: nextAccessToken, refreshToken }: MobileAuthTokenPair) => {
    // Persist refresh rotation before exposing the corresponding access token.
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, SECURE_STORE_OPTIONS)
    accessToken = nextAccessToken
  },

  clear: async () => {
    accessToken = null
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS)
  },
}
