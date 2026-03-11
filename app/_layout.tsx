import { Inter_400Regular, Inter_500Medium, useFonts } from '@expo-google-fonts/inter'
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'

import { colors } from '../src/constants/theme'
import { AuthProvider } from '../src/providers/AuthProvider'
import { QueryProvider } from '../src/providers/QueryProvider'
import { SocketProvider } from '../src/providers/SocketProvider'
import { useAuthStore } from '../src/stores/authStore'

SplashScreen.preventAutoHideAsync()

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
    // eslint-disable-next-line react-native/no-inline-styles
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg.primary }}>
      <KeyboardProvider>
        <BottomSheetModalProvider>
          <QueryProvider>
            <AuthProvider>
              <SocketProvider>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.bg.primary },
                  }}
                >
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                  <Stack.Screen name="conversation/[id]" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="call/[id]"
                    options={{ presentation: 'fullScreenModal', headerShown: false }}
                  />
                </Stack>
              </SocketProvider>
            </AuthProvider>
          </QueryProvider>
        </BottomSheetModalProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
