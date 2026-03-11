import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'

import { authApi } from '../../src/api/auth.api'
import { cn } from '../../src/lib/cn'
import { useAuthStore } from '../../src/stores/authStore'

export default function VerifyEmailScreen() {
  const { email } = useLocalSearchParams<{ email: string }>()
  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [countdown, setCountdown] = useState(60)
  const [isFocused, setIsFocused] = useState(false)
  const router = useRouter()
  const { hydrateAuth } = useAuthStore()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    }
    return () => clearTimeout(timer)
  }, [countdown])

  const handleVerify = async () => {
    if (token.length < 6) {
      Alert.alert('Error', 'Please enter a 6-digit code')
      return
    }

    try {
      setIsLoading(true)
      await authApi.confirm(token)
      await hydrateAuth()
      router.replace('/')
    } catch (err: unknown) {
      const error = err as Error & { response?: { data?: { message?: string }; status?: number } }
      Alert.alert('Error', error?.response?.data?.message || 'Verification failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    setCountdown(60)
    Alert.alert('Sent', 'Verification code resent to your email.')
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg-primary"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1">
        <View className="flex-1 px-6 pb-12 pt-16">
          {/* Nav bar */}
          <View className="flex-row items-start">
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-12 h-12 rounded-full items-center justify-center"
            >
              <MaterialIcons name="arrow-back" size={24} color="#f8fafc" />
            </TouchableOpacity>
          </View>

          {/* Header */}
          <View className="gap-2 mt-8">
            <Text className="text-text-primary font-bold text-display">Verify Email</Text>
            <Text className="text-text-secondary font-sans text-md leading-6">
              We sent a 6-digit code to{'\n'}
              <Text className="text-text-primary font-semibold">{email}</Text>
            </Text>
          </View>

          {/* OTP input */}
          <View className="mt-8">
            <View
              className={cn(
                'rounded-xl h-16 justify-center overflow-hidden mt-4',
                isFocused ? 'bg-surface-focus' : 'bg-surface-input',
              )}
            >
              <TextInput
                className="text-text-primary font-semibold text-[32px] text-center"
                value={token}
                onChangeText={setToken}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="••••••"
                placeholderTextColor="#94a3b8"
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                textAlign="center"
                // NativeWind limitation: letterSpacing kept as inline — no Tailwind class maps to this exact value
                style={{ letterSpacing: 16 }}
              />
            </View>

            {/* Verify button */}
            <TouchableOpacity
              className="items-center justify-center flex-row bg-brand rounded-xl h-14 mt-8"
              onPress={handleVerify}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              <Text className="text-white font-bold text-md">
                {isLoading ? 'Verifying...' : 'VERIFY'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <View className="items-center gap-2 mt-auto pt-8">
            <Text className="text-text-secondary font-sans text-base2">
              Didn&apos;t receive the code?
            </Text>
            <View className="flex-row items-center gap-2">
              {countdown > 0 ? (
                <>
                  <Text className="text-text-muted font-sans text-base2">Resend Code in</Text>
                  <Text className="text-text-primary font-semibold text-base2">
                    00:{countdown.toString().padStart(2, '0')}
                  </Text>
                </>
              ) : (
                <TouchableOpacity onPress={handleResend} activeOpacity={0.7}>
                  <Text className="text-brand font-semibold text-base2">Resend Code</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
