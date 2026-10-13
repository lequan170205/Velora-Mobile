import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

import { authApi } from '../../src/api/auth.api'
import { AuthFlowLayout } from '../../src/components/auth/AuthFlowLayout'
import { AuthPrimaryButton } from '../../src/components/auth/AuthPrimaryButton'
import { OtpCodeInput } from '../../src/components/auth/OtpCodeInput'

export default function VerifyEmailScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ email?: string }>()
  const email = useMemo(() => {
    if (Array.isArray(params.email)) return params.email[0] ?? ''
    return params.email ?? ''
  }, [params.email])

  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [countdown, setCountdown] = useState(60)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    if (countdown > 0) {
      timer = setTimeout(() => setCountdown((currentValue) => currentValue - 1), 1000)
    }

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [countdown])

  const handleVerify = async () => {
    if (token.trim().length < 6) {
      setError('Enter the 6-digit code.')
      return
    }

    try {
      setIsLoading(true)
      setError('')
      setNotice('')
      await authApi.confirm(token.trim())
      router.replace(`/(auth)/login?email=${encodeURIComponent(email)}`)
    } catch (err: unknown) {
      const requestError = err as Error & {
        response?: { data?: { message?: string | string[] } }
      }
      const errorMessage = requestError.response?.data?.message
      const resolvedMessage = Array.isArray(errorMessage) ? errorMessage[0] : errorMessage
      setError(resolvedMessage || 'Verification failed.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    if (!email) return

    try {
      setIsResending(true)
      setError('')
      await authApi.resendVerificationEmail(email)
      setNotice('A new verification code is on the way.')
      setCountdown(60)
    } catch (err: unknown) {
      const requestError = err as Error & {
        response?: { data?: { message?: string | string[] } }
      }
      const errorMessage = requestError.response?.data?.message
      const resolvedMessage = Array.isArray(errorMessage) ? errorMessage[0] : errorMessage
      setError(resolvedMessage || 'Failed to resend code.')
    } finally {
      setIsResending(false)
    }
  }

  return (
    <AuthFlowLayout
      title="Verify your email"
      subtitle={
        <Text className="text-base2 font-sans leading-6 text-text-secondary">
          We sent a 6-digit code to <Text className="font-semibold text-text-primary">{email}</Text>
          .
        </Text>
      }
      onBack={() => router.back()}
      showProgress={false}
      footer={
        <View>
          {error ? (
            <View className="mb-4 rounded-[16px] bg-surface-error px-4 py-3">
              <Text className="text-center text-base2 font-medium text-status-error-text">
                {error}
              </Text>
            </View>
          ) : null}

          {notice ? (
            <View className="mb-4 rounded-[16px] bg-surface-accent px-4 py-3">
              <Text className="text-center text-base2 font-medium text-brand-text">{notice}</Text>
            </View>
          ) : null}

          <AuthPrimaryButton
            label="Verify email"
            onPress={handleVerify}
            disabled={isLoading}
            isLoading={isLoading}
            trailingIcon="arrow-forward"
          />

          <View className="mt-5 items-center">
            {countdown > 0 ? (
              <View className="rounded-[16px] bg-bg-secondary px-4 py-2.5">
                <Text className="text-base2 font-medium text-text-secondary">
                  Resend in{' '}
                  <Text className="font-semibold text-text-primary">
                    00:{countdown.toString().padStart(2, '0')}
                  </Text>
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                className="rounded-[16px] bg-bg-secondary px-4 py-2.5"
                onPress={handleResend}
                activeOpacity={0.75}
                disabled={isResending}
              >
                <Text className="text-base2 font-semibold text-brand-text">
                  {isResending ? 'Sending...' : 'Resend code'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      }
    >
      <View>
        <OtpCodeInput value={token} onChangeText={setToken} hasError={Boolean(error)} />
        <Text className="font-sans mt-3 text-base2 leading-5 text-text-secondary">
          Paste the code to activate your account and finish setup.
        </Text>
      </View>
    </AuthFlowLayout>
  )
}
