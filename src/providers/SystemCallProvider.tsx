import Constants from 'expo-constants'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'

import { deactivateVoipPushToken, registerVoipPushToken } from '../api/notification.api'
import {
  getOrCreatePushTokenInstallationId,
  isPushTokenRegistrationBlocked,
  nextPushTokenLifecycleVersion,
} from '../lib/notifications/pushTokenOperationState'
import { veloraSystemCalls, type VoipRegistrationState } from '../lib/systemCalls/veloraSystemCalls'
import { useAuthStore } from '../stores/authStore'

import { useNetworkStatus } from './NetworkProvider'

const getAppVersion = () => Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? undefined
const VOIP_REGISTRATION_RETRY_INITIAL_DELAY_MS = 5_000
const VOIP_REGISTRATION_RETRY_MAX_DELAY_MS = 60_000

export function SystemCallProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isLoading = useAuthStore((state) => state.isLoading)
  const userId = useAuthStore((state) => state.user?.id)
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const registeredVoipTokenRef = useRef<string | null>(null)
  const lastRegisteredVoipTokenRef = useRef<string | null>(null)
  const pendingInvalidatedVoipTokenRef = useRef<string | null>(null)
  const registrationRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const registrationRetryAttemptsRef = useRef(0)
  const [registrationRetryVersion, setRegistrationRetryVersion] = useState(0)

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
    if (Platform.OS !== 'ios' || isLoading || !isNetworkResolved || !isOnline) {
      return
    }

    let cancelled = false
    const scheduleRegistrationRetry = () => {
      if (cancelled || registrationRetryTimeoutRef.current) {
        return null
      }

      const retryDelayMs = Math.min(
        VOIP_REGISTRATION_RETRY_INITIAL_DELAY_MS * 2 ** registrationRetryAttemptsRef.current,
        VOIP_REGISTRATION_RETRY_MAX_DELAY_MS,
      )
      registrationRetryAttemptsRef.current += 1
      registrationRetryTimeoutRef.current = setTimeout(() => {
        registrationRetryTimeoutRef.current = null
        setRegistrationRetryVersion((version) => version + 1)
      }, retryDelayMs)

      return retryDelayMs
    }

    const deactivatePendingInvalidatedVoipToken = async () => {
      const tokenToDeactivate = pendingInvalidatedVoipTokenRef.current

      if (!tokenToDeactivate || !isAuthenticated || !userId) {
        return true
      }

      try {
        const deviceId = await getOrCreatePushTokenInstallationId()
        const lifecycleVersion = await nextPushTokenLifecycleVersion()
        await deactivateVoipPushToken({ token: tokenToDeactivate, deviceId, lifecycleVersion })

        if (pendingInvalidatedVoipTokenRef.current === tokenToDeactivate) {
          pendingInvalidatedVoipTokenRef.current = null
        }
        if (lastRegisteredVoipTokenRef.current === tokenToDeactivate) {
          lastRegisteredVoipTokenRef.current = null
        }
        registrationRetryAttemptsRef.current = 0
        return true
      } catch (error) {
        // Keep the pending invalidation so a later retry can deactivate the stale token.
        const retryDelayMs = scheduleRegistrationRetry()
        console.warn('[SystemCall] Failed to deactivate VoIP push token; retrying', {
          error,
          retryDelayMs,
        })
        return false
      }
    }

    const syncVoipRegistrationState = async (state: VoipRegistrationState) => {
      if (state.invalidatedToken) {
        pendingInvalidatedVoipTokenRef.current = state.invalidatedToken
      }

      // PushKit can invalidate a token and issue its replacement in separate
      // callbacks. Deactivate the old value first; otherwise a successful
      // replacement registration used to clear this pending cleanup silently.
      if (!(await deactivatePendingInvalidatedVoipToken())) {
        return
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

        const installationId = await getOrCreatePushTokenInstallationId()
        const lifecycleVersion = await nextPushTokenLifecycleVersion()
        if (cancelled || (await isPushTokenRegistrationBlocked())) {
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
            lifecycleVersion,
            ...(appVersion ? { appVersion } : {}),
          })
          if (cancelled) {
            return
          }

          lastRegisteredVoipTokenRef.current = state.token
          registrationRetryAttemptsRef.current = 0
        } catch (error) {
          if (!cancelled && registeredVoipTokenRef.current === registrationKey) {
            registeredVoipTokenRef.current = null
            const retryDelayMs = scheduleRegistrationRetry()
            console.warn('[SystemCall] Failed to register VoIP push token; retrying', {
              error,
              retryDelayMs,
            })
          }
        }
        return
      }

      registeredVoipTokenRef.current = null

      const tokenToDeactivate = lastRegisteredVoipTokenRef.current
      if (!tokenToDeactivate || !isAuthenticated || !userId) {
        return
      }

      pendingInvalidatedVoipTokenRef.current = tokenToDeactivate
      await deactivatePendingInvalidatedVoipToken()
    }

    void syncVoipRegistrationState(veloraSystemCalls.getVoipRegistrationState())

    const subscription = veloraSystemCalls.addVoipTokenListener((event) => {
      void syncVoipRegistrationState(event)
    })

    return () => {
      cancelled = true
      subscription.remove()

      if (registrationRetryTimeoutRef.current) {
        clearTimeout(registrationRetryTimeoutRef.current)
        registrationRetryTimeoutRef.current = null
      }
    }
  }, [isAuthenticated, isLoading, isNetworkResolved, isOnline, registrationRetryVersion, userId])

  return <>{children}</>
}
