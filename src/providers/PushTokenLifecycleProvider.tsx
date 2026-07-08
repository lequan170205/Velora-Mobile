import { useEffect, useRef, type ReactNode } from 'react'

import {
  clearPendingLogoutPushTokenCleanup,
  retryPendingLogoutPushTokenCleanup,
} from '../lib/notifications/pushTokenLifecycle'
import { useAuthStore } from '../stores/authStore'

import { useNetworkStatus } from './NetworkProvider'

export function PushTokenLifecycleProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isLoading = useAuthStore((state) => state.isLoading)
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const cleanupInFlightRef = useRef(false)

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return
    }

    void clearPendingLogoutPushTokenCleanup()
  }, [isAuthenticated, isLoading])

  useEffect(() => {
    if (
      isLoading ||
      isAuthenticated ||
      !isNetworkResolved ||
      !isOnline ||
      cleanupInFlightRef.current
    ) {
      return
    }

    cleanupInFlightRef.current = true

    void retryPendingLogoutPushTokenCleanup().finally(() => {
      cleanupInFlightRef.current = false
    })
  }, [isAuthenticated, isLoading, isNetworkResolved, isOnline])

  return <>{children}</>
}
