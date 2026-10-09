import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

import { authApi } from '../../src/api/auth.api'
import { AuthField } from '../../src/components/auth/AuthField'
import { AuthFlowLayout } from '../../src/components/auth/AuthFlowLayout'
import { AuthPrimaryButton } from '../../src/components/auth/AuthPrimaryButton'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const getEmailError = (email: string) => {
  if (!email.trim()) return 'Enter your email.'
  if (!EMAIL_PATTERN.test(email.trim().toLowerCase())) return 'Enter a valid email.'
  return ''
}

export default function ForgotPasswordScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
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
            <View className="mb-4 rounded-[16px] bg-surface-error px-4 py-3">
              <Text className="text-center text-base2 font-medium text-status-error-text">
                {error}
              </Text>
            </View>
          ) : null}

          <AuthPrimaryButton
            label="Send code"
            onPress={handleReset}
            disabled={isLoading}
            isLoading={isLoading}
            trailingIcon="arrow-forward"
          />

          <TouchableOpacity
            className="mt-4 items-center justify-center rounded-[16px] py-3"
            onPress={() => router.replace('/(auth)/login')}
            activeOpacity={0.7}
          >
            <Text className="text-base2 font-semibold text-brand-text">Back to sign in</Text>
          </TouchableOpacity>
        </View>
      }
    >
      <View>
        <AuthField
          label="Email address"
          icon="mail-outline"
          placeholder="Enter your email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleReset}
          hint="Use the same email you used when creating your account."
        />
      </View>
    </AuthFlowLayout>
  )
}
