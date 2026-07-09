import Constants from 'expo-constants'
import { useEffect, useRef, type ReactNode } from 'react'
import { Platform } from 'react-native'

import { registerVoipPushToken } from '../api/notification.api'
import { veloraSystemCalls } from '../lib/systemCalls/veloraSystemCalls'
import { useAuthStore } from '../stores/authStore'

const getIosBundleId = () => Constants.expoConfig?.ios?.bundleIdentifier ?? null

const getApnsEnvironment = (): 'development' | 'production' => {
  const entitlement = Constants.expoConfig?.ios?.entitlements?.['aps-environment']
  return entitlement === 'production' ? 'production' : 'development'
}

export function SystemCallProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isLoading = useAuthStore((state) => state.isLoading)
  const userId = useAuthStore((state) => state.user?.id)
  const registeredVoipTokenRef = useRef<string | null>(null)

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return
    }

    veloraSystemCalls.getVoipToken()
  }, [])

  useEffect(() => {
    if (isLoading) {
      return
    }

    veloraSystemCalls.setAuthenticatedUserId(isAuthenticated && userId ? userId : null)
  }, [isAuthenticated, isLoading, userId])

  useEffect(() => {
    if (Platform.OS !== 'ios' || isLoading || !isAuthenticated || !userId) {
      return
    }

    const bundleId = getIosBundleId()
    if (!bundleId) {
      return
    }

    const registerToken = (token: string) => {
      const registrationKey = `${userId}:${token}`
      const deliveryEnvironment = getApnsEnvironment()

      if (!token || registeredVoipTokenRef.current === registrationKey) {
        return
      }

      registeredVoipTokenRef.current = registrationKey
      const appVersion = Constants.expoConfig?.version

      void registerVoipPushToken({
        token,
        bundleId,
        deliveryEnvironment,
        ...(appVersion ? { appVersion } : {}),
      }).catch(() => {
        if (registeredVoipTokenRef.current === registrationKey) {
          registeredVoipTokenRef.current = null
        }
      })
    }

    const currentToken = veloraSystemCalls.getVoipToken()
    if (currentToken) {
      registerToken(currentToken)
    }

    const subscription = veloraSystemCalls.addVoipTokenListener((event) => {
      registerToken(event.token)
    })

    return () => {
      subscription.remove()
    }
  }, [isAuthenticated, isLoading, userId])

  return <>{children}</>
}
