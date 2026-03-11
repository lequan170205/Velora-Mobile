import { useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'

import { useAuthStore } from '../stores/authStore'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return

    const inAuthGroup = segments[0] === '(auth)'

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/')
    }
  }, [isAuthenticated, isLoading, segments, router])

  if (isLoading) {
    return null // or a global loading splash screen
  }

  return <>{children}</>
}
