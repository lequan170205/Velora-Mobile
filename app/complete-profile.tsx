import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { authApi } from '../src/api/auth.api'
import { userApi } from '../src/api/user.api'
import { useUsernameAvailability } from '../src/hooks/useUsernameAvailability'
import { cn } from '../src/lib/cn'
import { useAuthStore } from '../src/stores/authStore'

const MAX_USERNAME_LENGTH = 31
const USERNAME_PATTERN = /^[A-Za-z0-9._]+$/

const normalizeUsername = (value: string) =>
  value.replace(/^@+/, '').replace(/\s+/g, '').slice(0, MAX_USERNAME_LENGTH)

const getUsernameError = (username: string) => {
  if (!username.trim()) return 'Choose a username.'
  if (!USERNAME_PATTERN.test(username)) return 'Use letters, numbers, periods, or underscores only.'
  return ''
}

const inputClassName = (isFocused: boolean) =>
  cn(
    'rounded-[22px] border bg-white px-4 py-3.5',
    isFocused ? 'border-brand bg-[#FFF7F1]' : 'border-[#F1E3D7]',
  )

function StatusPill({
  label,
  tone = 'default',
}: {
  label: string
  tone?: 'default' | 'positive' | 'danger'
}) {
  const toneClassName =
    tone === 'positive'
      ? 'bg-[#EAF8F0] text-call-green'
      : tone === 'danger'
        ? 'bg-[#FFEAEA] text-status-error'
        : 'bg-surface-muted text-text-secondary'

  return (
    <View className={cn('rounded-full px-3 py-1.5', toneClassName)}>
      <Text className="text-xs2 font-medium">{label}</Text>
    </View>
  )
}

export default function CompleteProfileScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { clearAuth, hydrateAuth, setUser, user } = useAuthStore()

  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const [debouncedUsername, setDebouncedUsername] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const normalizedUsername = normalizeUsername(username)
  const usernameError = getUsernameError(normalizedUsername)

  useEffect(() => {
    if (user?.username?.trim()) {
      router.replace('/')
    }
  }, [router, user?.username])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedUsername(normalizedUsername)
    }, 280)

    return () => clearTimeout(timer)
  }, [normalizedUsername])

  useEffect(() => {
    setError('')
  }, [username])

  const usernameAvailability = useUsernameAvailability(
    debouncedUsername,
    normalizedUsername.length > 0 && !usernameError,
  )

  const isCheckingUsername =
    normalizedUsername.length > 0 &&
    !usernameError &&
    (debouncedUsername !== normalizedUsername || usernameAvailability.isFetching)
  const isUsernameTaken =
    normalizedUsername.length > 0 &&
    !usernameError &&
    usernameAvailability.data?.available === false
  const isUsernameAvailable =
    normalizedUsername.length > 0 && !usernameError && usernameAvailability.data?.available === true
  const canSubmit =
    normalizedUsername.length > 0 &&
    !usernameError &&
    !isCheckingUsername &&
    !isUsernameTaken &&
    !isSubmitting

  const statusText = usernameError
    ? usernameError
    : isCheckingUsername
      ? 'Checking availability...'
      : isUsernameAvailable
        ? 'Username available'
        : isUsernameTaken
          ? 'Username already taken'
          : usernameAvailability.error
            ? 'Unable to verify right now.'
            : 'Letters, numbers, periods, and underscores only.'

  const statusColorClass =
    usernameError || isUsernameTaken
      ? 'text-status-error'
      : isUsernameAvailable
        ? 'text-call-green'
        : 'text-text-secondary'

  const handleSubmit = async () => {
    if (!user) return

    if (usernameError) {
      setError(usernameError)
      return
    }

    if (isCheckingUsername) {
      setError('Checking availability...')
      return
    }

    if (isUsernameTaken) {
      setError('This username is already taken.')
      return
    }

    try {
      setIsSubmitting(true)
      setError('')

      await userApi.update(user.id, { username: normalizedUsername })
      await hydrateAuth()
      setUser({ ...user, username: normalizedUsername })
      router.replace('/')
    } catch (err: unknown) {
      const requestError = err as Error & {
        response?: { data?: { message?: string | string[] } }
      }
      const errorMessage = requestError.response?.data?.message
      const resolvedMessage = Array.isArray(errorMessage) ? errorMessage[0] : errorMessage
      setError(resolvedMessage || 'Unable to save username.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSignOut = () => {
    void authApi.logout().catch(() => undefined)
    clearAuth()
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg-primary"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View
          className="flex-1 px-6"
          style={{
            paddingBottom: Math.max(insets.bottom, 20) + 24,
            paddingTop: insets.top + 14,
          }}
        >
          <View className="absolute right-[-42px] top-[72px] h-40 w-40 rounded-full bg-[#FFF1E8]" />
          <View className="absolute left-[-54px] top-[188px] h-28 w-28 rounded-full bg-[#FFF6EF]" />

          <View className="flex-row justify-end">
            <TouchableOpacity
              className="h-11 w-11 items-center justify-center rounded-full border border-[#F1E3D7] bg-white"
              onPress={handleSignOut}
              activeOpacity={0.8}
            >
              <MaterialIcons name="logout" size={20} color="#1C1C1E" />
            </TouchableOpacity>
          </View>

          <View className="pt-9">
            <Text className="font-heading text-[34px] leading-[38px] text-text-primary">
              Choose your username
            </Text>
            <Text className="mt-2 text-base2 font-sans leading-6 text-text-secondary">
              This is your public handle across Velora.
            </Text>
          </View>

          <View className="mt-8 rounded-[28px] border border-[#F3E6DA] bg-white px-5 py-5">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-xs2 uppercase tracking-[1.2px] text-text-muted">
                  Your profile
                </Text>
                <Text className="mt-2 font-heading text-[28px] leading-[32px] text-text-primary">
                  @{normalizedUsername || 'username'}
                </Text>
              </View>

              {isCheckingUsername ? (
                <StatusPill label="Checking" />
              ) : isUsernameAvailable ? (
                <StatusPill label="Available" tone="positive" />
              ) : isUsernameTaken ? (
                <StatusPill label="Taken" tone="danger" />
              ) : (
                <StatusPill label="Handle" />
              )}
            </View>
          </View>

          <View className="mt-4">
            <View className={inputClassName(focusedInput === 'username')}>
              <Text className="mb-1.5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                Username
              </Text>
              <View className="flex-row items-center">
                <Text className="pr-1 text-[18px] font-semibold text-text-primary">@</Text>
                <TextInput
                  className="flex-1 py-1 text-[18px] font-semibold text-text-primary"
                  placeholder="username"
                  placeholderTextColor="#AEAEB2"
                  value={username}
                  onChangeText={(value) => setUsername(normalizeUsername(value))}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={() => setFocusedInput('username')}
                  onBlur={() => setFocusedInput(null)}
                  maxLength={MAX_USERNAME_LENGTH}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    void handleSubmit()
                  }}
                />
              </View>
            </View>

            <View className="mt-3 flex-row items-center gap-2 px-1">
              {isCheckingUsername ? (
                <ActivityIndicator size="small" color="#6E6E73" />
              ) : (
                <MaterialIcons
                  name={
                    usernameError || isUsernameTaken
                      ? 'error-outline'
                      : isUsernameAvailable
                        ? 'check-circle-outline'
                        : 'info-outline'
                  }
                  size={18}
                  color={
                    usernameError || isUsernameTaken
                      ? '#D94F4F'
                      : isUsernameAvailable
                        ? '#2B9F63'
                        : '#6E6E73'
                  }
                />
              )}
              <Text className={cn('flex-1 text-base2 font-sans', statusColorClass)}>
                {statusText}
              </Text>
            </View>
          </View>

          <View className="mt-auto pt-8">
            {error ? (
              <View className="mb-4 rounded-[18px] bg-[#FFE8E8] px-4 py-3">
                <Text className="text-center text-base2 font-medium text-status-error">
                  {error}
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              className={cn(
                'h-[52px] flex-row items-center justify-center rounded-full',
                canSubmit ? 'bg-brand' : 'bg-[#F4B89A]',
              )}
              onPress={() => {
                void handleSubmit()
              }}
              disabled={!canSubmit}
              activeOpacity={0.85}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Text className="text-base font-bold text-white">Continue</Text>
                  <MaterialIcons
                    name="arrow-forward"
                    size={17}
                    color="#FFFFFF"
                    style={{ marginLeft: 8 }}
                  />
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  )
}
