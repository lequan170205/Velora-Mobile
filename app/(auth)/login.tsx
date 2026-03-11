import { MaterialIcons } from '@expo/vector-icons'
import { Link, useRouter } from 'expo-router'
import React, { useState } from 'react'
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
import { cn } from '../../src/lib/cn'
import { useAuthStore } from '../../src/stores/authStore'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [isEmailFocused, setIsEmailFocused] = useState(false)
  const [isPasswordFocused, setIsPasswordFocused] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { setUser } = useAuthStore()
  const router = useRouter()

  const handleLogin = async () => {
    try {
      setIsLoading(true)
      setError('')
      await authApi.login({ email, password })
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
                <View className="w-24 h-24 rounded-full bg-[rgba(10,124,255,0.15)] items-center justify-center">
                  <MaterialIcons name="forum" size={48} color="#0A7CFF" />
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
                    placeholderTextColor="#94a3b8"
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
                      placeholderTextColor="#94a3b8"
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
                        color="#94a3b8"
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
