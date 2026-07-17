import {
  getInitialNotification,
  getMessaging,
  onNotificationOpenedApp,
  type RemoteMessage,
} from '@react-native-firebase/messaging'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { registerPushToken } from '../api/notification.api'
import { useConversationNavigation } from '../hooks/useConversationNavigation'
import {
  getFcmTokenForDebug,
  normalizeFcmError,
  requestFcmPermission,
  subscribeToFcmTokenRefresh,
} from '../lib/notifications/fcm'
import {
  getOrCreatePushTokenInstallationId,
  isPushTokenRegistrationBlocked,
  nextPushTokenLifecycleVersion,
} from '../lib/notifications/pushTokenOperationState'
import { useAuthStore } from '../stores/authStore'

import { useNetworkStatus } from './NetworkProvider'

const logPrefix = '[FCM debug]'
const FCM_REGISTRATION_RETRY_DELAY_MS = 30_000
const MAX_FCM_REGISTRATION_RETRIES = 5
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

type NotificationConversationTarget = {
  conversationId: string
  dedupeKey: string | null
}

const getRemoteMessageDataString = (data: RemoteMessage['data'] | undefined, key: string) => {
  const value = data?.[key]

  return typeof value === 'string' ? value.trim() : ''
}

const getNotificationConversationTarget = (
  remoteMessage: RemoteMessage | null | undefined,
): NotificationConversationTarget | null => {
  const data = remoteMessage?.data

  if (getRemoteMessageDataString(data, 'type') !== 'NEW_MESSAGE') {
    return null
  }

  const conversationId = getRemoteMessageDataString(data, 'conversationId')

  if (!conversationId) {
    return null
  }

  const dedupeKey =
    getRemoteMessageDataString(data, 'notificationJobId') ||
    getRemoteMessageDataString(data, 'messageId') ||
    remoteMessage?.messageId?.trim() ||
    null

  return { conversationId, dedupeKey }
}

export function FcmDebugProvider({ children }: { children: ReactNode }) {
  const { openConversation } = useConversationNavigation()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isLoading = useAuthStore((state) => state.isLoading)
  const userId = useAuthStore((state) => state.user?.id)
  const username = useAuthStore((state) => state.user?.username)
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const processedNotificationKeysRef = useRef(new Set<string>())
  const registrationRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const registrationRetryAttemptsRef = useRef(0)
  const [registrationRetryVersion, setRegistrationRetryVersion] = useState(0)
  const [pendingNotificationConversationId, setPendingNotificationConversationId] = useState<
    string | null
  >(null)
  const canOpenNotificationConversation =
    !isLoading && isAuthenticated && Boolean(userId && username?.trim())

  const queueNotificationConversation = useCallback((remoteMessage: RemoteMessage | null) => {
    const target = getNotificationConversationTarget(remoteMessage)

    if (!target) {
      return
    }

    if (target.dedupeKey) {
      if (processedNotificationKeysRef.current.has(target.dedupeKey)) {
        return
      }

      processedNotificationKeysRef.current.add(target.dedupeKey)
    }

    setPendingNotificationConversationId(target.conversationId)
  }, [])

  useEffect(() => {
    const messaging = getMessaging()
    const unsubscribeNotificationOpened = onNotificationOpenedApp(
      messaging,
      queueNotificationConversation,
    )
    let disposed = false

    void getInitialNotification(messaging)
      .then((remoteMessage) => {
        if (!disposed) {
          queueNotificationConversation(remoteMessage)
        }
      })
      .catch((error: unknown) => {
        devWarn(`${logPrefix} initial notification lookup failed`, normalizeFcmError(error))
      })

    return () => {
      disposed = true
      unsubscribeNotificationOpened()
    }
  }, [queueNotificationConversation])

  useEffect(() => {
    if (!pendingNotificationConversationId || !canOpenNotificationConversation) {
      return
    }

    const didOpen = openConversation(pendingNotificationConversationId, {
      replaceCurrentConversation: true,
    })

    if (didOpen) {
      setPendingNotificationConversationId((currentConversationId) =>
        currentConversationId === pendingNotificationConversationId ? null : currentConversationId,
      )
    }
  }, [canOpenNotificationConversation, openConversation, pendingNotificationConversationId])

  useEffect(() => {
    if (isLoading || !isAuthenticated || !userId || !isNetworkResolved || !isOnline) {
      return
    }

    let disposed = false
    let unsubscribeTokenRefresh: (() => void) | undefined
    const scheduleRegistrationRetry = () => {
      if (
        disposed ||
        registrationRetryTimeoutRef.current ||
        registrationRetryAttemptsRef.current >= MAX_FCM_REGISTRATION_RETRIES
      ) {
        return
      }

      registrationRetryAttemptsRef.current += 1
      registrationRetryTimeoutRef.current = setTimeout(() => {
        registrationRetryTimeoutRef.current = null
        setRegistrationRetryVersion((version) => version + 1)
      }, FCM_REGISTRATION_RETRY_DELAY_MS)
    }

    const setTokenRefreshSubscription = (unsubscribe: () => void) => {
      if (disposed) {
        unsubscribe()
        return
      }

      unsubscribeTokenRefresh = unsubscribe
    }

    const registerFcmToken = async (token: string, maskedToken: string) => {
      if (disposed || (await isPushTokenRegistrationBlocked())) {
        return false
      }

      const deviceId = await getOrCreatePushTokenInstallationId()
      const lifecycleVersion = await nextPushTokenLifecycleVersion()

      if (disposed || (await isPushTokenRegistrationBlocked())) {
        return false
      }

      await registerPushToken({
        token,
        deviceId,
        appVersion: '1.0.0',
        lifecycleVersion,
      })
      devLog(`${logPrefix} token registered with notification-service`, { maskedToken })
      return true
    }

    const bootstrapFcmDebug = async () => {
      devLog(`${logPrefix} bootstrap starting`)

      try {
        setTokenRefreshSubscription(
          subscribeToFcmTokenRefresh((token, maskedToken) => {
            devLog(`${logPrefix} token refresh`, { maskedToken })

            void registerFcmToken(token, maskedToken)
              .then((didRegister) => {
                if (!didRegister) {
                  return
                }

                registrationRetryAttemptsRef.current = 0
                devLog(`${logPrefix} refreshed token registered`, { maskedToken })
              })
              .catch((error: unknown) => {
                devWarn(`${logPrefix} refreshed token registration failed`, error)
                scheduleRegistrationRetry()
              })
          }),
        )
        devLog(`${logPrefix} token refresh listener registered`)
      } catch (error) {
        devWarn(`${logPrefix} token refresh listener failed`, normalizeFcmError(error))
      }

      try {
        const permission = await requestFcmPermission()
        devLog(`${logPrefix} permission`, permission)

        if (!permission.granted) {
          // The iOS FCM token is also used for silent CALL_STATE_UPDATE pushes
          // that close CallKit. Alert permission controls presentation, not
          // whether this authenticated device needs call cleanup.
          devWarn(`${logPrefix} permission not granted; continuing with data-token registration`)
        }

        const tokenResult = await getFcmTokenForDebug()

        if (tokenResult.status === 'success') {
          if (tokenResult.apnsError) {
            devWarn(`${logPrefix} APNs token unavailable`, tokenResult.apnsError)
          }

          devLog(`${logPrefix} token`, {
            maskedToken: tokenResult.maskedToken,
            maskedApnsToken: tokenResult.maskedApnsToken,
          })

          try {
            const didRegister = await registerFcmToken(tokenResult.token, tokenResult.maskedToken)

            if (!didRegister) {
              return
            }

            registrationRetryAttemptsRef.current = 0
          } catch (error) {
            devWarn(`${logPrefix} token registration failed`, error)
            scheduleRegistrationRetry()
          }

          return
        }

        devWarn(`${logPrefix} token retrieval failed`, tokenResult)
      } catch (error) {
        devWarn(`${logPrefix} bootstrap failed`, normalizeFcmError(error))
      }
    }

    void bootstrapFcmDebug()

    return () => {
      disposed = true
      unsubscribeTokenRefresh?.()

      if (registrationRetryTimeoutRef.current) {
        clearTimeout(registrationRetryTimeoutRef.current)
        registrationRetryTimeoutRef.current = null
      }
    }
  }, [isAuthenticated, isLoading, isNetworkResolved, isOnline, registrationRetryVersion, userId])

  return <>{children}</>
}
