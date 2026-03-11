import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
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

export default function ResetPasswordScreen() {
  const { email } = useLocalSearchParams<{ email: string }>()
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const router = useRouter()

  const handleReset = async () => {
    try {
      setIsLoading(true)
      await authApi.resetPassword({ email, token, newPassword })
      Alert.alert('Success', 'Your password has been reset.', [
        { text: 'OK', onPress: () => router.replace('/login') },
      ])
    } catch (err: unknown) {
      const error = err as Error & { response?: { data?: { message?: string }; status?: number } }
      Alert.alert('Error', error?.response?.data?.message || 'Failed to reset password')
    } finally {
      setIsLoading(false)
    }
  }

  const inputGroupClass = (name: string) =>
    cn(
      'rounded-xl flex-row',
      focusedInput === name ? 'bg-surface-focus' : 'bg-surface-input',
    )

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg-primary"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1">
        <View
          className="flex-1 px-6"
          style={{ paddingTop: Platform.OS === 'ios' ? 60 : 24 }}
        >
          {/* Nav bar */}
          <View className="flex-row items-start -ml-3">
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-12 h-12 rounded-full items-center justify-center"
            >
              <MaterialIcons name="arrow-back" size={24} color="#f8fafc" />
            </TouchableOpacity>
          </View>

          {/* Header */}
          <View className="mt-6">
            <Text className="text-text-primary font-bold text-display">Reset Password</Text>
            <Text className="text-text-secondary font-sans text-md leading-6 mt-3">
              Enter the reset code sent to your email and your new password to regain access.
            </Text>
          </View>

          {/* Form */}
          <View className="gap-4 mt-8">
            {/* Token input */}
            <View>
              <View className={inputGroupClass('token')}>
                <TextInput
                  className="text-text-primary font-sans text-md flex-1 h-14 px-4"
                  placeholder="Enter 6-digit code"
                  placeholderTextColor="#94a3b8"
                  value={token}
                  onChangeText={setToken}
                  keyboardType="number-pad"
                  onFocus={() => setFocusedInput('token')}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>
            </View>

            {/* New password input */}
            <View>
              <View className={inputGroupClass('newPassword')}>
                <View className="flex-1 flex-row relative">
                  <TextInput
                    className="text-text-primary font-sans text-md flex-1 h-14 pl-4 pr-12"
                    placeholder="New password"
                    placeholderTextColor="#94a3b8"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showPassword}
                    onFocus={() => setFocusedInput('newPassword')}
                    onBlur={() => setFocusedInput(null)}
                  />
                  <TouchableOpacity
                    className="absolute right-0 h-full items-center justify-center px-4"
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
            </View>
          </View>

          {/* Reset button */}
          <TouchableOpacity
            className="items-center justify-center flex-row bg-brand rounded-xl h-14 mt-8"
            onPress={handleReset}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Text className="text-white font-bold text-md">
              {isLoading ? 'Loading...' : 'Reset Password'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
