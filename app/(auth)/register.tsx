import { MaterialIcons } from '@expo/vector-icons'
import { Link, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  findNodeHandle,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { authApi } from '../../src/api/auth.api'
import { cn } from '../../src/lib/cn'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const steps = [
  {
    title: 'What is your name?',
    subtitle: 'This is shown on your profile.',
    cta: 'Next',
  },
  {
    title: 'Create your account',
    subtitle: 'Use your email and a secure password.',
    cta: 'Create account',
  },
] as const

const getFullNameError = (fullName: string) => {
  if (!fullName.trim()) return 'Enter your full name.'
  if (fullName.trim().length > 80) return 'Full name must be 80 characters or less.'
  return ''
}

const getEmailError = (email: string) => {
  if (!email.trim()) return 'Enter your email.'
  if (!EMAIL_PATTERN.test(email.trim().toLowerCase())) return 'Enter a valid email.'
  return ''
}

const getPasswordError = (password: string) => {
  if (!password) return 'Create a password.'
  if (password.length < 8) return 'Password must be at least 8 characters.'
  return ''
}

const getConfirmPasswordError = (password: string, confirmPassword: string) => {
  if (!confirmPassword) return 'Confirm your password.'
  if (password !== confirmPassword) return 'Passwords do not match.'
  return ''
}

const inputClassName = (isFocused: boolean) =>
  cn(
    'rounded-[22px] border bg-white px-4 py-3.5',
    isFocused ? 'border-brand bg-[#FFF7F1]' : 'border-[#F1E3D7]',
  )

type FocusableField = 'fullName' | 'email' | 'password' | 'confirmPassword'

function StepIndicator({ active }: { active: boolean }) {
  return (
    <View className={cn('h-1.5 flex-1 rounded-full', active ? 'bg-brand' : 'bg-surface-focus')} />
  )
}

export default function RegisterScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const scrollViewRef = useRef<ScrollView>(null)
  const fullNameInputRef = useRef<TextInput>(null)
  const emailInputRef = useRef<TextInput>(null)
  const passwordInputRef = useRef<TextInput>(null)
  const confirmPasswordInputRef = useRef<TextInput>(null)
  const focusedInputRef = useRef<TextInput | null>(null)
  const focusedFieldRef = useRef<FocusableField | null>(null)

  const [step, setStep] = useState(0)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [focusedInput, setFocusedInput] = useState<FocusableField | null>(null)
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fullNameError = getFullNameError(fullName)
  const emailError = getEmailError(email)
  const passwordError = getPasswordError(password)
  const confirmPasswordError = getConfirmPasswordError(password, confirmPassword)
  const currentStep = steps[step]
  const shouldCollapseFooter = isKeyboardVisible && step === 1

  const scrollFieldIntoView = useCallback(
    (field: FocusableField, input: TextInput | null) => {
      const nodeHandle = input ? findNodeHandle(input) : null
      if (!nodeHandle) return

      const additionalOffset = field === 'confirmPassword' ? 108 : step === 1 ? 88 : 64
      scrollViewRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        nodeHandle,
        additionalOffset,
        true,
      )
    },
    [step],
  )

  const handleFieldFocus = (field: FocusableField, input: TextInput | null) => {
    setFocusedInput(field)
    focusedFieldRef.current = field
    focusedInputRef.current = input

    const scrollToField = () => {
      scrollFieldIntoView(field, input)
    }

    requestAnimationFrame(scrollToField)
    setTimeout(scrollToField, 48)
    setTimeout(scrollToField, 180)
  }

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

  const handleBack = () => {
    if (step === 0) {
      router.back()
      return
    }

    Keyboard.dismiss()
    setError('')
    setStep((currentStep) => currentStep - 1)
  }

  const handleRegister = async () => {
    if (emailError) {
      setError(emailError)
      return
    }

    if (passwordError) {
      setError(passwordError)
      return
    }

    if (confirmPasswordError) {
      setError(confirmPasswordError)
      return
    }

    try {
      setIsSubmitting(true)
      setError('')

      await authApi.register({
        email: email.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
      })

      router.push(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`)
    } catch (err: unknown) {
      const requestError = err as Error & {
        response?: { data?: { message?: string | string[] } }
      }

      const errorMessage = requestError.response?.data?.message
      const resolvedMessage = Array.isArray(errorMessage) ? errorMessage[0] : errorMessage
      setError(resolvedMessage || 'Registration failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleNext = () => {
    Keyboard.dismiss()

    if (step === 0) {
      if (fullNameError) {
        setError(fullNameError)
        return
      }

      setError('')
      setStep(1)
      return
    }

    void handleRegister()
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-bg-primary" behavior="padding">
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView
          ref={scrollViewRef}
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom:
              Math.max(insets.bottom, 20) +
              (shouldCollapseFooter ? Math.max(140, Math.round(keyboardHeight * 0.4)) : 24),
            paddingHorizontal: 24,
            paddingTop: insets.top + 14,
          }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="absolute right-[-42px] top-[72px] h-40 w-40 rounded-full bg-[#FFF1E8]" />
          <View className="absolute left-[-54px] top-[188px] h-28 w-28 rounded-full bg-[#FFF6EF]" />

          <View className="flex-1">
            <View className="flex-row items-center justify-between">
              <TouchableOpacity
                onPress={handleBack}
                className="h-11 w-11 items-center justify-center rounded-full border border-[#F1E3D7] bg-white"
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="arrow-back" size={22} color="#1C1C1E" />
              </TouchableOpacity>

              <View className="ml-4 flex-1">
                <View className="flex-row items-center gap-2">
                  {steps.map((_, index) => (
                    <StepIndicator key={index} active={index <= step} />
                  ))}
                </View>
              </View>
            </View>

            <View className="pt-9">
              <Text className="font-heading text-[34px] leading-[38px] text-text-primary">
                {currentStep.title}
              </Text>
              <Text className="mt-2 text-base2 font-sans leading-6 text-text-secondary">
                {currentStep.subtitle}
              </Text>
            </View>

            <Animated.View
              key={step}
              entering={FadeInRight.duration(220)}
              exiting={FadeOutLeft.duration(180)}
              className="mt-8 flex-1"
            >
              {step === 0 ? (
                <View className="flex-1">
                  <View className="rounded-[28px] border border-[#F3E6DA] bg-white px-5 py-5">
                    <Text className="text-xs2 uppercase tracking-[1.2px] text-text-muted">
                      Display name
                    </Text>
                    <Text className="mt-2 font-heading text-[28px] leading-[32px] text-text-primary">
                      {fullName.trim() || 'Your full name'}
                    </Text>
                  </View>

                  <View className="mt-4">
                    <View className={inputClassName(focusedInput === 'fullName')}>
                      <Text className="mb-1.5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                        Full name
                      </Text>
                      <TextInput
                        ref={fullNameInputRef}
                        className="py-1 text-[18px] font-semibold text-text-primary"
                        placeholder="Enter your full name"
                        placeholderTextColor="#AEAEB2"
                        value={fullName}
                        onChangeText={setFullName}
                        autoCapitalize="words"
                        onFocus={() => handleFieldFocus('fullName', fullNameInputRef.current)}
                        onBlur={() => {
                          setFocusedInput(null)
                          focusedFieldRef.current = null
                          focusedInputRef.current = null
                        }}
                        maxLength={80}
                        returnKeyType="next"
                        onSubmitEditing={handleNext}
                      />
                    </View>
                  </View>
                </View>
              ) : null}

              {step === 1 ? (
                <View className="flex-1 gap-4">
                  <View className="rounded-[28px] border border-[#F3E6DA] bg-white px-5 py-5">
                    <View className="flex-row items-center justify-between">
                      <View>
                        <Text className="text-xs2 uppercase tracking-[1.2px] text-text-muted">
                          Sign in with
                        </Text>
                        <Text className="mt-2 font-heading text-[22px] leading-[28px] text-text-primary">
                          Email and password
                        </Text>
                      </View>
                      <View className="h-11 w-11 items-center justify-center rounded-full bg-[#FFF2E8]">
                        <MaterialIcons name="lock-outline" size={20} color="#D85A21" />
                      </View>
                    </View>
                  </View>

                  <View className={inputClassName(focusedInput === 'email')}>
                    <Text className="mb-1.5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                      Email
                    </Text>
                    <TextInput
                      ref={emailInputRef}
                      className="py-1 text-[16px] font-medium text-text-primary"
                      placeholder="name@email.com"
                      placeholderTextColor="#AEAEB2"
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      autoCorrect={false}
                      onFocus={() => handleFieldFocus('email', emailInputRef.current)}
                      onBlur={() => {
                        setFocusedInput(null)
                        focusedFieldRef.current = null
                        focusedInputRef.current = null
                      }}
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => passwordInputRef.current?.focus()}
                    />
                  </View>

                  <View className={inputClassName(focusedInput === 'password')}>
                    <Text className="mb-1.5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                      Password
                    </Text>
                    <View className="flex-row items-center">
                      <TextInput
                        ref={passwordInputRef}
                        className="flex-1 py-1 text-[16px] font-medium text-text-primary"
                        placeholder="At least 8 characters"
                        placeholderTextColor="#AEAEB2"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry={!showPassword}
                        autoCorrect={false}
                        onFocus={() => handleFieldFocus('password', passwordInputRef.current)}
                        onBlur={() => {
                          setFocusedInput(null)
                          focusedFieldRef.current = null
                          focusedInputRef.current = null
                        }}
                        returnKeyType="next"
                        blurOnSubmit={false}
                        onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
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

                  <View className={inputClassName(focusedInput === 'confirmPassword')}>
                    <Text className="mb-1.5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                      Confirm password
                    </Text>
                    <TextInput
                      ref={confirmPasswordInputRef}
                      className="py-1 text-[16px] font-medium text-text-primary"
                      placeholder="Re-enter your password"
                      placeholderTextColor="#AEAEB2"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry={!showPassword}
                      autoCorrect={false}
                      onFocus={() =>
                        handleFieldFocus('confirmPassword', confirmPasswordInputRef.current)
                      }
                      onBlur={() => {
                        setFocusedInput(null)
                        focusedFieldRef.current = null
                        focusedInputRef.current = null
                      }}
                      returnKeyType="done"
                      onSubmitEditing={handleNext}
                    />
                  </View>
                </View>
              ) : null}
            </Animated.View>

            <View className={cn(shouldCollapseFooter ? 'mt-4 pt-2' : 'mt-auto pt-8')}>
              {error ? (
                <View className="mb-4 rounded-[18px] bg-[#FFE8E8] px-4 py-3">
                  <Text className="text-center text-base2 font-medium text-status-error">
                    {error}
                  </Text>
                </View>
              ) : null}

              {!shouldCollapseFooter ? (
                <>
                  <TouchableOpacity
                    className="h-[52px] flex-row items-center justify-center rounded-full bg-brand"
                    onPress={handleNext}
                    disabled={isSubmitting}
                    activeOpacity={0.85}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <Text className="text-base font-bold text-white">{currentStep.cta}</Text>
                        <MaterialIcons
                          name="arrow-forward"
                          size={17}
                          color="#FFFFFF"
                          style={{ marginLeft: 8 }}
                        />
                      </>
                    )}
                  </TouchableOpacity>

                  <View className="mt-6 flex-row items-center justify-center">
                    <Text className="text-base2 font-sans text-text-secondary">
                      Already have an account?{' '}
                    </Text>
                    <Link href="/(auth)/login" asChild>
                      <TouchableOpacity activeOpacity={0.7}>
                        <Text className="text-base2 font-semibold text-brand">Sign in</Text>
                      </TouchableOpacity>
                    </Link>
                  </View>
                </>
              ) : (
                <View className="h-2" />
              )}
            </View>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  )
}
