import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native'

import { authApi } from '../../src/api/auth.api'
import { AuthFlowLayout } from '../../src/components/auth/AuthFlowLayout'
import { OtpCodeInput } from '../../src/components/auth/OtpCodeInput'
import { cn } from '../../src/lib/cn'

const inputClassName = (isFocused: boolean) =>
  cn(
    'rounded-[20px] border bg-[#FFFBF8] px-4 py-3.5',
    isFocused ? 'border-brand bg-[#FFF7F2]' : 'border-[#F2DED0]',
  )

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
  const [focusedInput, setFocusedInput] = useState<'newPassword' | null>(null)
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
          <TouchableOpacity
            className="h-14 flex-row items-center justify-center rounded-[20px] bg-brand"
            onPress={() => router.replace(`/(auth)/login?email=${encodeURIComponent(email)}`)}
            activeOpacity={0.85}
          >
            <Text className="text-base font-bold text-white">Back to sign in</Text>
          </TouchableOpacity>
        ) : (
          <View>
            {error ? (
              <View className="mb-4 rounded-[16px] bg-[#FFF0EF] px-4 py-3">
                <Text className="text-center text-base2 font-medium text-status-error">
                  {error}
                </Text>
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
                  <Text className="text-base font-bold text-white">Update password</Text>
                  <MaterialIcons name="check" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
                </>
              )}
            </TouchableOpacity>
          </View>
        )
      }
    >
      {!isCompleted ? (
        <>
          {notice ? (
            <View className="mb-4 rounded-[16px] bg-[#FFF4EC] px-4 py-3">
              <Text className="text-center text-base2 font-medium text-[#A6501B]">{notice}</Text>
            </View>
          ) : null}

          <View className="gap-4">
            <OtpCodeInput
              value={token}
              onChangeText={setToken}
              label="Reset code"
              inputRef={otpInputRef}
              onSubmitEditing={() => newPasswordInputRef.current?.focus()}
            />

            <View className={inputClassName(focusedInput === 'newPassword')}>
              <Text className="mb-1.5 text-sm2 font-semibold text-text-primary">New password</Text>
              <View className="flex-row items-center">
                <TextInput
                  ref={newPasswordInputRef}
                  className="flex-1 py-1 text-[16px] font-medium text-text-primary"
                  placeholder="At least 8 characters"
                  placeholderTextColor="#AEAEB2"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry={!showPassword}
                  autoCorrect={false}
                  onFocus={() => setFocusedInput('newPassword')}
                  onBlur={() => {
                    setFocusedInput(null)
                  }}
                  returnKeyType="done"
                  onSubmitEditing={handleReset}
                />
                <TouchableOpacity
                  className="pl-4"
                  onPress={() => setShowPassword((currentValue) => !currentValue)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={showPassword ? 'visibility' : 'visibility-off'}
                    size={20}
                    color="#6E6E73"
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </>
      ) : (
        <View className="rounded-[22px] border border-[#F2DED0] bg-[#FFFBF8] px-5 py-6">
          <View className="h-12 w-12 items-center justify-center rounded-[16px] bg-[#FFF2E8]">
            <MaterialIcons name="check-circle-outline" size={24} color="#D85A21" />
          </View>
          <Text className="mt-4 font-heading text-[24px] leading-[30px] text-text-primary">
            You&apos;re all set
          </Text>
          <Text className="mt-2 text-base2 leading-6 text-text-secondary">
            Your password has been updated successfully for{' '}
            <Text className="font-semibold text-text-primary">{email}</Text>.
          </Text>
        </View>
      )}
    </AuthFlowLayout>
  )
}
