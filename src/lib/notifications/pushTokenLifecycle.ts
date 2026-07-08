import { authApi } from '../../api/auth.api'
import { deleteValueFor, getValueFor, save } from '../../utils/storage'

import { deleteCurrentFcmToken, getCurrentFcmToken, maskNotificationToken } from './fcm'

type PendingLogoutPushTokenCleanup = {
  token: string
  createdAt: string
}

const LOGOUT_PUSH_TOKEN_CLEANUP_KEY = 'logout-push-token-cleanup'
const logPrefix = '[Push token lifecycle]'

const devWarn = (message: string, payload?: unknown) => {
  if (!__DEV__) {
    return
  }

  if (payload === undefined) {
    globalThis.console?.warn(message)
    return
  }

  globalThis.console?.warn(message, payload)
}

const parsePendingLogoutPushTokenCleanup = (rawValue: string | null) => {
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PendingLogoutPushTokenCleanup>

    if (typeof parsed.token !== 'string' || !parsed.token.trim()) {
      return null
    }

    return {
      token: parsed.token.trim(),
      createdAt:
        typeof parsed.createdAt === 'string' && parsed.createdAt.trim()
          ? parsed.createdAt
          : new Date(0).toISOString(),
    }
  } catch (error) {
    devWarn(`${logPrefix} failed to parse pending logout cleanup`, error)
    return null
  }
}

export const clearPendingLogoutPushTokenCleanup = async () => {
  try {
    await deleteValueFor(LOGOUT_PUSH_TOKEN_CLEANUP_KEY)
  } catch (error) {
    devWarn(`${logPrefix} failed to clear pending logout cleanup`, error)
  }
}

export const getPendingLogoutPushTokenCleanup = async () => {
  try {
    const rawValue = await getValueFor(LOGOUT_PUSH_TOKEN_CLEANUP_KEY)
    const pendingCleanup = parsePendingLogoutPushTokenCleanup(rawValue)

    if (rawValue && !pendingCleanup) {
      await clearPendingLogoutPushTokenCleanup()
    }

    return pendingCleanup
  } catch (error) {
    devWarn(`${logPrefix} failed to read pending logout cleanup`, error)
    return null
  }
}

const persistPendingLogoutPushTokenCleanup = async (token: string) => {
  try {
    await save(
      LOGOUT_PUSH_TOKEN_CLEANUP_KEY,
      JSON.stringify({
        token,
        createdAt: new Date().toISOString(),
      } satisfies PendingLogoutPushTokenCleanup),
    )
  } catch (error) {
    devWarn(`${logPrefix} failed to persist pending logout cleanup`, {
      error,
      maskedToken: maskNotificationToken(token),
    })
  }
}

const bestEffortDeleteLocalFcmToken = async (token?: string | null) => {
  try {
    await deleteCurrentFcmToken()
  } catch (error) {
    devWarn(`${logPrefix} failed to delete local FCM token`, {
      error,
      maskedToken: maskNotificationToken(token),
    })
  }
}

export const preparePushTokenForLogoutCleanup = async () => {
  let token: string | null = null

  try {
    token = await getCurrentFcmToken()
  } catch (error) {
    devWarn(`${logPrefix} failed to read current FCM token`, error)
  }

  if (!token) {
    await bestEffortDeleteLocalFcmToken()
    return null
  }

  await persistPendingLogoutPushTokenCleanup(token)
  await bestEffortDeleteLocalFcmToken(token)

  return token
}

export const performLogoutPushTokenCleanup = async () => {
  const token = await preparePushTokenForLogoutCleanup()

  try {
    await authApi.logout(token ? { pushToken: token } : undefined)

    if (token) {
      await clearPendingLogoutPushTokenCleanup()
    }

    return { ok: true, token }
  } catch (error) {
    devWarn(`${logPrefix} logout request failed`, {
      error,
      maskedToken: maskNotificationToken(token),
    })

    return { ok: false, token }
  }
}

export const retryPendingLogoutPushTokenCleanup = async () => {
  const pendingCleanup = await getPendingLogoutPushTokenCleanup()

  if (!pendingCleanup) {
    return { ok: true, hadPendingCleanup: false }
  }

  await bestEffortDeleteLocalFcmToken(pendingCleanup.token)

  try {
    await authApi.logout({ pushToken: pendingCleanup.token })
    await clearPendingLogoutPushTokenCleanup()

    return { ok: true, hadPendingCleanup: true }
  } catch (error) {
    devWarn(`${logPrefix} retry logout cleanup failed`, {
      error,
      maskedToken: maskNotificationToken(pendingCleanup.token),
    })

    return { ok: false, hadPendingCleanup: true }
  }
}
