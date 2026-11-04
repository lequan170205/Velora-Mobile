import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

import { createUuid } from '../uuid'

import type { MobileAuthTokenPair } from '../../types/auth.types'

const AUTH_TRANSITION_KEY = 'velora.auth.transition-pending'
const SECURE_AUTH_TRANSITION_KEY = 'velora.auth.transition-pending-secure'
const REFRESH_TOKEN_KEY = 'velora.auth.refresh-token'
const REFRESH_REQUEST_ID_KEY = 'velora.auth.refresh-request-id'
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  // Incoming-call cold-start recovery can need auth while the device is locked.
  // Keep the credential device-bound while allowing access after the first unlock.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

let accessToken: string | null = null
let generation = 0
let loginAttempt = 0
let identity: string | null = null
let transitioning = false
let restoreBlocked = false
let writes: Promise<unknown> = Promise.resolve()

const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = writes.then(operation, operation)
  writes = next.catch(() => undefined)
  return next
}

const savePair = async (
  { accessToken: nextAccessToken, refreshToken }: MobileAuthTokenPair,
  expected: number,
  isCurrent = () => generation === expected,
) => {
  if (!isCurrent()) return false
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, SECURE_STORE_OPTIONS)
  if (!isCurrent()) return false
  accessToken = nextAccessToken
  try {
    await SecureStore.deleteItemAsync(REFRESH_REQUEST_ID_KEY, SECURE_STORE_OPTIONS)
  } catch {
    // A stale request ID is scoped to the old token and is harmless after rotation.
  }
  return isCurrent()
}

const writeTransitionMarker = async () => {
  try {
    await AsyncStorage.setItem(AUTH_TRANSITION_KEY, '1')
  } catch (error) {
    try {
      await SecureStore.setItemAsync(SECURE_AUTH_TRANSITION_KEY, '1', SECURE_STORE_OPTIONS)
    } catch {
      try {
        await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS)
      } catch {
        // Keep the original marker-write error.
      }
    }
    throw error
  }
}

const clearTransitionMarkers = async () => {
  await AsyncStorage.removeItem(AUTH_TRANSITION_KEY)
  await SecureStore.deleteItemAsync(SECURE_AUTH_TRANSITION_KEY, SECURE_STORE_OPTIONS)
}

export const authTokenSession = {
  getAccessToken: () => accessToken,
  getGeneration: () => generation,
  beginLoginAttempt: () => ++loginAttempt,
  isTransitioning: () => transitioning,
  canRestore: async () => {
    if (restoreBlocked) return false
    try {
      if ((await AsyncStorage.getItem(AUTH_TRANSITION_KEY)) !== null) return false
      return (
        (await SecureStore.getItemAsync(SECURE_AUTH_TRANSITION_KEY, SECURE_STORE_OPTIONS)) === null
      )
    } catch {
      return false
    }
  },
  getIdentity: () => identity,
  bindIdentity: (userId: string, expected: number) => {
    if (generation !== expected || transitioning || !accessToken || !userId) return false
    identity = userId
    return true
  },
  waitForWrites: () => writes,
  hasAccessToken: () => Boolean(accessToken),
  finishLogout: (previousGeneration: number, clearAuth: () => void) => {
    if (generation !== previousGeneration + 1 || accessToken) return false
    clearAuth()
    return true
  },
  runLogoutCleanup: (
    previousGeneration: number,
    operation: (isCurrent: () => boolean) => Promise<void>,
  ) =>
    serialize(async () => {
      const isCurrent = () => generation === previousGeneration + 1 && !accessToken
      if (!isCurrent()) return false
      await operation(isCurrent)
      return isCurrent()
    }),
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS),
  getOrCreateRefreshRequestId: () =>
    serialize(async () => {
      const existingRequestId = await SecureStore.getItemAsync(
        REFRESH_REQUEST_ID_KEY,
        SECURE_STORE_OPTIONS,
      )
      if (existingRequestId) return existingRequestId
      const requestId = createUuid()
      await SecureStore.setItemAsync(REFRESH_REQUEST_ID_KEY, requestId, SECURE_STORE_OPTIONS)
      return requestId
    }),
  installTokenPair: (pair: MobileAuthTokenPair, expectedLoginAttempt?: number) => {
    const attempt = expectedLoginAttempt ?? ++loginAttempt
    if (attempt !== loginAttempt) return Promise.reject(new Error('Login attempt superseded'))
    const expected = ++generation
    const isCurrent = () => generation === expected && loginAttempt === attempt
    accessToken = null
    identity = null
    transitioning = true
    restoreBlocked = true
    return serialize(async () => {
      try {
        await writeTransitionMarker()
        if (!(await savePair(pair, expected, isCurrent))) throw new Error('Auth session changed')
        await clearTransitionMarkers()
        if (!isCurrent()) throw new Error('Auth session changed')
        restoreBlocked = false
      } catch (error) {
        if (generation === expected) accessToken = null
        throw error
      } finally {
        if (generation === expected) transitioning = false
      }
    })
  },
  rotateTokenPair: (pair: MobileAuthTokenPair, expected: number) =>
    serialize(() => savePair(pair, expected)),
  clear: (expected?: number) => {
    if (expected !== undefined && expected !== generation)
      return Promise.reject(new Error('Auth session changed'))
    const expectedGeneration = ++generation
    accessToken = null
    identity = null
    transitioning = true
    restoreBlocked = true
    return serialize(async () => {
      try {
        await writeTransitionMarker()
        await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS)
        await SecureStore.deleteItemAsync(REFRESH_REQUEST_ID_KEY, SECURE_STORE_OPTIONS)
        if (generation !== expectedGeneration) throw new Error('Auth session changed')
        await clearTransitionMarkers()
        if (generation === expectedGeneration) restoreBlocked = false
      } finally {
        if (generation === expectedGeneration) transitioning = false
      }
    })
  },
}
