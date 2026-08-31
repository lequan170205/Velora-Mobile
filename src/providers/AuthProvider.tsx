import { useRootNavigationState, useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'

import { reelEventQueue } from '../services/reelEventQueue'
import { useAuthStore } from '../stores/authStore'

import { useNetworkStatus } from './NetworkProvider'

function AuthLoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-bg-primary px-6">
      <ActivityIndicator color="#FF6B2C" size="large" />
      <Text className="mt-4 text-center text-base2 text-text-secondary">
        Checking your sign-in...
      </Text>
    </View>
  )
}

function AuthNetworkErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center bg-bg-primary px-6">
      <Text className="text-center text-lg font-semibold text-text-primary">
        We couldn&apos;t connect
      </Text>
      <Text className="mt-2 text-center text-base2 text-text-secondary">
        Check your connection and try again.
      </Text>
      <TouchableOpacity
        className="mt-6 rounded-full bg-brand px-5 py-3"
        onPress={onRetry}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Try to restore your session"
      >
        <Text className="font-medium text-white">Try again</Text>
      </TouchableOpacity>
    </View>
  )
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { authHydrationError, hydrateAuth, isAuthenticated, isLoading, user } = useAuthStore()
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const segments = useSegments()
  const router = useRouter()
  const rootNavigationState = useRootNavigationState()

  useEffect(() => {
    const userId = isAuthenticated ? (user?.id ?? null) : null

    void reelEventQueue.setAuthenticatedUser(userId).then(() => {
      if (userId) {
        void reelEventQueue.flush()
      }
    })
  }, [isAuthenticated, user?.id])

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

  if (isLoading || !rootNavigationState?.key) {
    return <AuthLoadingScreen />
  }

  if (!isAuthenticated && authHydrationError === 'network') {
    return <AuthNetworkErrorScreen onRetry={() => void hydrateAuth()} />
  }

  return <>{children}</>
}
