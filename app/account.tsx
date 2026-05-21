import { MaterialIcons } from '@expo/vector-icons'
import { useNavigation, usePreventRemove } from '@react-navigation/native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  findNodeHandle,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  type ScrollView as ScrollViewType,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useUpdateProfile } from '../src/hooks/useProfile'
import { useUsernameAvailability } from '../src/hooks/useUsernameAvailability'
import { cn } from '../src/lib/cn'
import {
  MAX_FULL_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  getDisplayName,
  getFullNameError,
  getInitials,
  getUsernameError,
  normalizeUsername,
} from '../src/lib/profile'
import { useAuthStore } from '../src/stores/authStore'
import { useProfileUiStore } from '../src/stores/profileUiStore'

import type { UserProfileUpdateInput } from '../src/types/user.types'

type FocusableField = 'fullName' | 'username'
type ProfileFieldErrors = {
  form: string
  fullName: string
  username: string
}

type ApiErrorPayload = {
  message?: string | string[]
  errors?: Record<string, string | string[]>
}

const inputClassName = (isFocused: boolean) =>
  cn(
    'rounded-[22px] border bg-white px-4 py-3.5',
    isFocused ? 'border-brand bg-[#FFF7F1]' : 'border-[#F1E3D7]',
  )

const extractErrorMessages = (error: unknown) => {
  const responseData = (error as { response?: { data?: ApiErrorPayload } }).response?.data
  const messages = responseData?.message
  const normalizedMessages = Array.isArray(messages) ? messages : messages ? [messages] : []
  const fieldMessages = responseData?.errors
    ? Object.values(responseData.errors)
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter(Boolean)
    : []

  return [...normalizedMessages, ...fieldMessages]
}

const resolveProfileFieldErrors = (error: unknown): ProfileFieldErrors => {
  const responseStatus = (error as { response?: { status?: number } }).response?.status

  if (responseStatus === 409) {
    return {
      form: '',
      fullName: '',
      username: 'This username is already taken.',
    }
  }

  const nextErrors: ProfileFieldErrors = {
    form: '',
    fullName: '',
    username: '',
  }

  for (const message of extractErrorMessages(error)) {
    const normalizedMessage = message.toLowerCase()

    if (
      !nextErrors.username &&
      (normalizedMessage.includes('username') || normalizedMessage.includes('user name'))
    ) {
      nextErrors.username = message
      continue
    }

    if (
      !nextErrors.fullName &&
      (normalizedMessage.includes('full name') || normalizedMessage.includes('fullname'))
    ) {
      nextErrors.fullName = message
      continue
    }

    if (!nextErrors.form) {
      nextErrors.form = message
    }
  }

  if (!nextErrors.form && !nextErrors.fullName && !nextErrors.username) {
    nextErrors.form = 'Unable to save profile right now.'
  }

  return nextErrors
}

export default function AccountScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const scrollViewRef = useRef<ScrollViewType>(null)
  const fullNameInputRef = useRef<TextInput>(null)
  const focusedFieldRef = useRef<FocusableField | null>(null)
  const focusedInputRef = useRef<TextInput | null>(null)
  const usernameInputRef = useRef<TextInput>(null)
  const { user } = useAuthStore()
  const setPendingFeedbackMessage = useProfileUiStore((state) => state.setPendingFeedbackMessage)
  const { mutateAsync: updateProfile, isPending: isSaving } = useUpdateProfile()

  const initialFullName = useMemo(() => {
    return (
      user?.fullName?.trim() || [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
    )
  }, [user?.firstName, user?.fullName, user?.lastName])
  const initialUsername = useMemo(() => normalizeUsername(user?.username ?? ''), [user?.username])
  const displayName = useMemo(
    () =>
      getDisplayName({
        email: user?.email,
        firstName: user?.firstName,
        fullName: user?.fullName,
        lastName: user?.lastName,
      }),
    [user?.email, user?.firstName, user?.fullName, user?.lastName],
  )

  const [fullName, setFullName] = useState(initialFullName)
  const [username, setUsername] = useState(initialUsername)
  const [focusedInput, setFocusedInput] = useState<FocusableField | null>(null)
  const [debouncedUsername, setDebouncedUsername] = useState(initialUsername)
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({
    form: '',
    fullName: '',
    username: '',
  })
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  const trimmedFullName = fullName.trim()
  const normalizedUsername = normalizeUsername(username)
  const hasUsernameChanged = normalizedUsername !== initialUsername
  const clientFullNameError = getFullNameError(fullName)
  const clientUsernameError = getUsernameError(normalizedUsername)
  const resolvedFullNameError = fieldErrors.fullName || clientFullNameError
  const resolvedUsernameError = fieldErrors.username || clientUsernameError
  const shouldCheckUsername =
    hasUsernameChanged && normalizedUsername.length > 0 && !clientUsernameError
  const usernameAvailability = useUsernameAvailability(debouncedUsername, shouldCheckUsername)
  const isCheckingUsername =
    shouldCheckUsername &&
    (debouncedUsername !== normalizedUsername || usernameAvailability.isFetching)
  const isUsernameTaken = shouldCheckUsername && usernameAvailability.data?.available === false
  const isUsernameAvailable = shouldCheckUsername && usernameAvailability.data?.available === true

  const previewName = trimmedFullName || displayName
  const previewHandle = normalizedUsername || 'username'
  const isDirty = trimmedFullName !== initialFullName || normalizedUsername !== initialUsername
  const saveDisabled =
    !isDirty ||
    Boolean(resolvedFullNameError) ||
    Boolean(resolvedUsernameError) ||
    isCheckingUsername ||
    isUsernameTaken ||
    isSaving

  const scrollFieldIntoView = useCallback((field: FocusableField, input: TextInput | null) => {
    const nodeHandle = input ? findNodeHandle(input) : null
    if (!nodeHandle) return

    const additionalOffset = field === 'username' ? 130 : 96
    scrollViewRef.current?.scrollResponderScrollNativeHandleToKeyboard(
      nodeHandle,
      additionalOffset,
      true,
    )
  }, [])

  const handleFieldFocus = useCallback(
    (field: FocusableField, input: TextInput | null) => {
      setFocusedInput(field)
      focusedFieldRef.current = field
      focusedInputRef.current = input

      const scrollToField = () => {
        scrollFieldIntoView(field, input)
      }

      requestAnimationFrame(scrollToField)
      setTimeout(scrollToField, 48)
      setTimeout(scrollToField, 180)
    },
    [scrollFieldIntoView],
  )

  useEffect(() => {
    if (!user) {
      return
    }

    setFullName((currentFullName) => currentFullName || initialFullName)
    setUsername((currentUsername) => currentUsername || initialUsername)
    setDebouncedUsername((currentDebouncedUsername) => currentDebouncedUsername || initialUsername)
  }, [initialFullName, initialUsername, user])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedUsername(normalizedUsername)
    }, 280)

    return () => clearTimeout(timer)
  }, [normalizedUsername])

  useEffect(() => {
    setFieldErrors((currentErrors) => ({
      ...currentErrors,
      form: '',
      fullName: '',
    }))
  }, [fullName])

  useEffect(() => {
    setFieldErrors((currentErrors) => ({
      ...currentErrors,
      form: '',
      username: '',
    }))
  }, [username])

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setIsKeyboardVisible(true)
      setKeyboardHeight(event.endCoordinates.height)

      if (focusedFieldRef.current && focusedInputRef.current) {
        scrollFieldIntoView(focusedFieldRef.current, focusedInputRef.current)
      }
    })
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setIsKeyboardVisible(false)
      setKeyboardHeight(0)
    })

    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [scrollFieldIntoView])

  usePreventRemove(isDirty && !isSaving, ({ data }) => {
    Alert.alert('Discard changes?', 'You have unsaved profile edits. Leave without saving?', [
      {
        text: 'Stay',
        style: 'cancel',
      },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          navigation.dispatch(data.action)
        },
      },
    ])
  })

  const closeAccountScreen = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }

    router.replace('/(tabs)/profile')
  }, [router])

  if (!user) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-primary">
        <ActivityIndicator color="#FF6B2C" size="large" />
      </View>
    )
  }

  const statusText =
    resolvedUsernameError ||
    (isCheckingUsername
      ? 'Checking availability...'
      : isUsernameAvailable
        ? 'Username available'
        : isUsernameTaken
          ? 'Username already taken'
          : hasUsernameChanged && usernameAvailability.error
            ? 'Unable to verify right now.'
            : 'This is your public handle across Velora.')

  const statusColorClass =
    resolvedUsernameError || isUsernameTaken
      ? 'text-status-error'
      : isUsernameAvailable
        ? 'text-call-green'
        : 'text-text-secondary'

  const handleSubmit = async () => {
    Keyboard.dismiss()
    setFieldErrors((currentErrors) => ({
      ...currentErrors,
      form: '',
    }))

    if (saveDisabled) {
      return
    }

    const payload: UserProfileUpdateInput = {}

    if (trimmedFullName !== initialFullName) {
      payload.fullName = trimmedFullName
    }

    if (normalizedUsername !== initialUsername) {
      payload.username = normalizedUsername
    }

    try {
      await updateProfile(payload)
      setPendingFeedbackMessage('Profile updated')
      closeAccountScreen()
    } catch (error) {
      setFieldErrors(resolveProfileFieldErrors(error))
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg-primary"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View className="flex-1">
          <View className="absolute right-[-42px] top-[72px] h-40 w-40 rounded-full bg-[#FFF1E8]" />
          <View className="absolute left-[-54px] top-[188px] h-28 w-28 rounded-full bg-[#FFF6EF]" />

          <ScrollView
            ref={scrollViewRef}
            className="flex-1"
            contentContainerStyle={{
              paddingBottom:
                148 + Math.max(insets.bottom, 20) + (isKeyboardVisible ? keyboardHeight : 0),
              paddingHorizontal: 24,
              paddingTop: insets.top + 14,
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="flex-row items-center">
              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full border border-[#F1E3D7] bg-white"
                disabled={isSaving}
                onPress={() => {
                  closeAccountScreen()
                }}
              >
                <MaterialIcons name="arrow-back" size={22} color="#1C1C1E" />
              </Pressable>

              <View className="ml-4 flex-1">
                <Text className="text-xs2 uppercase tracking-[1.2px] text-text-muted">Account</Text>
                <Text className="mt-1 font-heading text-xl text-text-primary">Edit profile</Text>
              </View>
            </View>

            <LinearGradient
              colors={['#FFF7EF', '#FFFFFF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              className="mt-5 overflow-hidden rounded-[30px] border border-border-light px-4 py-4"
              style={{ borderCurve: 'continuous' }}
            >
              <View
                pointerEvents="none"
                className="absolute -right-7 -top-9 h-24 w-24 rounded-full"
                style={{ backgroundColor: 'rgba(255, 107, 44, 0.10)' }}
              />

              <View className="flex-row items-center">
                {user.picture ? (
                  <Image
                    source={{ uri: user.picture }}
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 36,
                      backgroundColor: '#F5F5F5',
                    }}
                  />
                ) : (
                  <View className="h-[72px] w-[72px] items-center justify-center rounded-full bg-surface-muted">
                    <Text className="font-heading text-[24px] text-text-primary">
                      {getInitials(previewName)}
                    </Text>
                  </View>
                )}

                <View className="ml-4 flex-1">
                  <Text className="font-heading text-[24px] leading-[28px] text-text-primary">
                    {previewName}
                  </Text>
                  <View className="mt-2 self-start rounded-full border border-border-light bg-white px-3 py-1.5">
                    <Text className="text-xs2 uppercase tracking-[1.1px] text-text-secondary">
                      @{previewHandle}
                    </Text>
                  </View>
                </View>
              </View>

              <View className="mt-5 gap-4">
                <View>
                  <View className={inputClassName(focusedInput === 'fullName')}>
                    <Text className="mb-1.5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                      Full name
                    </Text>
                    <TextInput
                      ref={fullNameInputRef}
                      className="py-1 text-[18px] font-semibold text-text-primary"
                      placeholder="Your full name"
                      placeholderTextColor="#AEAEB2"
                      value={fullName}
                      onChangeText={setFullName}
                      onFocus={() => handleFieldFocus('fullName', fullNameInputRef.current)}
                      onBlur={() => {
                        setFocusedInput(null)
                        focusedFieldRef.current = null
                        focusedInputRef.current = null
                      }}
                      autoCapitalize="words"
                      autoCorrect={false}
                      editable={!isSaving}
                      maxLength={MAX_FULL_NAME_LENGTH}
                      returnKeyType="next"
                      onSubmitEditing={() => usernameInputRef.current?.focus()}
                    />
                  </View>
                  <Text
                    className={cn(
                      'mt-2 px-1 text-sm2',
                      resolvedFullNameError ? 'text-status-error' : 'text-text-secondary',
                    )}
                  >
                    {resolvedFullNameError || 'Shown on your profile.'}
                  </Text>
                </View>

                <View>
                  <View className={inputClassName(focusedInput === 'username')}>
                    <Text className="mb-1.5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                      Username
                    </Text>
                    <View className="flex-row items-center">
                      <Text className="pr-1 text-[18px] font-semibold text-text-primary">@</Text>
                      <TextInput
                        ref={usernameInputRef}
                        className="flex-1 py-1 text-[18px] font-semibold text-text-primary"
                        placeholder="username"
                        placeholderTextColor="#AEAEB2"
                        value={username}
                        onChangeText={(value) => setUsername(normalizeUsername(value))}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!isSaving}
                        maxLength={MAX_USERNAME_LENGTH}
                        onFocus={() => handleFieldFocus('username', usernameInputRef.current)}
                        onBlur={() => {
                          setFocusedInput(null)
                          focusedFieldRef.current = null
                          focusedInputRef.current = null
                        }}
                        returnKeyType="done"
                        onSubmitEditing={() => {
                          void handleSubmit()
                        }}
                      />
                    </View>
                  </View>
                  <Text className={cn('mt-2 px-1 text-sm2', statusColorClass)}>{statusText}</Text>
                </View>
              </View>
            </LinearGradient>
          </ScrollView>

          <View
            className="border-t border-border-light bg-white px-6 pt-4"
            style={{ paddingBottom: Math.max(insets.bottom, 20) + 8 }}
          >
            {fieldErrors.form ? (
              <View className="mb-4 rounded-[18px] bg-[#FFE8E8] px-4 py-3">
                <Text className="text-center text-base2 font-medium text-status-error">
                  {fieldErrors.form}
                </Text>
              </View>
            ) : null}

            <Pressable
              className={cn(
                'h-[52px] items-center justify-center rounded-full',
                saveDisabled ? 'bg-[#E8DED6]' : 'bg-brand',
              )}
              disabled={saveDisabled}
              onPress={() => {
                void handleSubmit()
              }}
            >
              {isSaving ? (
                <View className="flex-row items-center">
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text className="ml-2 text-base font-bold text-white">Saving...</Text>
                </View>
              ) : (
                <View className="flex-row items-center">
                  <Text
                    className={cn(
                      'text-base font-bold',
                      saveDisabled ? 'text-text-muted' : 'text-white',
                    )}
                  >
                    Save changes
                  </Text>
                  {!saveDisabled ? (
                    <MaterialIcons
                      name="check"
                      size={18}
                      color="#FFFFFF"
                      style={{ marginLeft: 8 }}
                    />
                  ) : null}
                </View>
              )}
            </Pressable>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  )
}
