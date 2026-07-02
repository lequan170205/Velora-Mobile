import { useRootNavigationState, useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'

import { useAuthStore } from '../stores/authStore'

import { useNetworkStatus } from './NetworkProvider'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { authHydrationError, hydrateAuth, isAuthenticated, isLoading, user } = useAuthStore()
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const segments = useSegments()
  const router = useRouter()
  const rootNavigationState = useRootNavigationState()

  useEffect(() => {
    if (isLoading || authHydrationError !== 'network' || !isNetworkResolved || !isOnline) {
      return
    }

    void hydrateAuth({ silent: true })
  }, [authHydrationError, hydrateAuth, isLoading, isNetworkResolved, isOnline])

  useEffect(() => {
    if (isLoading || !rootNavigationState?.key) return

    const inAuthGroup = segments[0] === '(auth)'
    const inCompleteProfile = segments[0] === 'complete-profile'
    const needsProfileCompletion = isAuthenticated && !user?.username?.trim()

    if (!isAuthenticated && authHydrationError !== 'network' && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (needsProfileCompletion && !inCompleteProfile) {
      router.replace('/complete-profile')
    } else if (isAuthenticated && user?.username?.trim() && (inAuthGroup || inCompleteProfile)) {
      router.replace('/')
    }
  }, [
    authHydrationError,
    isAuthenticated,
    isLoading,
    rootNavigationState?.key,
    router,
    segments,
    user?.username,
  ])

  if (
    isLoading ||
    !rootNavigationState?.key ||
    (!isAuthenticated && authHydrationError === 'network')
  ) {
    return null // or a global loading splash screen
  }

  return <>{children}</>
}
