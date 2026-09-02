import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native'

import { authApi } from '../../src/api/auth.api'
import { AuthFlowLayout } from '../../src/components/auth/AuthFlowLayout'
import { cn } from '../../src/lib/cn'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const inputClassName = (isFocused: boolean) =>
  cn(
    'h-14 flex-row items-center rounded-[20px] border bg-[#FFFBF8] px-4',
    isFocused ? 'border-brand bg-[#FFF7F2]' : 'border-[#F2DED0]',
  )

const getEmailError = (email: string) => {
  if (!email.trim()) return 'Enter your email.'
  if (!EMAIL_PATTERN.test(email.trim().toLowerCase())) return 'Enter a valid email.'
  return ''
}

export default function ForgotPasswordScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [error, setError] = useState('')

  const handleReset = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    const emailError = getEmailError(normalizedEmail)

    if (emailError) {
      setError(emailError)
      return
    }

    try {
      setIsLoading(true)
      setError('')
      await authApi.forgotPassword(normalizedEmail)
      router.push(`/(auth)/reset-password?email=${encodeURIComponent(normalizedEmail)}&sent=1`)
    } catch (err: unknown) {
      const requestError = err as Error & {
        response?: { data?: { message?: string | string[] } }
      }
      const errorMessage = requestError.response?.data?.message
      const resolvedMessage = Array.isArray(errorMessage) ? errorMessage[0] : errorMessage
      setError(resolvedMessage || 'Failed to send reset code.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthFlowLayout
      title="Reset your password"
      subtitle="We will send a 6-digit code to the email linked to your account."
      onBack={() => router.back()}
      progressActive={1}
      progressTotal={2}
      footer={
        <View>
          {error ? (
            <View className="mb-4 rounded-[16px] bg-[#FFF0EF] px-4 py-3">
              <Text className="text-center text-base2 font-medium text-status-error">{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            className="h-14 flex-row items-center justify-center rounded-[20px] bg-brand"
            onPress={handleReset}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Text className="text-base font-bold text-white">Send code</Text>
                <MaterialIcons
                  name="arrow-forward"
                  size={17}
                  color="#FFFFFF"
                  style={{ marginLeft: 8 }}
                />
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            className="mt-4 items-center justify-center rounded-[18px] py-3"
            onPress={() => router.replace('/(auth)/login')}
            activeOpacity={0.7}
          >
            <Text className="text-base2 font-semibold text-brand">Back to sign in</Text>
          </TouchableOpacity>
        </View>
      }
    >
      <View>
        <Text className="mb-2 text-sm2 font-semibold text-text-primary">Email address</Text>
        <View className={inputClassName(isFocused)}>
          <MaterialIcons name="mail-outline" size={20} color="#FF8A5B" />
          <TextInput
            className="ml-3 flex-1 text-md font-sans text-text-primary"
            placeholder="Enter your email"
            placeholderTextColor="#9A9694"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            returnKeyType="done"
            onSubmitEditing={handleReset}
          />
        </View>
        <Text className="mt-3 text-base2 leading-5 text-text-secondary">
          Use the same email you used when creating your account.
        </Text>
      </View>
    </AuthFlowLayout>
  )
}
