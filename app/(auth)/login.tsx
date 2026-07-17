import { MaterialIcons } from '@expo/vector-icons'
import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin'
import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'

import { authApi } from '../../src/api/auth.api'
import { GoogleIcon } from '../../src/components/ui/GoogleIcon'
import { cn } from '../../src/lib/cn'
import { resumePushTokenRegistration } from '../../src/lib/notifications/pushTokenOperationState'
import { useAuthStore } from '../../src/stores/authStore'

export default function LoginScreen() {
  const params = useLocalSearchParams<{ email?: string }>()
  const [email, setEmail] = useState(params.email ?? '')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [isEmailFocused, setIsEmailFocused] = useState(false)
  const [isPasswordFocused, setIsPasswordFocused] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
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
    <KeyboardAvoidingView
      className="flex-1 bg-bg-primary"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View className="flex-1">
            {/* Top spacing */}
            <View className="px-4 pt-[78px]" />

            <View className="flex-1 px-6 pb-12">
              {/* Logo / header */}
              <View className="items-center mb-12 mt-6">
                <View className="w-24 h-24 rounded-full bg-[rgba(255,107,44,0.12)] items-center justify-center">
                  <MaterialIcons name="forum" size={48} color="#FF6B2C" />
                </View>
                <Text className="text-text-primary font-bold text-display mt-6">Sign In</Text>
                <Text className="text-text-secondary font-sans text-md mt-2">
                  Welcome back to Messenger!
                </Text>
              </View>

              {/* Form */}
              <View className="flex-1">
                {/* Email input */}
                <View
                  className={cn(
                    'rounded-xl h-14 justify-center mb-4',
                    isEmailFocused ? 'bg-surface-focus' : 'bg-surface-input',
                  )}
                >
                  <TextInput
                    className="text-text-primary font-sans text-md flex-1 px-4"
                    placeholder="Email address"
                    placeholderTextColor="#AEAEB2"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    onFocus={() => setIsEmailFocused(true)}
                    onBlur={() => setIsEmailFocused(false)}
                  />
                </View>

                {/* Password input */}
                <View
                  className={cn(
                    'rounded-xl h-14 justify-center mb-4',
                    isPasswordFocused ? 'bg-surface-focus' : 'bg-surface-input',
                  )}
                >
                  <View className="flex-1 flex-row items-center">
                    <TextInput
                      className="text-text-primary font-sans text-md flex-1 px-4"
                      placeholder="Password"
                      placeholderTextColor="#AEAEB2"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      onFocus={() => setIsPasswordFocused(true)}
                      onBlur={() => setIsPasswordFocused(false)}
                    />
                    <TouchableOpacity
                      className="items-center justify-center px-4"
                      onPress={() => setShowPassword(!showPassword)}
                    >
                      <MaterialIcons
                        name={showPassword ? 'visibility' : 'visibility-off'}
                        size={20}
                        color="#AEAEB2"
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Error */}
                {error ? (
                  <Text className="text-status-error font-medium text-base2 text-center mt-1 mb-2">
                    {error}
                  </Text>
                ) : null}

                {/* Forgot password */}
                <View className="items-end">
                  <Link href="/(auth)/forgot-password" asChild>
                    <TouchableOpacity>
                      <Text className="text-brand font-semibold text-base2">Forgot password?</Text>
                    </TouchableOpacity>
                  </Link>
                </View>

                {/* Sign In button */}
                <TouchableOpacity
                  className="items-center justify-center bg-brand rounded-xl h-14 mt-8"
                  onPress={handleLogin}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  <Text className="text-white font-bold text-md">
                    {isLoading ? 'Loading...' : 'Sign In'}
                  </Text>
                </TouchableOpacity>

                <View className="flex-row items-center mt-6 mb-4">
                  <View className="flex-1 h-[1px] bg-surface-focus" />
                  <Text className="text-text-secondary px-4 font-sans text-base2">OR</Text>
                  <View className="flex-1 h-[1px] bg-surface-focus" />
                </View>

                <TouchableOpacity
                  className="items-center justify-center bg-white border border-gray-200 rounded-xl h-14 flex-row"
                  onPress={handleGoogleLogin}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  <GoogleIcon size={24} />
                  <Text className="text-[#3C4043] font-bold text-md ml-3">
                    Continue with Google
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Footer */}
              <View className="flex-row items-center justify-center mt-auto pt-8">
                <Text className="text-text-secondary font-sans text-base2">
                  Don&apos;t have an account?{' '}
                </Text>
                <Link href="/(auth)/register" asChild>
                  <TouchableOpacity>
                    <Text className="text-brand font-semibold text-base2">Sign up</Text>
                  </TouchableOpacity>
                </Link>
              </View>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
