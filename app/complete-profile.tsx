import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { userApi } from '../src/api/user.api'
import { AuthField } from '../src/components/auth/AuthField'
import { AuthHeadline } from '../src/components/auth/AuthHeadline'
import { AuthPrimaryButton } from '../src/components/auth/AuthPrimaryButton'
import { ShortFormScreen } from '../src/components/base/ShortFormScreen'
import { colors } from '../src/constants/theme'
import { resetLocalDatabase } from '../src/database/DatabaseManager'
import { useUsernameAvailability } from '../src/hooks/useUsernameAvailability'
import { cn } from '../src/lib/cn'
import { performLogoutPushTokenCleanup } from '../src/lib/notifications/pushTokenLifecycle'
import { MAX_USERNAME_LENGTH, getUsernameError, normalizeUsername } from '../src/lib/profile'
import { useAuthStore } from '../src/stores/authStore'

function StatusPill({
  label,
  tone = 'default',
}: {
  label: string
  tone?: 'default' | 'positive' | 'danger'
}) {
  const toneClassName =
    tone === 'positive'
      ? 'bg-surface-success text-status-success-deep'
      : tone === 'danger'
        ? 'bg-surface-error text-status-error-text'
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
      ? 'text-status-error-text'
      : isUsernameAvailable
        ? 'text-status-success-deep'
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

  const handleSignOut = async () => {
    let shouldClearAuth = false

    try {
      const logoutResult = await performLogoutPushTokenCleanup()

      if (!logoutResult.ok) {
        setError('Unable to sign out. Check your connection and try again.')
        return
      }

      shouldClearAuth = true
      await resetLocalDatabase()
    } catch {
      setError('Unable to sign out. Check your connection and try again.')
    } finally {
      if (shouldClearAuth) {
        clearAuth()
      }
    }
  }

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in with your email and password.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void handleSignOut() },
    ])
  }

  return (
    <View className="flex-1 bg-surface-cream">
      <ShortFormScreen
        className="flex-1"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: Math.max(insets.bottom + 28, 44),
          paddingHorizontal: 24,
          paddingTop: insets.top + 10,
        }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View className="flex-1">
            <View className="flex-row justify-end">
              <TouchableOpacity
                className="h-11 w-11 items-center justify-center rounded-[16px] border border-border-warm-soft bg-white"
                onPress={confirmSignOut}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Sign out"
              >
                <MaterialIcons name="logout" size={20} color={colors.text.primary} />
              </TouchableOpacity>
            </View>

            <View className="pt-9">
              <AuthHeadline size="hero" title="Choose your username" />
              <Text className="mt-2 text-base2 font-sans leading-6 text-text-secondary">
                This is your public handle across Velora.
              </Text>
            </View>

            <View className="mt-8 rounded-[20px] border border-border-warm bg-white px-5 py-5">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="font-heading text-[28px] leading-[32px] text-text-primary">
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
              <AuthField
                label="Username"
                leadingAccessory={
                  <Text className="text-md font-semibold text-text-primary">@</Text>
                }
                placeholder="username"
                value={username}
                onChangeText={(value) => setUsername(normalizeUsername(value))}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={MAX_USERNAME_LENGTH}
                returnKeyType="done"
                onSubmitEditing={() => {
                  void handleSubmit()
                }}
              />

              <View className="mt-3 flex-row items-center gap-2 px-1">
                {isCheckingUsername ? (
                  <ActivityIndicator size="small" color={colors.text.secondary} />
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
                        ? colors.status.errorText
                        : isUsernameAvailable
                          ? colors.status.successDeep
                          : colors.text.secondary
                    }
                  />
                )}
                <Text className={cn('font-sans', statusColorClass)}>{statusText}</Text>
              </View>
            </View>

            <View className="mt-auto pt-8">
              {error ? (
                <View className="mb-4 rounded-[16px] bg-surface-error px-4 py-3">
                  <Text className="text-center text-base2 font-medium text-status-error-text">
                    {error}
                  </Text>
                </View>
              ) : null}

              <AuthPrimaryButton
                label="Continue"
                onPress={() => {
                  void handleSubmit()
                }}
                disabled={!canSubmit}
                isLoading={isSubmitting}
                trailingIcon="arrow-forward"
              />
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ShortFormScreen>
    </View>
  )
}
