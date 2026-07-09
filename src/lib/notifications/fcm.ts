import {
  AuthorizationStatus,
  deleteToken,
  getAPNSToken,
  getMessaging,
  getToken,
  isDeviceRegisteredForRemoteMessages,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
  requestPermission,
} from '@react-native-firebase/messaging'
import * as ReactNative from 'react-native'
import { Platform } from 'react-native'

type PermissionStatus =
  | 'authorized'
  | 'provisional'
  | 'ephemeral'
  | 'denied'
  | 'not-determined'
  | 'unknown'

export type FcmDebugErrorCode =
  | 'apns-token-unavailable'
  | 'firebase-not-configured'
  | 'messaging-unavailable'
  | 'permission-denied'
  | 'simulator-or-device-limitation'
  | 'remote-message-registration-failed'
  | 'unknown'

export type FcmPermissionResult = {
  platform: typeof Platform.OS
  status: PermissionStatus
  granted: boolean
  rawStatus?: number | string
}

export type FcmTokenResult =
  | {
      status: 'success'
      token: string
      maskedToken: string
      isRegisteredForRemoteMessages?: boolean
      apnsToken?: string | null
      maskedApnsToken?: string | null
      apnsError?: FcmDebugError
    }
  | {
      status: 'error'
      error: FcmDebugError
      isRegisteredForRemoteMessages?: boolean
      apnsToken?: string | null
      maskedApnsToken?: string | null
      apnsError?: FcmDebugError
    }

export type FcmDebugError = {
  code: FcmDebugErrorCode
  message: string
  nativeCode?: string
}

const devLog = (message: string, payload?: unknown) => {
  if (!__DEV__) {
    return
  }

  if (payload === undefined) {
    globalThis.console?.info(message)
    return
  }

  globalThis.console?.info(message, payload)
}

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

export const maskNotificationToken = (token?: string | null) => {
  if (!token) {
    return null
  }

  return `${token.slice(0, 16)}... (${token.length} chars)`
}

const mapAuthorizationStatus = (status: number): PermissionStatus => {
  switch (status) {
    case AuthorizationStatus.AUTHORIZED:
      return 'authorized'
    case AuthorizationStatus.PROVISIONAL:
      return 'provisional'
    case AuthorizationStatus.EPHEMERAL:
      return 'ephemeral'
    case AuthorizationStatus.DENIED:
      return 'denied'
    case AuthorizationStatus.NOT_DETERMINED:
      return 'not-determined'
    default:
      return 'unknown'
  }
}

const hasNotificationPermission = (status: PermissionStatus) =>
  status === 'authorized' || status === 'provisional' || status === 'ephemeral'

const getNativeErrorCode = (error: unknown) => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }

  return undefined
}

export const normalizeFcmError = (error: unknown): FcmDebugError => {
  const nativeCode = getNativeErrorCode(error)
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown FCM error'

  const searchable = `${nativeCode ?? ''} ${message}`.toLowerCase()

  const toDebugError = (code: FcmDebugErrorCode): FcmDebugError => ({
    code,
    message,
    ...(nativeCode ? { nativeCode } : {}),
  })

  if (searchable.includes('unregistered')) {
    return toDebugError('remote-message-registration-failed')
  }

  if (searchable.includes('apns') || searchable.includes('apn')) {
    return toDebugError('apns-token-unavailable')
  }

  if (searchable.includes('no firebase app') || searchable.includes('not initialized')) {
    return toDebugError('firebase-not-configured')
  }

  if (searchable.includes('messaging') && searchable.includes('unavailable')) {
    return toDebugError('messaging-unavailable')
  }

  if (searchable.includes('simulator') || searchable.includes('physical device')) {
    return toDebugError('simulator-or-device-limitation')
  }

  if (searchable.includes('permission') && searchable.includes('denied')) {
    return toDebugError('permission-denied')
  }

  return toDebugError('unknown')
}

const getRemoteMessageRegistrationStatus = () => {
  if (Platform.OS !== 'ios') {
    return undefined
  }

  const messaging = getMessaging()

  try {
    return isDeviceRegisteredForRemoteMessages(messaging)
  } catch {
    return false
  }
}

const ensureRemoteMessageRegistration = async () => {
  if (Platform.OS !== 'ios') {
    return undefined
  }

  const messaging = getMessaging()
  const wasRegistered = isDeviceRegisteredForRemoteMessages(messaging)

  if (!wasRegistered) {
    await registerDeviceForRemoteMessages(messaging)
  }

  return isDeviceRegisteredForRemoteMessages(messaging)
}

const requestAndroidNotificationPermission = async (): Promise<FcmPermissionResult> => {
  if (Platform.OS !== 'android') {
    return { platform: Platform.OS, status: 'unknown', granted: false }
  }

  const androidVersion = Number(Platform.Version)

  if (Number.isFinite(androidVersion) && androidVersion < 33) {
    return {
      platform: Platform.OS,
      status: 'authorized',
      granted: true,
      rawStatus: `android-${androidVersion}`,
    }
  }

  const result = await ReactNative.PermissionsAndroid.request(
    ReactNative.PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  )
  const granted = result === ReactNative.PermissionsAndroid.RESULTS.GRANTED

  return {
    platform: Platform.OS,
    status: granted ? 'authorized' : 'denied',
    granted,
    rawStatus: result,
  }
}

export const requestFcmPermission = async (): Promise<FcmPermissionResult> => {
  if (Platform.OS === 'android') {
    return requestAndroidNotificationPermission()
  }

  const messaging = getMessaging()

  const rawStatus = await requestPermission(messaging, {
    alert: true,
    badge: true,
    sound: true,
    provisional: false,
  })

  const status = mapAuthorizationStatus(rawStatus)

  return {
    platform: Platform.OS,
    status,
    granted: hasNotificationPermission(status),
    rawStatus,
  }
}

export const getFcmTokenForDebug = async (): Promise<FcmTokenResult> => {
  const messaging = getMessaging()
  let apnsToken: string | null = null
  let apnsError: FcmDebugError | undefined
  let isRegisteredForRemoteMessages: boolean | undefined = getRemoteMessageRegistrationStatus()

  devLog('[FCM debug] getFcmTokenForDebug start', {
    platform: Platform.OS,
    isRegisteredForRemoteMessages,
  })

  try {
    if (Platform.OS === 'ios') {
      devLog('[FCM debug] ensure remote message registration start')

      isRegisteredForRemoteMessages = await ensureRemoteMessageRegistration()

      devLog('[FCM debug] ensure remote message registration done', {
        isRegisteredForRemoteMessages,
      })

      try {
        devLog('[FCM debug] get APNs token start')

        apnsToken = await getAPNSToken(messaging)

        devLog('[FCM debug] get APNs token done', {
          maskedApnsToken: maskNotificationToken(apnsToken),
        })
      } catch (error) {
        apnsError = normalizeFcmError(error)

        devWarn('[FCM debug] get APNs token failed', apnsError)
      }
    }

    devLog('[FCM debug] get FCM token start')

    const token = await getToken(messaging)

    devLog('[FCM debug] get FCM token done', {
      maskedToken: maskNotificationToken(token),
    })

    return {
      status: 'success',
      token,
      maskedToken: maskNotificationToken(token) ?? 'unavailable',
      ...(isRegisteredForRemoteMessages !== undefined ? { isRegisteredForRemoteMessages } : {}),
      apnsToken,
      maskedApnsToken: maskNotificationToken(apnsToken),
      ...(apnsError ? { apnsError } : {}),
    }
  } catch (error) {
    isRegisteredForRemoteMessages = getRemoteMessageRegistrationStatus()

    devWarn('[FCM debug] getFcmTokenForDebug failed', {
      error: normalizeFcmError(error),
      isRegisteredForRemoteMessages,
      maskedApnsToken: maskNotificationToken(apnsToken),
      apnsError,
    })

    return {
      status: 'error',
      error: normalizeFcmError(error),
      ...(isRegisteredForRemoteMessages !== undefined ? { isRegisteredForRemoteMessages } : {}),
      apnsToken,
      maskedApnsToken: maskNotificationToken(apnsToken),
      ...(apnsError ? { apnsError } : {}),
    }
  }
}

export const getCurrentFcmToken = async () => {
  const token = await getToken(getMessaging())
  return token.trim() || null
}

export const deleteCurrentFcmToken = async () => {
  await deleteToken(getMessaging())
}

export const subscribeToFcmTokenRefresh = (
  listener: (token: string, maskedToken: string) => void,
) => {
  const messaging = getMessaging()

  return onTokenRefresh(messaging, (token) => {
    listener(token, maskNotificationToken(token) ?? 'unavailable')
  })
}
