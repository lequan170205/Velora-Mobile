import { useEffect, type ReactNode } from 'react'

import { registerPushToken } from '../api/notification.api'
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

export function FcmDebugProvider({ children }: { children: ReactNode }) {
  const isLoading = useAuthStore((state) => state.isLoading)

  useEffect(() => {
    if (!__DEV__ || isLoading) {
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
  }, [isLoading])

  return <>{children}</>
}
