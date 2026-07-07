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
import { useAuthStore } from '../stores/authStore'

const logPrefix = '[FCM debug]'
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
  const processedNotificationKeysRef = useRef(new Set<string>())
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
    if (isLoading || !isAuthenticated || !userId) {
      return
    }

    let disposed = false
    let unsubscribeTokenRefresh: (() => void) | undefined

    const setTokenRefreshSubscription = (unsubscribe: () => void) => {
      if (disposed) {
        unsubscribe()
        return
      }

      unsubscribeTokenRefresh = unsubscribe
    }

    const bootstrapFcmDebug = async () => {
      devLog(`${logPrefix} bootstrap starting`)

      try {
        setTokenRefreshSubscription(
          subscribeToFcmTokenRefresh((token, maskedToken) => {
            devLog(`${logPrefix} token refresh`, { maskedToken })

            void registerPushToken({
              token,
              appVersion: '1.0.0',
            })
              .then(() => {
                devLog(`${logPrefix} refreshed token registered`, { maskedToken })
              })
              .catch((error: unknown) => {
                devWarn(`${logPrefix} refreshed token registration failed`, error)
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
          devWarn(`${logPrefix} permission not granted; skipping initial token fetch`)
          return
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
            await registerPushToken({
              token: tokenResult.token,
              appVersion: '1.0.0',
            })

            devLog(`${logPrefix} token registered with notification-service`, {
              maskedToken: tokenResult.maskedToken,
            })
          } catch (error) {
            devWarn(`${logPrefix} token registration failed`, error)
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
    }
  }, [isAuthenticated, isLoading, userId])

  return <>{children}</>
}
