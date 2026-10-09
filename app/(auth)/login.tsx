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
  Keyboard,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { useKeyboardState } from 'react-native-keyboard-controller'
import Animated, { Easing, FadeIn, FadeInDown, ReduceMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { authApi } from '../../src/api/auth.api'
import { AuthBrandHeader } from '../../src/components/auth/AuthBrandHeader'
import { AuthField } from '../../src/components/auth/AuthField'
import { AuthHeadline } from '../../src/components/auth/AuthHeadline'
import { AuthPrimaryButton } from '../../src/components/auth/AuthPrimaryButton'
import { AppPressable } from '../../src/components/base/AppPressable'
import { ShortFormScreen } from '../../src/components/base/ShortFormScreen'
import { GoogleIcon } from '../../src/components/ui/GoogleIcon'
import { colors } from '../../src/constants/theme'
import { resumePushTokenRegistration } from '../../src/lib/notifications/pushTokenOperationState'
import { useAuthStore } from '../../src/stores/authStore'

import type { TextInput } from 'react-native'

// Auth surfaces sit at MOTION 2-3: one quiet entrance cascade, reduced-motion aware.
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1)
const HEADLINE_ENTERING = FadeInDown.duration(260)
  .delay(80)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System)
const FORM_ENTERING = FadeInDown.duration(240)
  .delay(160)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System)
const ERROR_ENTERING = FadeIn.duration(170).easing(EASE_OUT).reduceMotion(ReduceMotion.System)

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ email?: string }>()
  const emailInputRef = useRef<TextInput>(null)
  const passwordInputRef = useRef<TextInput>(null)
  const [email, setEmail] = useState(params.email ?? '')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
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
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    try {
      setIsGoogleLoading(true)
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
            setError('Google Play services is not available. Please try again.')
            break
          default:
            setError(err.message || 'Google Sign-In failed. Please try again.')
        }
      } else {
        setError('Google Sign-In failed. Please try again.')
      }
    } finally {
      setIsGoogleLoading(false)
    }
  }

  return (
    <View className="flex-1 bg-surface-cream">
      <ShortFormScreen
        // Focus enables the native channel before the keyboard starts moving;
        // keyboard visibility keeps it enabled until the closing animation ends.
        scrollEnabled={isKeyboardInteractionActive ? true : undefined}
        mode="insets"
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: Math.max(insets.bottom + 24, 40),
          paddingHorizontal: 24,
          paddingTop: insets.top + 8,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View className="flex-1">
            <AuthBrandHeader compact />

            <Animated.View entering={HEADLINE_ENTERING} className="mt-2">
              <AuthHeadline size="hero" title="Back to the group?" />
              <Text className="mt-2.5 text-base font-sans leading-6 text-text-secondary">
                Sign in and catch up.
              </Text>
            </Animated.View>

            <Animated.View entering={FORM_ENTERING} className="flex-1 mt-5">
              <View className="mb-3">
                <AuthField
                  ref={emailInputRef}
                  label="Email address"
                  icon="mail-outline"
                  accessibilityLabel="Email address"
                  placeholder="Enter your email"
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

              <AuthField
                ref={passwordInputRef}
                label="Password"
                icon="lock-outline"
                accessibilityLabel="Password"
                placeholder="Enter your password"
                value={password}
                onChangeText={setPassword}
                autoCorrect={false}
                secureTextEntry={!showPassword}
                onToggleSecure={() => setShowPassword(!showPassword)}
                onFocus={() => {
                  setIsPasswordFocused(true)
                }}
                onBlur={() => {
                  setIsPasswordFocused(false)
                }}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />

              <View className="mt-3 h-11 flex-row items-center">
                <View className="min-w-0 flex-1 flex-row items-center pr-3">
                  {error ? (
                    <Animated.View
                      entering={ERROR_ENTERING}
                      className="flex-1 flex-row items-center"
                    >
                      <MaterialIcons name="error-outline" size={18} color={colors.status.error} />
                      <Text
                        className="ml-2 flex-1 text-base2 font-medium leading-5 text-status-error-text"
                        numberOfLines={2}
                        accessibilityRole="alert"
                        accessibilityLiveRegion="polite"
                      >
                        {error}
                      </Text>
                    </Animated.View>
                  ) : null}
                </View>
                <Link href="/(auth)/forgot-password" asChild>
                  <TouchableOpacity
                    className="h-11 items-center justify-center"
                    activeOpacity={0.7}
                  >
                    <Text className="text-base2 font-semibold text-brand-text">
                      Forgot password?
                    </Text>
                  </TouchableOpacity>
                </Link>
              </View>

              {/* Action stack anchors to the bottom: slack space collects
                  between the form fields and Sign In, keeping CTA + OR +
                  Google + the sign-up footer together as one group. */}
              <View className="mt-auto pt-4">
                <AuthPrimaryButton
                  label="Sign in"
                  onPress={handleLogin}
                  disabled={isGoogleLoading}
                  isLoading={isLoading}
                />
              </View>

              <View className="mt-4 mb-4 flex-row items-center">
                <View className="h-px flex-1 bg-border-default" />
                <Text className="px-4 text-xs2 font-semibold uppercase tracking-[1px] text-text-secondary">
                  OR
                </Text>
                <View className="h-px flex-1 bg-border-default" />
              </View>

              <AppPressable
                className="flex-row items-center justify-center rounded-full border border-border-warm-soft bg-white px-4 min-h-14 py-3"
                onPress={handleGoogleLogin}
                disabled={isLoading || isGoogleLoading}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Continue with Google"
                accessibilityState={{
                  disabled: isLoading || isGoogleLoading,
                  busy: isGoogleLoading,
                }}
              >
                {isGoogleLoading ? (
                  <>
                    <ActivityIndicator size="small" color={colors.brand.primary} />
                    <Text
                      className="ml-3 text-center text-md font-semibold text-text-secondary"
                      style={{ flexShrink: 1 }}
                    >
                      Continue with Google
                    </Text>
                  </>
                ) : (
                  <>
                    <GoogleIcon size={23} />
                    <Text
                      className="ml-3 text-center text-md font-semibold text-text-primary"
                      style={{ flexShrink: 1 }}
                    >
                      Continue with Google
                    </Text>
                  </>
                )}
              </AppPressable>

              <View className="flex-row flex-wrap items-center justify-center pt-3">
                <Text
                  className="text-center text-base2 font-sans text-text-secondary"
                  style={{ flexShrink: 1 }}
                >
                  Don&apos;t have an account?
                </Text>
                <Link href="/(auth)/register" asChild>
                  <TouchableOpacity className="ml-1 py-2" activeOpacity={0.7}>
                    <Text className="text-base2 font-semibold text-brand-text">Sign up</Text>
                  </TouchableOpacity>
                </Link>
              </View>
            </Animated.View>
          </View>
        </TouchableWithoutFeedback>
      </ShortFormScreen>
    </View>
  )
}
