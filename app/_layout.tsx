import '../src/global.css'

import { Inter_400Regular, Inter_500Medium, useFonts } from '@expo-google-fonts/inter'
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { PaperProvider } from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { CallFeedbackNotice } from '../src/components/call/CallErrorModal'
import { FloatingActiveCallButton } from '../src/components/call/FloatingActiveCallButton'
import { paperTheme } from '../src/constants/paperTheme'
import { colors } from '../src/constants/theme'
import { useReelSavingMode } from '../src/hooks/useReelSavingMode'
import { setTemporaryReelVideoCacheUserPreferenceEnabled } from '../src/lib/offlineReelVideoCache'
import {
  runReelOfflineAppActiveMaintenance,
  runReelOfflineBackgroundMaintenance,
  runReelOfflineStartupMaintenance,
} from '../src/lib/reelOfflineMaintenance'
import { initializeReelPlaybackVideoCache } from '../src/lib/reelPlaybackVideoCache'
import { veloraSystemCalls } from '../src/lib/systemCalls/veloraSystemCalls'
import { AUTH_LOADING_FALLBACK_DELAY_MS, AuthProvider } from '../src/providers/AuthProvider'
import { CallProvider, useCall } from '../src/providers/CallProvider'
import { ChatMediaUploadProvider } from '../src/providers/ChatMediaUploadProvider'
import { ChatMediaViewerProvider } from '../src/providers/ChatMediaViewerProvider'
import { FcmDebugProvider } from '../src/providers/FcmDebugProvider'
import { IncomingCallPrewarmBridge } from '../src/providers/IncomingCallPrewarmBridge'
import { NetworkProvider } from '../src/providers/NetworkProvider'
import { PushTokenLifecycleProvider } from '../src/providers/PushTokenLifecycleProvider'
import { QueryProvider } from '../src/providers/QueryProvider'
import { SocketProvider } from '../src/providers/SocketProvider'
import { SystemCallProvider } from '../src/providers/SystemCallProvider'
import { useAuthStore } from '../src/stores/authStore'
import { useCallStore } from '../src/stores/callStore'

SplashScreen.preventAutoHideAsync()

function CallUiOverlays() {
  const { error } = useCallStore()
  const { dismissCallError } = useCall()

  return (
    <>
      <FloatingActiveCallButton />
      <CallFeedbackNotice visible={Boolean(error)} message={error} onDismiss={dismissCallError} />
    </>
  )
}

type RootAppShellProps = {
  hasPendingNativeCallIntent: boolean
}

function RootAppShell({ hasPendingNativeCallIntent }: RootAppShellProps) {
  const [loaded, error] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
  })
  const { isReelSavingModeHydrated, reelSavingModeEnabled } = useReelSavingMode()
  const [isReelPlaybackVideoCacheReady, setIsReelPlaybackVideoCacheReady] = useState(
    Platform.OS !== 'ios',
  )
  const hydrateAuth = useAuthStore((state) => state.hydrateAuth)
  const isAuthLoading = useAuthStore((state) => state.isLoading)
  const [hasAuthStartupDelayElapsed, setHasAuthStartupDelayElapsed] = useState(false)

  useEffect(() => {
    const timeoutId = setTimeout(
      () => setHasAuthStartupDelayElapsed(true),
      AUTH_LOADING_FALLBACK_DELAY_MS,
    )

    return () => clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    if (
      (loaded || error) &&
      isReelPlaybackVideoCacheReady &&
      (!isAuthLoading || hasAuthStartupDelayElapsed)
    ) {
      SplashScreen.hideAsync()
    }
  }, [error, hasAuthStartupDelayElapsed, isAuthLoading, isReelPlaybackVideoCacheReady, loaded])

  useEffect(() => {
    if (Platform.OS !== 'ios' || hasPendingNativeCallIntent) {
      setIsReelPlaybackVideoCacheReady(true)
      return undefined
    }
    let isMounted = true
    void initializeReelPlaybackVideoCache()
      .catch((error: unknown) =>
        console.warn('[ReelVideoCache] Failed to start iOS HLS cache', error),
      )
      .finally(() => {
        if (isMounted) setIsReelPlaybackVideoCacheReady(true)
      })
    return () => {
      isMounted = false
    }
  }, [hasPendingNativeCallIntent])

  useEffect(() => {
    hydrateAuth()
  }, [hydrateAuth])

  useEffect(() => {
    setTemporaryReelVideoCacheUserPreferenceEnabled(
      isReelSavingModeHydrated ? reelSavingModeEnabled : false,
    )
  }, [isReelSavingModeHydrated, reelSavingModeEnabled])

  useEffect(() => {
    if (hasPendingNativeCallIntent) return undefined
    void runReelOfflineStartupMaintenance().catch(() => undefined)
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void runReelOfflineAppActiveMaintenance().catch(() => undefined)
        return
      }
      if (nextState === 'background' || nextState === 'inactive') {
        void runReelOfflineBackgroundMaintenance().catch(() => undefined)
      }
    })
    return () => subscription.remove()
  }, [hasPendingNativeCallIntent])

  return (
    <GestureHandlerRootView className="flex-1 bg-bg-primary">
      <StatusBar style="dark" />
      <SafeAreaProvider>
        <PaperProvider theme={paperTheme}>
          <KeyboardProvider>
            <BottomSheetModalProvider>
              <QueryProvider>
                <NetworkProvider>
                  <AuthProvider>
                    <CallProvider>
                      <PushTokenLifecycleProvider>
                        <SystemCallProvider>
                          <FcmDebugProvider>
                            <SocketProvider>
                              <ChatMediaUploadProvider>
                                <ChatMediaViewerProvider>
                                  <Stack
                                    screenOptions={{
                                      headerShown: false,
                                      contentStyle: { backgroundColor: colors.bg.secondary },
                                      freezeOnBlur: true,
                                    }}
                                  >
                                    <Stack.Screen name="(tabs)" />
                                    <Stack.Screen name="(auth)" />
                                    <Stack.Screen
                                      name="reels/[id]/index"
                                      options={{
                                        animation: 'slide_from_right',
                                        animationDuration: 220,
                                        freezeOnBlur: false,
                                      }}
                                    />
                                    <Stack.Screen
                                      name="conversation/[id]"
                                      options={{
                                        animation: 'slide_from_right',
                                        animationDuration: 250,
                                      }}
                                    />
                                    <Stack.Screen
                                      name="conversation/new-group"
                                      options={{
                                        animation: 'slide_from_right',
                                        animationDuration: 250,
                                      }}
                                    />
                                    <Stack.Screen
                                      name="conversation/[id]/info"
                                      options={{
                                        animation: 'slide_from_right',
                                        animationDuration: 250,
                                      }}
                                    />
                                    <Stack.Screen
                                      name="reels/create"
                                      options={{ presentation: 'fullScreenModal' }}
                                    />
                                    <Stack.Screen
                                      name="call/[id]"
                                      options={{
                                        presentation: 'fullScreenModal',
                                        animation: 'slide_from_bottom',
                                        animationDuration: 220,
                                      }}
                                    />
                                  </Stack>
                                  <CallUiOverlays />
                                </ChatMediaViewerProvider>
                              </ChatMediaUploadProvider>
                            </SocketProvider>
                          </FcmDebugProvider>
                        </SystemCallProvider>
                      </PushTokenLifecycleProvider>
                    </CallProvider>
                  </AuthProvider>
                </NetworkProvider>
              </QueryProvider>
            </BottomSheetModalProvider>
          </KeyboardProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

export default function RootLayout() {
  const [hasPendingNativeCallIntent, setHasPendingNativeCallIntent] = useState(() =>
    Boolean(veloraSystemCalls.getPendingCallAction()),
  )

  // This bridge deliberately renders before RootAppShell. Its auth/socket
  // prewarm effect is therefore registered before font and Reels work start.
  return (
    <>
      <IncomingCallPrewarmBridge onPendingCallIntentChange={setHasPendingNativeCallIntent} />
      <RootAppShell hasPendingNativeCallIntent={hasPendingNativeCallIntent} />
    </>
  )
}
