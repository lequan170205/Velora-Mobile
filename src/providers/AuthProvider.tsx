import { useRootNavigationState, useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'

import { useAuthStore } from '../stores/authStore'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuthStore()
  const segments = useSegments()
  const router = useRouter()
  const rootNavigationState = useRootNavigationState()

  useEffect(() => {
    if (isLoading || !rootNavigationState?.key) return

    const inAuthGroup = segments[0] === '(auth)'
    const inCompleteProfile = segments[0] === 'complete-profile'
    const needsProfileCompletion = isAuthenticated && !user?.username?.trim()

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (needsProfileCompletion && !inCompleteProfile) {
      router.replace('/complete-profile')
    } else if (isAuthenticated && user?.username?.trim() && (inAuthGroup || inCompleteProfile)) {
      router.replace('/')
    }
  }, [isAuthenticated, isLoading, rootNavigationState?.key, router, segments, user?.username])

  if (isLoading || !rootNavigationState?.key) {
    return null // or a global loading splash screen
  }

  return <>{children}</>
}
