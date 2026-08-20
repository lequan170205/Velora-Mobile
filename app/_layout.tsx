import '../src/global.css'

import { MaterialIcons } from '@expo/vector-icons'
import { Inter_400Regular, Inter_500Medium, useFonts } from '@expo-google-fonts/inter'
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { useQueryClient } from '@tanstack/react-query'
import { Stack, usePathname, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useMemo, useState } from 'react'
import { AppState, Platform, Text, TouchableOpacity, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { PaperProvider } from 'react-native-paper'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

import { CallErrorModal } from '../src/components/call/CallErrorModal'
import { paperTheme } from '../src/constants/paperTheme'
import { queryKeys } from '../src/constants/queryKeys'
import { colors } from '../src/constants/theme'
import { useReelSavingMode } from '../src/hooks/useReelSavingMode'
import { setTemporaryReelVideoCacheUserPreferenceEnabled } from '../src/lib/offlineReelVideoCache'
import {
  runReelOfflineAppActiveMaintenance,
  runReelOfflineBackgroundMaintenance,
  runReelOfflineStartupMaintenance,
} from '../src/lib/reelOfflineMaintenance'
import { initializeReelPlaybackVideoCache } from '../src/lib/reelPlaybackVideoCache'
import { AuthProvider } from '../src/providers/AuthProvider'
import { CallProvider, useCall } from '../src/providers/CallProvider'
import { ChatMediaUploadProvider } from '../src/providers/ChatMediaUploadProvider'
import { ChatMediaViewerProvider } from '../src/providers/ChatMediaViewerProvider'
import { FcmDebugProvider } from '../src/providers/FcmDebugProvider'
import { NetworkProvider } from '../src/providers/NetworkProvider'
import { PushTokenLifecycleProvider } from '../src/providers/PushTokenLifecycleProvider'
import { QueryProvider } from '../src/providers/QueryProvider'
import { SocketProvider } from '../src/providers/SocketProvider'
import { SystemCallProvider } from '../src/providers/SystemCallProvider'
import { useAuthStore } from '../src/stores/authStore'
import { useCallStore } from '../src/stores/callStore'

import type { Conversation } from '../src/types/conversation.types'

SplashScreen.preventAutoHideAsync()

const getConversationList = (value: unknown): Conversation[] => {
  if (Array.isArray(value)) return value as Conversation[]
  return ((value as { pages?: Conversation[][] } | undefined)?.pages?.flat() ?? []) as Conversation[]
}

function ConversationVideoCallShortcut() {
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const { startVideoCall } = useCall()
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const phase = useCallStore((state) => state.phase)
  const [cacheVersion, setCacheVersion] = useState(0)

  useEffect(() => {
    return queryClient.getQueryCache().subscribe(() => {
      setCacheVersion((value) => value + 1)
    })
  }, [queryClient])

  const conversationId = useMemo(() => {
    const match = pathname.match(/^\/conversation\/([^/]+)$/)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  }, [pathname])

  const conversation = useMemo(() => {
    if (!conversationId) return null
    const conversations = getConversationList(
      queryClient.getQueryData<unknown>(queryKeys.conversations.all),
    )
    return conversations.find((entry) => entry.id === conversationId) ?? null
  }, [cacheVersion, conversationId, queryClient])

  if (!conversationId || !conversation || conversation.isGroup || phase !== 'idle' || !userId) {
    return null
  }

  const peer = conversation.participants?.find((participant) => participant.id !== userId)
  if (!peer?.id) return null
  const peerName = peer.name || peer.fullName || peer.email || 'Unknown'

  return (
    <TouchableOpacity
      style={{ top: insets.top + 10, right: 70 }}
      className="absolute z-[9998] h-11 w-11 items-center justify-center rounded-full bg-surface-input"
      activeOpacity={0.78}
      accessibilityRole="button"
      accessibilityLabel={`Video call ${peerName}`}
      onPress={() => {
        void startVideoCall({
          conversationId,
          peerUserId: peer.id,
          peerName,
          ...(peer.picture ? { peerAvatarUrl: peer.picture } : {}),
        })
      }}
    >
      <MaterialIcons name="videocam" size={22} color="#161616" />
    </TouchableOpacity>
  )
}

function ActiveCallBanner() {
  const { phase, durationSec, callId, reconnectDeadlineMs, callType } = useCallStore()
  const pathname = usePathname()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [nowMs, setNowMs] = useState(Date.now())

  useEffect(() => {
    if (phase !== 'reconnecting' || !reconnectDeadlineMs) return
    setNowMs(Date.now())
    const intervalId = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(intervalId)
  }, [phase, reconnectDeadlineMs])

  if ((phase !== 'active' && phase !== 'reconnecting') || !callId || pathname.startsWith('/call/')) {
    return null
  }

  const formatDuration = (secs: number) => {
    const minutes = Math.floor(secs / 60)
    const seconds = secs % 60
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
  }

  const reconnectSecondsLeft =
    reconnectDeadlineMs && phase === 'reconnecting'
      ? Math.max(0, Math.ceil((reconnectDeadlineMs - nowMs) / 1000))
      : null

  return (
    <TouchableOpacity
      style={{
        bottom: Platform.OS === 'ios' ? insets.bottom + 64 : insets.bottom > 0 ? insets.bottom + 84 : 90,
      }}
      className="absolute left-5 right-5 z-[9999] flex-row items-center justify-between rounded-xl border border-call-green bg-surface-card px-4 py-3"
      activeOpacity={0.9}
      onPress={() => router.push(`/call/${callId}` as never)}
    >
      <View className="flex-row items-center gap-3">
        <View className="h-7 w-7 items-center justify-center rounded-full bg-call-green">
          <MaterialIcons name={callType === 'VIDEO' ? 'videocam' : 'call'} size={16} color="#ffffff" />
        </View>
        <Text className="text-md font-medium text-text-primary">
          {phase === 'reconnecting'
            ? 'Reconnecting...'
            : callType === 'VIDEO'
              ? 'Video call in progress...'
              : 'Call in progress...'}
        </Text>
      </View>
      <Text className="text-md font-semibold text-call-green">
        {phase === 'reconnecting' && reconnectSecondsLeft !== null
          ? `${reconnectSecondsLeft}s`
          : formatDuration(durationSec)}
      </Text>
    </TouchableOpacity>
  )
}

function CallUiOverlays() {
  const { error } = useCallStore()
  const { dismissCallError } = useCall()

  return (
    <>
      <CallErrorModal visible={Boolean(error)} message={error} onDismiss={dismissCallError} />
      <ConversationVideoCallShortcut />
      <ActiveCallBanner />
    </>
  )
}

export default function RootLayout() {
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

  useEffect(() => {
    if ((loaded || error) && isReelPlaybackVideoCacheReady) {
      SplashScreen.hideAsync()
    }
  }, [error, isReelPlaybackVideoCacheReady, loaded])

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined
    let isMounted = true
    void initializeReelPlaybackVideoCache()
      .catch((error: unknown) => console.warn('[ReelVideoCache] Failed to start iOS HLS cache', error))
      .finally(() => {
        if (isMounted) setIsReelPlaybackVideoCacheReady(true)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const hydrateAuth = useAuthStore((state) => state.hydrateAuth)

  useEffect(() => {
    hydrateAuth()
  }, [hydrateAuth])

  useEffect(() => {
    setTemporaryReelVideoCacheUserPreferenceEnabled(
      isReelSavingModeHydrated ? reelSavingModeEnabled : false,
    )
  }, [isReelSavingModeHydrated, reelSavingModeEnabled])

  useEffect(() => {
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
  }, [])

  if ((!loaded && !error) || !isReelPlaybackVideoCacheReady) return null

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
                    <PushTokenLifecycleProvider>
                      <SystemCallProvider>
                        <FcmDebugProvider>
                          <SocketProvider>
                            <CallProvider>
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
                                      options={{ animation: 'slide_from_right', animationDuration: 220, freezeOnBlur: false }}
                                    />
                                    <Stack.Screen
                                      name="conversation/[id]"
                                      options={{ animation: 'slide_from_right', animationDuration: 250 }}
                                    />
                                    <Stack.Screen
                                      name="conversation/new-group"
                                      options={{ animation: 'slide_from_right', animationDuration: 250 }}
                                    />
                                    <Stack.Screen
                                      name="conversation/[id]/info"
                                      options={{ animation: 'slide_from_right', animationDuration: 250 }}
                                    />
                                    <Stack.Screen name="reels/create" options={{ presentation: 'fullScreenModal' }} />
                                    <Stack.Screen name="call/[id]" options={{ presentation: 'fullScreenModal' }} />
                                  </Stack>
                                  <CallUiOverlays />
                                </ChatMediaViewerProvider>
                              </ChatMediaUploadProvider>
                            </CallProvider>
                          </SocketProvider>
                        </FcmDebugProvider>
                      </SystemCallProvider>
                    </PushTokenLifecycleProvider>
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
