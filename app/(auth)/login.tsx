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
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from 'react-native'
import { useKeyboardState } from 'react-native-keyboard-controller'
import Animated, { Easing, FadeIn, FadeInDown, ReduceMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { authApi } from '../../src/api/auth.api'
import { AuthBrandHeader } from '../../src/components/auth/AuthBrandHeader'
import { AppPressable } from '../../src/components/base/AppPressable'
import { ShortFormScreen } from '../../src/components/base/ShortFormScreen'
import { GoogleIcon } from '../../src/components/ui/GoogleIcon'
import { colors, shadows } from '../../src/constants/theme'
import { cn } from '../../src/lib/cn'
import { resumePushTokenRegistration } from '../../src/lib/notifications/pushTokenOperationState'
import { useAuthStore } from '../../src/stores/authStore'

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
  const { fontScale, height: windowHeight } = useWindowDimensions()
  const isCompactLayout = windowHeight - insets.top - insets.bottom < 820 || fontScale > 1.1
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
            setError('Google Play services is not available. Please try again.')
            break
          default:
            setError(err.message || 'Google Sign-In failed. Please try again.')
        }
      } else {
        setError('Google Sign-In failed. Please try again.')
      }
    } finally {
      setIsLoading(false)
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
          paddingBottom: isCompactLayout
            ? Math.max(insets.bottom + 12, 32)
            : Math.max(insets.bottom + 48, 76),
          paddingHorizontal: 24,
          paddingTop: insets.top + (isCompactLayout ? 4 : 18),
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View className="flex-1">
            <AuthBrandHeader compact={isCompactLayout} />

            <Animated.View entering={HEADLINE_ENTERING} className="mt-3">
              <Text
                className={cn(
                  'w-full font-heading text-text-primary',
                  isCompactLayout
                    ? 'text-[38px] leading-[41px] tracking-[-1.05px]'
                    : 'text-[44px] leading-[48px] tracking-[-1.2px]',
                )}
              >
                Back to the group?
              </Text>
              <Text className="mt-2.5 text-base font-sans leading-6 text-text-secondary">
                Sign in and catch up.
              </Text>
            </Animated.View>

            <Animated.View
              entering={FORM_ENTERING}
              className={cn('flex-1', isCompactLayout ? 'mt-5' : 'mt-8')}
            >
              <View className={isCompactLayout ? 'mb-2' : 'mb-4'}>
                <Text className="mb-2 text-sm2 font-semibold text-text-primary">Email address</Text>
                <View
                  className={cn(
                    'flex-row items-center rounded-[20px] border px-4',
                    isCompactLayout ? 'h-12' : 'h-14',
                    isEmailFocused
                      ? 'border-border-warm bg-surface-cream-focus'
                      : 'border-border-warm-soft bg-white',
                  )}
                >
                  <MaterialIcons name="mail-outline" size={20} color={colors.brand.secondary} />
                  <TextInput
                    keyboardAppearance="light"
                    ref={emailInputRef}
                    accessibilityLabel="Email address"
                    className="ml-3 flex-1 text-md font-sans text-text-primary"
                    placeholder="Enter your email"
                    placeholderTextColor={colors.text.tertiary}
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
                    'flex-row items-center rounded-[20px] border px-4',
                    isCompactLayout ? 'h-12' : 'h-14',
                    isPasswordFocused
                      ? 'border-border-warm bg-surface-cream-focus'
                      : 'border-border-warm-soft bg-white',
                  )}
                >
                  <MaterialIcons name="lock-outline" size={20} color={colors.brand.secondary} />
                  <TextInput
                    keyboardAppearance="light"
                    ref={passwordInputRef}
                    accessibilityLabel="Password"
                    className="ml-3 flex-1 text-md font-sans text-text-primary"
                    placeholder="Enter your password"
                    placeholderTextColor={colors.text.tertiary}
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
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <MaterialIcons
                      name={showPassword ? 'visibility' : 'visibility-off'}
                      size={21}
                      color={colors.text.secondary}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View className="mt-3 h-11 flex-row items-center">
                <View className="min-w-0 flex-1 flex-row items-center pr-3">
                  {error ? (
                    <Animated.View
                      entering={ERROR_ENTERING}
                      className="flex-1 flex-row items-center"
                    >
                      <MaterialIcons name="error-outline" size={18} color={colors.status.error} />
                      <Text
                        className="ml-2 flex-1 text-base2 font-medium leading-5 text-status-error"
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
                    <Text className="text-base2 font-semibold text-brand">Forgot password?</Text>
                  </TouchableOpacity>
                </Link>
              </View>

              <AppPressable
                className={cn(
                  'flex-row items-center justify-center rounded-full bg-brand',
                  isCompactLayout ? 'mt-3 h-12' : 'mt-5 h-14',
                )}
                style={shadows.glow}
                onPress={handleLogin}
                disabled={isLoading}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
                accessibilityState={{ disabled: isLoading, busy: isLoading }}
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.text.inverse} size="small" />
                ) : (
                  <Text className="text-lg font-bold text-white">Sign In</Text>
                )}
              </AppPressable>

              <View className={cn('flex-row items-center', isCompactLayout ? 'my-3' : 'my-5')}>
                <View className="h-px flex-1 bg-border-default" />
                <Text className="px-4 text-xs2 font-semibold uppercase tracking-[1px] text-text-muted">
                  OR
                </Text>
                <View className="h-px flex-1 bg-border-default" />
              </View>

              <TouchableOpacity
                className={cn(
                  'flex-row items-center justify-center rounded-full border border-border-warm-soft bg-white px-4',
                  isCompactLayout ? 'min-h-12 py-2.5' : 'min-h-14 py-3',
                )}
                onPress={handleGoogleLogin}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                <GoogleIcon size={23} />
                <Text
                  className="ml-3 text-center text-md font-semibold text-text-primary"
                  style={{ flexShrink: 1 }}
                >
                  Continue with Google
                </Text>
              </TouchableOpacity>

              <View
                className={cn(
                  'mt-auto flex-row flex-wrap items-center justify-center',
                  isCompactLayout ? 'pt-4' : 'pt-7',
                )}
              >
                <Text
                  className="text-center text-base2 font-sans text-text-secondary"
                  style={{ flexShrink: 1 }}
                >
                  Don&apos;t have an account?
                </Text>
                <Link href="/(auth)/register" asChild>
                  <TouchableOpacity className="ml-1 py-2" activeOpacity={0.7}>
                    <Text className="text-base2 font-semibold text-brand">Sign up</Text>
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
