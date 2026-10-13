import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useRef, useState } from 'react'
import { Text, View } from 'react-native'

import { authApi } from '../../src/api/auth.api'
import { AuthField } from '../../src/components/auth/AuthField'
import { AuthFlowLayout } from '../../src/components/auth/AuthFlowLayout'
import { AuthPrimaryButton } from '../../src/components/auth/AuthPrimaryButton'
import { OtpCodeInput } from '../../src/components/auth/OtpCodeInput'
import { colors } from '../../src/constants/theme'

import type { TextInput } from 'react-native'

export default function ResetPasswordScreen() {
  const router = useRouter()
  const otpInputRef = useRef<TextInput>(null)
  const newPasswordInputRef = useRef<TextInput>(null)
  const params = useLocalSearchParams<{ email?: string; sent?: string }>()
  const email = useMemo(() => {
    if (Array.isArray(params.email)) return params.email[0] ?? ''
    return params.email ?? ''
  }, [params.email])
  const sent = Array.isArray(params.sent) ? params.sent[0] : params.sent

  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isCompleted, setIsCompleted] = useState(false)

  const notice = sent === '1' ? `Reset code sent to ${email}.` : ''

  const handleReset = async () => {
    if (token.trim().length < 6) {
      setError('Enter the 6-digit reset code.')
      return
    }

    if (!newPassword) {
      setError('Create a new password.')
      return
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    try {
      setIsLoading(true)
      setError('')
      await authApi.resetPassword({ email, token: token.trim(), newPassword })
      setIsCompleted(true)
    } catch (err: unknown) {
      const requestError = err as Error & {
        response?: { data?: { message?: string | string[] } }
      }
      const errorMessage = requestError.response?.data?.message
      const resolvedMessage = Array.isArray(errorMessage) ? errorMessage[0] : errorMessage
      setError(resolvedMessage || 'Failed to reset password.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthFlowLayout
      title={isCompleted ? 'Password updated' : 'Create a new password'}
      subtitle={
        isCompleted ? (
          'Your account is ready. Use your new password the next time you sign in.'
        ) : (
          <Text className="text-base2 font-sans leading-6 text-text-secondary">
            Enter the reset code sent to{' '}
            <Text className="font-semibold text-text-primary">{email}</Text> and choose a new
            password.
          </Text>
        )
      }
      onBack={() => router.back()}
      progressActive={2}
      progressTotal={2}
      footer={
        isCompleted ? (
          <AuthPrimaryButton
            label="Back to sign in"
            onPress={() => router.replace(`/(auth)/login?email=${encodeURIComponent(email)}`)}
          />
        ) : (
          <View>
            {error ? (
              <View className="mb-4 rounded-[16px] bg-surface-error px-4 py-3">
                <Text className="text-center text-base2 font-medium text-status-error-text">
                  {error}
                </Text>
              </View>
            ) : null}

            <AuthPrimaryButton
              label="Update password"
              onPress={handleReset}
              disabled={isLoading}
              isLoading={isLoading}
              trailingIcon="check"
            />
          </View>
        )
      }
    >
      {!isCompleted ? (
        <>
          {notice ? (
            <View className="mb-4 rounded-[16px] bg-surface-accent px-4 py-3">
              <Text className="text-center text-base2 font-medium text-brand-text">{notice}</Text>
            </View>
          ) : null}

          <View className="gap-4">
            <OtpCodeInput
              value={token}
              onChangeText={setToken}
              label="Reset code"
              inputRef={otpInputRef}
              hasError={Boolean(error)}
              onSubmitEditing={() => newPasswordInputRef.current?.focus()}
            />

            <AuthField
              ref={newPasswordInputRef}
              label="New password"
              icon="lock-outline"
              placeholder="At least 8 characters"
              value={newPassword}
              onChangeText={setNewPassword}
              autoCorrect={false}
              secureTextEntry={!showPassword}
              onToggleSecure={() => setShowPassword((currentValue) => !currentValue)}
              returnKeyType="done"
              onSubmitEditing={handleReset}
            />
          </View>
        </>
      ) : (
        <View className="rounded-[20px] border border-border-warm bg-white px-5 py-6">
          <View className="h-12 w-12 items-center justify-center rounded-[16px] bg-brand-soft">
            <MaterialIcons name="check-circle-outline" size={24} color={colors.brand.tertiary} />
          </View>
          <Text className="mt-4 font-heading text-xl leading-[26px] text-text-primary">
            You&apos;re all set
          </Text>
          <Text className="font-sans mt-2 text-base2 leading-6 text-text-secondary">
            Your password has been updated successfully for{' '}
            <Text className="font-semibold text-text-primary">{email}</Text>.
          </Text>
        </View>
      )}
    </AuthFlowLayout>
  )
}
