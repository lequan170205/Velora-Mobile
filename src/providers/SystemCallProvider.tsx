import Constants from 'expo-constants'
import { useEffect, useRef, type ReactNode } from 'react'
import { Platform } from 'react-native'

import { deactivateVoipPushToken, registerVoipPushToken } from '../api/notification.api'
import { veloraSystemCalls, type VoipRegistrationState } from '../lib/systemCalls/veloraSystemCalls'
import { useAuthStore } from '../stores/authStore'
import { getValueFor, save } from '../utils/storage'

const VOIP_INSTALLATION_ID_STORAGE_KEY = 'velora.calls.voipInstallationId'

const getAppVersion = () => Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? undefined

const getOrCreateVoipInstallationId = async () => {
  const stored = await getValueFor(VOIP_INSTALLATION_ID_STORAGE_KEY)
  if (stored) {
    return stored
  }

  const nextInstallationId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  await save(VOIP_INSTALLATION_ID_STORAGE_KEY, nextInstallationId)
  return nextInstallationId
}

export function SystemCallProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isLoading = useAuthStore((state) => state.isLoading)
  const userId = useAuthStore((state) => state.user?.id)
  const registeredVoipTokenRef = useRef<string | null>(null)
  const lastRegisteredVoipTokenRef = useRef<string | null>(null)
  const pendingInvalidatedVoipTokenRef = useRef<string | null>(null)

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return
    }

    veloraSystemCalls.getVoipRegistrationState()
  }, [])

  useEffect(() => {
    if (isLoading) {
      return
    }

    veloraSystemCalls.setAuthenticatedUserId(isAuthenticated && userId ? userId : null)
  }, [isAuthenticated, isLoading, userId])

  useEffect(() => {
    if (Platform.OS !== 'ios' || isLoading) {
      return
    }

    let cancelled = false

    const syncVoipRegistrationState = async (state: VoipRegistrationState) => {
      if (state.invalidatedToken) {
        pendingInvalidatedVoipTokenRef.current = state.invalidatedToken
      }

      if (state.token) {
        if (!state.bundleId || !state.apnsEnvironment) {
          console.warn('[SystemCall] Missing native APNs registration context for VoIP token')
          return
        }

        if (!isAuthenticated || !userId) {
          registeredVoipTokenRef.current = null
          return
        }

        const registrationKey = `${userId}:${state.bundleId}:${state.apnsEnvironment}:${state.token}`
        if (registeredVoipTokenRef.current === registrationKey) {
          return
        }

        const installationId = await getOrCreateVoipInstallationId()
        if (cancelled) {
          return
        }

        registeredVoipTokenRef.current = registrationKey
        const appVersion = getAppVersion()

        try {
          await registerVoipPushToken({
            token: state.token,
            bundleId: state.bundleId,
            deliveryEnvironment: state.apnsEnvironment,
            deviceId: installationId,
            ...(appVersion ? { appVersion } : {}),
          })
          if (cancelled) {
            return
          }

          lastRegisteredVoipTokenRef.current = state.token
          pendingInvalidatedVoipTokenRef.current = null
        } catch {
          if (!cancelled && registeredVoipTokenRef.current === registrationKey) {
            registeredVoipTokenRef.current = null
          }
        }
        return
      }

      registeredVoipTokenRef.current = null

      const tokenToDeactivate =
        pendingInvalidatedVoipTokenRef.current ?? lastRegisteredVoipTokenRef.current

      if (!tokenToDeactivate || !isAuthenticated || !userId) {
        return
      }

      try {
        await deactivateVoipPushToken(tokenToDeactivate)
        if (cancelled) {
          return
        }

        if (pendingInvalidatedVoipTokenRef.current === tokenToDeactivate) {
          pendingInvalidatedVoipTokenRef.current = null
        }
        if (lastRegisteredVoipTokenRef.current === tokenToDeactivate) {
          lastRegisteredVoipTokenRef.current = null
        }
      } catch {
        // Keep the pending invalidation so a later auth/session change can retry.
      }
    }

    void syncVoipRegistrationState(veloraSystemCalls.getVoipRegistrationState())

    const subscription = veloraSystemCalls.addVoipTokenListener((event) => {
      void syncVoipRegistrationState(event)
    })

    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [isAuthenticated, isLoading, userId])

  return <>{children}</>
}
