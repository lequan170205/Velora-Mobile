import '../src/global.css'

import { MaterialIcons } from '@expo/vector-icons'
import { Inter_400Regular, Inter_500Medium, useFonts } from '@expo-google-fonts/inter'
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { Stack, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { Platform, Text, TouchableOpacity, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { PaperProvider } from 'react-native-paper'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

import { paperTheme } from '../src/constants/paperTheme'
import { colors } from '../src/constants/theme'
import { AuthProvider } from '../src/providers/AuthProvider'
import { ChatMediaUploadProvider } from '../src/providers/ChatMediaUploadProvider'
import { QueryProvider } from '../src/providers/QueryProvider'
import { SocketProvider } from '../src/providers/SocketProvider'
import { useAuthStore } from '../src/stores/authStore'
import { useCallStore } from '../src/stores/callStore'

SplashScreen.preventAutoHideAsync()

function ActiveCallBanner() {
  const { isActive, duration, callId } = useCallStore()
  const router = useRouter()
  const insets = useSafeAreaInsets()

  if (!isActive) return null

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  return (
    <TouchableOpacity
      // NativeWind limitation: kept as inline — runtime computed from safe area insets
      style={{
        bottom:
          Platform.OS === 'ios' ? insets.bottom + 64 : insets.bottom > 0 ? insets.bottom + 84 : 90,
      }}
      className="absolute left-5 right-5 flex-row items-center justify-between px-4 py-3 bg-surface-card border border-call-green rounded-xl z-[9999]"
      activeOpacity={0.9}
      onPress={() => {
        if (callId) router.push(`/call/${callId}` as never)
      }}
    >
      <View className="flex-row items-center gap-3">
        <View className="w-7 h-7 rounded-full bg-call-green items-center justify-center">
          <MaterialIcons name="call" size={16} color="#ffffff" />
        </View>
        <Text className="text-text-primary font-medium text-md">Cuộc gọi đang diễn ra...</Text>
      </View>
      <Text className="text-call-green font-semibold text-md">{formatDuration(duration)}</Text>
    </TouchableOpacity>
  )
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
  })

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync()
    }
  }, [loaded, error])

  const hydrateAuth = useAuthStore((s) => s.hydrateAuth)

  useEffect(() => {
    hydrateAuth()
  }, [hydrateAuth])

  if (!loaded && !error) {
    return null
  }

  return (
    <GestureHandlerRootView className="flex-1 bg-bg-primary">
      <StatusBar style="dark" />
      <SafeAreaProvider>
        <PaperProvider theme={paperTheme}>
          <KeyboardProvider>
            <BottomSheetModalProvider>
              <QueryProvider>
                <AuthProvider>
                  <SocketProvider>
                    <ChatMediaUploadProvider>
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
                          name="reels/[id]"
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
                        <Stack.Screen name="reels/create" options={{ presentation: 'modal' }} />
                        <Stack.Screen
                          name="call/[id]"
                          options={{ presentation: 'fullScreenModal' }}
                        />
                      </Stack>

                      <ActiveCallBanner />
                    </ChatMediaUploadProvider>
                  </SocketProvider>
                </AuthProvider>
              </QueryProvider>
            </BottomSheetModalProvider>
          </KeyboardProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
