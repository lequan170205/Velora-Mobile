import { MaterialIcons } from '@expo/vector-icons'
import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin'
import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { useKeyboardState } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { authApi } from '../../src/api/auth.api'
import { AuthBrandHeader } from '../../src/components/auth/AuthBrandHeader'
import { ShortFormScreen } from '../../src/components/base/ShortFormScreen'
import { GoogleIcon } from '../../src/components/ui/GoogleIcon'
import { cn } from '../../src/lib/cn'
import { resumePushTokenRegistration } from '../../src/lib/notifications/pushTokenOperationState'
import { useAuthStore } from '../../src/stores/authStore'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ email?: string }>()
  const emailInputRef = useRef<TextInput>(null)
  const passwordInputRef = useRef<TextInput>(null)
  const [email, setEmail] = useState(params.email ?? '')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [isEmailFocused, setIsEmailFocused] = useState(false)
  const [isPasswordFocused, setIsPasswordFocused] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const isKeyboardVisible = useKeyboardState((state) => state.isVisible)
  const isKeyboardInteractionActive = isEmailFocused || isPasswordFocused || isKeyboardVisible
  const { setUser } = useAuthStore()
  const router = useRouter()
  useEffect(() => {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
    })
  }, [])

  useEffect(() => {
    if (params.email) {
      setEmail(params.email)
    }
  }, [params.email])

  const handleLogin = async () => {
    try {
      setIsLoading(true)
      setError('')
      await authApi.login({ email, password })
      await resumePushTokenRegistration()
      const meResponse = await authApi.me()
      setUser(meResponse)
      router.replace('/')
    } catch (err: unknown) {
      const error = err as Error & { response?: { data?: { message?: string }; status?: number } }
      if (error?.response?.status === 403) {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`)
      } else {
        const errorMsg = error?.response?.data?.message || 'Login failed'
        setError(errorMsg)
        Alert.alert('Error', errorMsg)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true)
      setError('')
      await GoogleSignin.hasPlayServices()
      const userInfo = await GoogleSignin.signIn()

      if (userInfo.data?.idToken) {
        await authApi.verifyGoogleToken({ idToken: userInfo.data.idToken })
        await resumePushTokenRegistration()
        const meResponse = await authApi.me()
        setUser(meResponse)
        router.replace('/')
      } else {
        throw new Error('No ID token present in Google response.')
      }
    } catch (err: unknown) {
      if (isErrorWithCode(err)) {
        switch (err.code) {
          case statusCodes.SIGN_IN_CANCELLED:
            break
          case statusCodes.IN_PROGRESS:
            break
          case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
            Alert.alert('Error', 'Play services not available or outdated')
            break
          default:
            Alert.alert('Error', err.message || 'Google Sign-In failed')
        }
      } else {
        Alert.alert('Error', 'An unknown error occurred during Google Sign-In')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <View className="flex-1 bg-bg-primary">
      <ShortFormScreen
        // Focus enables the native channel before the keyboard starts moving;
        // keyboard visibility keeps it enabled until the closing animation ends.
        scrollEnabled={isKeyboardInteractionActive}
        mode="insets"
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: Math.max(insets.bottom + 48, 76),
          paddingHorizontal: 24,
          paddingTop: insets.top + 10,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View className="flex-1">
            <AuthBrandHeader />

            <View className="mt-2">
              <Text className="font-heading text-[42px] leading-[44px] tracking-[-1.2px] text-text-primary">
                Back to the <Text className="text-brand">group?</Text>
              </Text>
              <Text className="mt-2 text-base font-sans leading-6 text-text-secondary">
                Sign in and catch up.
              </Text>
            </View>

            <View className="mt-6 flex-1">
              <View className="mb-4">
                <Text className="mb-2 text-sm2 font-semibold text-text-primary">Email address</Text>
                <View
                  className={cn(
                    'h-14 flex-row items-center rounded-[20px] border bg-[#FFFBF8] px-4',
                    isEmailFocused ? 'border-brand bg-[#FFF7F2]' : 'border-[#F2DED0]',
                  )}
                >
                  <MaterialIcons name="mail-outline" size={20} color="#FF8A5B" />
                  <TextInput
                    ref={emailInputRef}
                    className="ml-3 flex-1 text-md font-sans text-text-primary"
                    placeholder="Enter your email"
                    placeholderTextColor="#9A9694"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoCorrect={false}
                    onFocus={() => {
                      setIsEmailFocused(true)
                    }}
                    onBlur={() => {
                      setIsEmailFocused(false)
                    }}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => passwordInputRef.current?.focus()}
                  />
                </View>
              </View>

              <View>
                <Text className="mb-2 text-sm2 font-semibold text-text-primary">Password</Text>
                <View
                  className={cn(
                    'h-14 flex-row items-center rounded-[20px] border bg-[#FFFBF8] px-4',
                    isPasswordFocused ? 'border-brand bg-[#FFF7F2]' : 'border-[#F2DED0]',
                  )}
                >
                  <MaterialIcons name="lock-outline" size={20} color="#FF8A5B" />
                  <TextInput
                    ref={passwordInputRef}
                    className="ml-3 flex-1 text-md font-sans text-text-primary"
                    placeholder="Enter your password"
                    placeholderTextColor="#9A9694"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCorrect={false}
                    onFocus={() => {
                      setIsPasswordFocused(true)
                    }}
                    onBlur={() => {
                      setIsPasswordFocused(false)
                    }}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                  />
                  <TouchableOpacity
                    className="h-11 w-11 items-center justify-center"
                    onPress={() => setShowPassword(!showPassword)}
                    hitSlop={6}
                  >
                    <MaterialIcons
                      name={showPassword ? 'visibility' : 'visibility-off'}
                      size={21}
                      color="#6F6C6A"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View className="mt-3 h-11 flex-row items-center">
                <View className="min-w-0 flex-1 flex-row items-center pr-3">
                  {error ? (
                    <>
                      <MaterialIcons name="error-outline" size={18} color="#FF3B30" />
                      <Text
                        className="ml-2 flex-1 text-base2 font-medium leading-5 text-status-error"
                        numberOfLines={2}
                        accessibilityRole="alert"
                        accessibilityLiveRegion="polite"
                      >
                        {error}
                      </Text>
                    </>
                  ) : null}
                </View>
                <Link href="/(auth)/forgot-password" asChild>
                  <TouchableOpacity
                    className="h-11 items-center justify-center"
                    activeOpacity={0.7}
                  >
                    <Text className="text-base2 font-semibold text-brand">Forgot password?</Text>
                  </TouchableOpacity>
                </Link>
              </View>

              <TouchableOpacity
                className="mt-5 h-14 flex-row items-center justify-center rounded-[20px] bg-brand"
                onPress={handleLogin}
                disabled={isLoading}
                activeOpacity={0.85}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text className="text-md font-bold text-white">Sign In</Text>
                )}
              </TouchableOpacity>

              <View className="my-5 flex-row items-center">
                <View className="h-px flex-1 bg-[#E8E4E1]" />
                <Text className="px-4 text-xs2 font-semibold uppercase tracking-[1px] text-text-muted">
                  OR
                </Text>
                <View className="h-px flex-1 bg-[#E8E4E1]" />
              </View>

              <TouchableOpacity
                className="h-14 flex-row items-center justify-center rounded-[20px] border border-[#CFC6FF] bg-white"
                onPress={handleGoogleLogin}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                <GoogleIcon size={23} />
                <Text className="ml-3 text-md font-semibold text-text-primary">
                  Continue with Google
                </Text>
              </TouchableOpacity>

              <View className="mt-auto flex-row items-center justify-center pt-7">
                <Text className="text-base2 font-sans text-text-secondary">
                  Don&apos;t have an account?{' '}
                </Text>
                <Link href="/(auth)/register" asChild>
                  <TouchableOpacity className="py-2" activeOpacity={0.7}>
                    <Text className="text-base2 font-semibold text-brand">Sign up</Text>
                  </TouchableOpacity>
                </Link>
              </View>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ShortFormScreen>
    </View>
  )
}
