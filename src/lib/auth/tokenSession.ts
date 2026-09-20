import * as SecureStore from 'expo-secure-store'

import { createUuid } from '../uuid'

import type { MobileAuthTokenPair } from '../../types/auth.types'

const REFRESH_TOKEN_KEY = 'velora.auth.refresh-token'
const REFRESH_REQUEST_ID_KEY = 'velora.auth.refresh-request-id'
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

  getOrCreateRefreshRequestId: async () => {
    const existingRequestId = await SecureStore.getItemAsync(
      REFRESH_REQUEST_ID_KEY,
      SECURE_STORE_OPTIONS,
    )

    if (existingRequestId) return existingRequestId

    const requestId = createUuid()
    await SecureStore.setItemAsync(REFRESH_REQUEST_ID_KEY, requestId, SECURE_STORE_OPTIONS)
    return requestId
  },

  installTokenPair: async ({ accessToken: nextAccessToken, refreshToken }: MobileAuthTokenPair) => {
    // Persist refresh rotation before exposing the corresponding access token.
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, SECURE_STORE_OPTIONS)
    accessToken = nextAccessToken

    try {
      await SecureStore.deleteItemAsync(REFRESH_REQUEST_ID_KEY, SECURE_STORE_OPTIONS)
    } catch {
      // A stale request ID is scoped to the old token and is harmless after rotation.
    }
  },

  clear: async () => {
    accessToken = null
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS)
    await SecureStore.deleteItemAsync(REFRESH_REQUEST_ID_KEY, SECURE_STORE_OPTIONS)
  },
}
