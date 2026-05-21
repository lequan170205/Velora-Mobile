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
    'rounded-[22px] border bg-white px-4 py-3.5',
    isFocused ? 'border-brand bg-[#FFF7F1]' : 'border-[#F1E3D7]',
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
            <View className="mb-4 rounded-[18px] bg-[#FFE8E8] px-4 py-3">
              <Text className="text-center text-base2 font-medium text-status-error">{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            className="h-[52px] flex-row items-center justify-center rounded-full bg-brand"
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
            className="mt-5 items-center justify-center rounded-full py-3"
            onPress={() => router.replace('/(auth)/login')}
            activeOpacity={0.7}
          >
            <Text className="text-base2 font-semibold text-brand">Back to sign in</Text>
          </TouchableOpacity>
        </View>
      }
    >
      <View className="rounded-[28px] border border-[#F3E6DA] bg-white px-5 py-5">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xs2 uppercase tracking-[1.2px] text-text-muted">Recovery</Text>
            <Text className="mt-2 font-heading text-[22px] leading-[28px] text-text-primary">
              Email reset
            </Text>
          </View>
          <View className="h-11 w-11 items-center justify-center rounded-full bg-[#FFF2E8]">
            <MaterialIcons name="mail-outline" size={20} color="#D85A21" />
          </View>
        </View>
        <Text className="mt-3 text-base2 leading-6 text-text-secondary">
          Use the same email you used when creating your account.
        </Text>
      </View>

      <View className="mt-4">
        <View className={inputClassName(isFocused)}>
          <Text className="mb-1.5 text-xs2 uppercase tracking-[1.1px] text-text-muted">Email</Text>
          <TextInput
            className="py-1 text-[16px] font-medium text-text-primary"
            placeholder="name@email.com"
            placeholderTextColor="#AEAEB2"
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
      </View>
    </AuthFlowLayout>
  )
}
