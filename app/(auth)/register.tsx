import { MaterialIcons } from '@expo/vector-icons'
import { Link, useRouter } from 'expo-router'
import React, { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'

import { authApi } from '../../src/api/auth.api'
import { cn } from '../../src/lib/cn'

export default function RegisterScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const router = useRouter()

  const handleRegister = async () => {
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    try {
      setIsLoading(true)
      setError('')

      await authApi.register({ email, password })

      router.push(`/verify-email?email=${encodeURIComponent(email)}`)
    } catch (err: unknown) {
      const error = err as Error & { response?: { data?: { message?: string }; status?: number } }
      const errorMsg = error?.response?.data?.message || 'Registration failed'
      setError(errorMsg)
      Alert.alert('Error', errorMsg)
    } finally {
      setIsLoading(false)
    }
  }

  const inputClass = (name: string) =>
    cn(
      'rounded-xl h-14 justify-center overflow-hidden',
      focusedInput === name ? 'bg-surface-focus' : 'bg-surface-input',
    )

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg-primary"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: 48,
          paddingHorizontal: 24,
          paddingTop: Platform.OS === 'ios' ? 60 : 48,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Nav bar */}
        <View className="items-start pb-4">
          <TouchableOpacity
            onPress={() => router.back()}
            className="h-12 rounded-full items-center justify-center"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="arrow-back" size={24} color="#1C1C1E" />
          </TouchableOpacity>
        </View>

        {/* Header */}
        <View className="pb-6 pt-2">
          <Text className="text-text-primary font-bold text-display">Create Account</Text>
          <Text className="text-text-secondary font-sans text-md mt-2">
            Join our messaging community.
          </Text>
        </View>

        {/* Form */}
        <View className="gap-4 mt-4">
          {/* Email */}
          <View className={inputClass('email')}>
            <TextInput
              className="text-text-primary font-sans text-md flex-1 px-4 py-4"
              placeholder="Email address"
              placeholderTextColor="#AEAEB2"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              onFocus={() => setFocusedInput('email')}
              onBlur={() => setFocusedInput(null)}
            />
          </View>

          {/* Password */}
          <View className={inputClass('password')}>
            <View className="flex-row relative">
              <TextInput
                className="text-text-primary font-sans text-md flex-1 pl-4 pr-12 py-4"
                placeholder="Password"
                placeholderTextColor="#AEAEB2"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                onFocus={() => setFocusedInput('password')}
                onBlur={() => setFocusedInput(null)}
              />
              <TouchableOpacity
                className="absolute right-0 h-full items-center justify-center px-4"
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

          {/* Confirm password */}
          <View className={inputClass('confirmPassword')}>
            <TextInput
              className="text-text-primary font-sans text-md flex-1 px-4 py-4"
              placeholder="Confirm password"
              placeholderTextColor="#AEAEB2"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPassword}
              onFocus={() => setFocusedInput('confirmPassword')}
              onBlur={() => setFocusedInput(null)}
            />
          </View>

          {/* Error */}
          {error ? (
            <Text className="text-status-error font-medium text-base2 text-center mt-1">
              {error}
            </Text>
          ) : null}

          {/* Sign Up button */}
          <TouchableOpacity
            className="items-center justify-center bg-brand rounded-xl flex-row h-14 mt-2"
            onPress={handleRegister}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Text className="text-white font-bold text-md">
              {isLoading ? 'Loading...' : 'Sign Up'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View className="flex-row items-center justify-center mt-8">
          <Text className="text-text-secondary font-sans text-base2">
            Already have an account?{' '}
          </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity>
              <Text className="text-brand font-semibold text-base2">Sign in</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
