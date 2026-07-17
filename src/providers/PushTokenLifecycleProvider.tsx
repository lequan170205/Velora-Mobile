import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'

import { getLogoutPushTokenCleanupRetryDelay } from '../lib/notifications/logoutPushTokenCleanupRetry'
import { retryPendingLogoutPushTokenCleanup } from '../lib/notifications/pushTokenLifecycle'
import { useAuthStore } from '../stores/authStore'

import { useNetworkStatus } from './NetworkProvider'

export function PushTokenLifecycleProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isLoading = useAuthStore((state) => state.isLoading)
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const cleanupInFlightRef = useRef(false)
  const cleanupRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const failedCleanupAttemptsRef = useRef(0)
  const canRetryCleanupRef = useRef(false)
  const isMountedRef = useRef(false)
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active')
  const [cleanupRetryVersion, setCleanupRetryVersion] = useState(0)

  const canRetryCleanup =
    !isLoading && !isAuthenticated && isNetworkResolved && isOnline && isAppActive
  canRetryCleanupRef.current = canRetryCleanup

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsAppActive(nextState === 'active')
    })

    return () => {
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false

      if (cleanupRetryTimeoutRef.current) {
        clearTimeout(cleanupRetryTimeoutRef.current)
        cleanupRetryTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!canRetryCleanup) {
      if (cleanupRetryTimeoutRef.current) {
        clearTimeout(cleanupRetryTimeoutRef.current)
        cleanupRetryTimeoutRef.current = null
      }
      return
    }

    if (cleanupInFlightRef.current || cleanupRetryTimeoutRef.current) {
      return
    }

    cleanupInFlightRef.current = true

    void retryPendingLogoutPushTokenCleanup()
      .then(({ hadPendingCleanup, ok }) => {
        if (ok || !hadPendingCleanup) {
          failedCleanupAttemptsRef.current = 0
          return
        }

        if (
          !isMountedRef.current ||
          !canRetryCleanupRef.current ||
          cleanupRetryTimeoutRef.current
        ) {
          return
        }

        const retryDelay = getLogoutPushTokenCleanupRetryDelay(failedCleanupAttemptsRef.current)
        failedCleanupAttemptsRef.current += 1
        cleanupRetryTimeoutRef.current = setTimeout(() => {
          cleanupRetryTimeoutRef.current = null

          if (isMountedRef.current && canRetryCleanupRef.current) {
            setCleanupRetryVersion((version) => version + 1)
          }
        }, retryDelay)
      })
      .finally(() => {
        cleanupInFlightRef.current = false
      })
  }, [canRetryCleanup, cleanupRetryVersion])

  return <>{children}</>
}
