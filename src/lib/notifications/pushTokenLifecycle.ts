import { authApi } from '../../api/auth.api'
import { deleteValueFor, getValueFor, save } from '../../utils/storage'
import { veloraSystemCalls } from '../systemCalls/veloraSystemCalls'

import { deleteCurrentFcmToken, getCurrentFcmToken, maskNotificationToken } from './fcm'
import {
  blockPushTokenRegistration,
  getOrCreatePushTokenInstallationId,
  nextPushTokenLifecycleVersion,
} from './pushTokenOperationState'

type PendingLogoutPushTokenCleanup = {
  fcmToken?: string
  voipToken?: string
  deviceId?: string
  fcmLifecycleVersion?: number
  voipLifecycleVersion?: number
  createdAt: string
}

type LogoutPushTokenCleanup = {
  fcmToken: string | null
  voipToken: string | null
  deviceId: string | null
  fcmLifecycleVersion: number | null
  voipLifecycleVersion: number | null
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
    const parsed = JSON.parse(rawValue) as Partial<PendingLogoutPushTokenCleanup> & {
      token?: unknown
    }
    const fcmToken =
      typeof parsed.fcmToken === 'string' && parsed.fcmToken.trim()
        ? parsed.fcmToken.trim()
        : typeof parsed.token === 'string' && parsed.token.trim()
          ? parsed.token.trim()
          : null
    const voipToken =
      typeof parsed.voipToken === 'string' && parsed.voipToken.trim()
        ? parsed.voipToken.trim()
        : null
    const deviceId =
      typeof parsed.deviceId === 'string' && parsed.deviceId.trim() ? parsed.deviceId.trim() : null
    const fcmLifecycleVersion =
      typeof parsed.fcmLifecycleVersion === 'number' &&
      Number.isInteger(parsed.fcmLifecycleVersion) &&
      parsed.fcmLifecycleVersion > 0
        ? parsed.fcmLifecycleVersion
        : null
    const voipLifecycleVersion =
      typeof parsed.voipLifecycleVersion === 'number' &&
      Number.isInteger(parsed.voipLifecycleVersion) &&
      parsed.voipLifecycleVersion > 0
        ? parsed.voipLifecycleVersion
        : null

    if (!fcmToken && !voipToken) {
      return null
    }

    return {
      ...(fcmToken ? { fcmToken } : {}),
      ...(voipToken ? { voipToken } : {}),
      ...(deviceId ? { deviceId } : {}),
      ...(fcmLifecycleVersion ? { fcmLifecycleVersion } : {}),
      ...(voipLifecycleVersion ? { voipLifecycleVersion } : {}),
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

const persistPendingLogoutPushTokenCleanup = async (cleanup: LogoutPushTokenCleanup) => {
  try {
    await save(
      LOGOUT_PUSH_TOKEN_CLEANUP_KEY,
      JSON.stringify({
        ...(cleanup.fcmToken ? { fcmToken: cleanup.fcmToken } : {}),
        ...(cleanup.voipToken ? { voipToken: cleanup.voipToken } : {}),
        ...(cleanup.deviceId ? { deviceId: cleanup.deviceId } : {}),
        ...(cleanup.fcmLifecycleVersion
          ? { fcmLifecycleVersion: cleanup.fcmLifecycleVersion }
          : {}),
        ...(cleanup.voipLifecycleVersion
          ? { voipLifecycleVersion: cleanup.voipLifecycleVersion }
          : {}),
        createdAt: new Date().toISOString(),
      } satisfies PendingLogoutPushTokenCleanup),
    )
  } catch (error) {
    devWarn(`${logPrefix} failed to persist pending logout cleanup`, {
      error,
      maskedFcmToken: maskNotificationToken(cleanup.fcmToken),
      maskedVoipToken: maskNotificationToken(cleanup.voipToken),
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

const getCurrentVoipToken = () => {
  try {
    const state = veloraSystemCalls.getVoipRegistrationState()
    return state.token?.trim() || state.invalidatedToken?.trim() || null
  } catch (error) {
    devWarn(`${logPrefix} failed to read current VoIP token`, error)
    return null
  }
}

const hasPushTokens = (cleanup: LogoutPushTokenCleanup) =>
  Boolean(cleanup.fcmToken || cleanup.voipToken)

const toLogoutPayload = (cleanup: LogoutPushTokenCleanup) => {
  const pushTokens = [
    ...(cleanup.fcmToken
      ? [
          {
            provider: 'fcm' as const,
            token: cleanup.fcmToken,
            ...(cleanup.deviceId ? { deviceId: cleanup.deviceId } : {}),
            ...(cleanup.fcmLifecycleVersion
              ? { lifecycleVersion: cleanup.fcmLifecycleVersion }
              : {}),
          },
        ]
      : []),
    ...(cleanup.voipToken
      ? [
          {
            provider: 'apns_voip' as const,
            token: cleanup.voipToken,
            ...(cleanup.deviceId ? { deviceId: cleanup.deviceId } : {}),
            ...(cleanup.voipLifecycleVersion
              ? { lifecycleVersion: cleanup.voipLifecycleVersion }
              : {}),
          },
        ]
      : []),
  ]

  if (pushTokens.length === 0) {
    return undefined
  }

  return {
    // Older API gateways ignore pushTokens but still clean up FCM.
    ...(cleanup.fcmToken ? { pushToken: cleanup.fcmToken } : {}),
    pushTokens,
  }
}

export const preparePushTokenForLogoutCleanup = async () => {
  try {
    await blockPushTokenRegistration()
  } catch (error) {
    devWarn(`${logPrefix} failed to persist registration block`, error)
  }

  let fcmToken: string | null = null

  try {
    fcmToken = await getCurrentFcmToken()
  } catch (error) {
    devWarn(`${logPrefix} failed to read current FCM token`, error)
  }

  const cleanup: LogoutPushTokenCleanup = {
    fcmToken,
    voipToken: getCurrentVoipToken(),
    deviceId: null,
    fcmLifecycleVersion: null,
    voipLifecycleVersion: null,
  }

  if (hasPushTokens(cleanup)) {
    try {
      cleanup.deviceId = await getOrCreatePushTokenInstallationId()
      cleanup.fcmLifecycleVersion = cleanup.fcmToken ? await nextPushTokenLifecycleVersion() : null
      cleanup.voipLifecycleVersion = cleanup.voipToken
        ? await nextPushTokenLifecycleVersion()
        : null
    } catch (error) {
      devWarn(`${logPrefix} failed to create lifecycle cleanup metadata`, error)
    }

    await persistPendingLogoutPushTokenCleanup(cleanup)
  }
  await bestEffortDeleteLocalFcmToken(fcmToken)

  return cleanup
}

export const performLogoutPushTokenCleanup = async () => {
  const cleanup = await preparePushTokenForLogoutCleanup()

  try {
    await authApi.logout(toLogoutPayload(cleanup))

    if (hasPushTokens(cleanup)) {
      await clearPendingLogoutPushTokenCleanup()
    }

    return { ok: true, cleanup }
  } catch (error) {
    devWarn(`${logPrefix} logout request failed`, {
      error,
      maskedFcmToken: maskNotificationToken(cleanup.fcmToken),
      maskedVoipToken: maskNotificationToken(cleanup.voipToken),
    })

    return { ok: false, cleanup }
  }
}

export const retryPendingLogoutPushTokenCleanup = async () => {
  const pendingCleanup = await getPendingLogoutPushTokenCleanup()

  if (!pendingCleanup) {
    return { ok: true, hadPendingCleanup: false }
  }

  const cleanup: LogoutPushTokenCleanup = {
    fcmToken: pendingCleanup.fcmToken ?? null,
    voipToken: pendingCleanup.voipToken ?? null,
    deviceId: pendingCleanup.deviceId ?? null,
    fcmLifecycleVersion: pendingCleanup.fcmLifecycleVersion ?? null,
    voipLifecycleVersion: pendingCleanup.voipLifecycleVersion ?? null,
  }
  await bestEffortDeleteLocalFcmToken(cleanup.fcmToken)

  try {
    await authApi.logout(toLogoutPayload(cleanup))
    await clearPendingLogoutPushTokenCleanup()

    return { ok: true, hadPendingCleanup: true }
  } catch (error) {
    devWarn(`${logPrefix} retry logout cleanup failed`, {
      error,
      maskedFcmToken: maskNotificationToken(cleanup.fcmToken),
      maskedVoipToken: maskNotificationToken(cleanup.voipToken),
    })

    return { ok: false, hadPendingCleanup: true }
  }
}
