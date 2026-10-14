import { useRootNavigationState, useRouter, useSegments } from 'expo-router'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native'

import { colors } from '../constants/theme'
import {
  beginLocalReelPlaybackAuthBoundary,
  cleanupExpiredLocalReelPlayback,
  revokeLocalReelPlaybackForOwner,
} from '../lib/localReelPlayback'
import { reelEventQueue } from '../services/reelEventQueue'
import { useAuthStore } from '../stores/authStore'

import { useNetworkStatus } from './NetworkProvider'

export const AUTH_LOADING_FALLBACK_DELAY_MS = 400

function AuthLoadingScreen({ showProgress }: { showProgress: boolean }) {
  return (
    <View className="flex-1 items-center justify-center bg-bg-primary px-6">
      <Image
        source={require('../../assets/images/splash-icon.png')}
        className="h-40 w-40"
        resizeMode="contain"
        accessible={false}
      />
      {showProgress ? (
        <View
          className="mt-8 items-center"
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Checking your sign-in"
          accessibilityState={{ busy: true }}
        >
          <ActivityIndicator color={colors.brand.primary} size="large" />
          <Text className="font-sans mt-4 text-center text-base2 text-text-secondary">
            Checking your sign-in...
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function AuthNetworkErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center bg-bg-primary px-6">
      <Text className="text-center text-lg font-semibold text-text-primary">
        We couldn&apos;t connect
      </Text>
      <Text className="font-sans mt-2 text-center text-base2 text-text-secondary">
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

export function AuthProvider({
  areFontsReady,
  children,
}: {
  // Android keeps text measured with the fallback font after the custom fonts
  // arrive and clips it on the next redraw, so the app mounts only once they
  // are ready. Gating the screens instead would mount nested navigators late,
  // which leaves useSegments empty and skips the sign-in redirect below.
  areFontsReady: boolean
  children: React.ReactNode
}) {
  const { authHydrationError, hydrateAuth, isAuthenticated, isLoading, user } = useAuthStore()
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const segments = useSegments()
  const router = useRouter()
  const rootNavigationState = useRootNavigationState()
  const isAuthPending = isLoading || !rootNavigationState?.key
  const [hasAuthLoadingDelayElapsed, setHasAuthLoadingDelayElapsed] = useState(false)
  const previousAuthUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isAuthPending) {
      setHasAuthLoadingDelayElapsed(false)
      return undefined
    }

    const timeoutId = setTimeout(
      () => setHasAuthLoadingDelayElapsed(true),
      AUTH_LOADING_FALLBACK_DELAY_MS,
    )

    return () => clearTimeout(timeoutId)
  }, [isAuthPending])

  useEffect(() => {
    const userId = isAuthenticated ? (user?.id ?? null) : null

    void reelEventQueue.setAuthenticatedUser(userId).then(() => {
      if (userId) {
        void reelEventQueue.flush()
      }
    })
  }, [isAuthenticated, user?.id])

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return
    const ownerId = user.id
    const timer = setInterval(
      () => {
        void cleanupExpiredLocalReelPlayback(ownerId)
      },
      60 * 60 * 1000,
    )
    return () => clearInterval(timer)
  }, [isAuthenticated, user?.id])

  useLayoutEffect(() => {
    const currentUserId = isAuthenticated ? (user?.id ?? null) : null
    const previousUserId = previousAuthUserIdRef.current

    if (previousUserId !== currentUserId) {
      beginLocalReelPlaybackAuthBoundary(currentUserId)
    }

    if (previousUserId && previousUserId !== currentUserId) {
      void revokeLocalReelPlaybackForOwner(previousUserId)
    }

    if (currentUserId) {
      void cleanupExpiredLocalReelPlayback(currentUserId)
    }

    previousAuthUserIdRef.current = currentUserId
  }, [isAuthenticated, user?.id])

  useEffect(() => {
    if (isLoading || authHydrationError !== 'network' || !isNetworkResolved || !isOnline) {
      return
    }

    void hydrateAuth({ silent: true })
  }, [authHydrationError, hydrateAuth, isLoading, isNetworkResolved, isOnline])

  useEffect(() => {
    // Expo Router can expose the root navigation key one render before the
    // nested Stack has resolved its first route. Redirecting during that
    // window throws "Attempted to navigate before mounting the Root Layout"
    // on a cold start (especially on a fresh simulator). Wait for the first
    // segment so the navigator is mounted before issuing a redirect. The
    // navigator also stays unmounted until the fonts are ready (see below);
    // a replace before that is handled by Expo Router's internal root stack,
    // which remounts this whole provider tree.
    if (isLoading || !areFontsReady || !rootNavigationState?.key || !segments[0]) return

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
    areFontsReady,
    authHydrationError,
    isAuthenticated,
    isLoading,
    rootNavigationState?.key,
    router,
    segments,
    user?.username,
  ])

  if (isAuthPending || !areFontsReady) {
    return <AuthLoadingScreen showProgress={hasAuthLoadingDelayElapsed && areFontsReady} />
  }

  if (!isAuthenticated && authHydrationError === 'network') {
    return <AuthNetworkErrorScreen onRetry={() => void hydrateAuth()} />
  }

  return <>{children}</>
}
