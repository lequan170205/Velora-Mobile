import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
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

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const router = useRouter()

  const handleReset = async () => {
    try {
      setIsLoading(true)
      await authApi.forgotPassword(email)
      Alert.alert('Reset Link Sent', 'Check your email for instructions.', [
        {
          text: 'OK',
          onPress: () => router.push(`/reset-password?email=${encodeURIComponent(email)}`),
        },
      ])
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = err as Error & { response?: any }
      Alert.alert('Error', error?.response?.data?.message || 'Failed to request reset')
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
            <View className="flex-1 px-6" style={{ paddingTop: Platform.OS === 'ios' ? 60 : 40 }}>
              {/* Nav bar */}
              <View className="flex-row items-start -ml-3">
                <TouchableOpacity
                  onPress={() => router.back()}
                  className="h-12 rounded-full items-center justify-center"
                >
                  <MaterialIcons name="chevron-left" size={32} color="#f8fafc" />
                </TouchableOpacity>
              </View>

              {/* Header */}
              <View className="mt-6">
                <Text className="text-text-primary font-bold text-display">Forgot Password</Text>
                <Text className="text-text-secondary font-sans text-md leading-6 mt-3">
                  Enter your email address to receive a secure link to reset your password.
                </Text>
              </View>

              {/* Form */}
              <View className="mt-8">
                <View
                  className={cn(
                    'rounded-xl flex-row',
                    isFocused ? 'bg-surface-focus' : 'bg-surface-input',
                  )}
                >
                  <TextInput
                    className="text-text-primary font-sans text-md flex-1 h-14 px-4"
                    placeholder="Email address"
                    placeholderTextColor="#94a3b8"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                  />
                </View>
              </View>

              {/* Actions */}
              <View className="gap-4 mt-8 pb-8">
                <TouchableOpacity
                  className="items-center justify-center flex-row bg-brand rounded-xl h-14"
                  onPress={handleReset}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  <Text className="text-white font-bold text-md">
                    {isLoading ? 'Loading...' : 'Send Reset Code'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="items-center justify-center rounded-xl h-14"
                  onPress={() => router.back()}
                  activeOpacity={0.6}
                >
                  <Text className="text-brand font-semibold text-base2">Back to Login</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
