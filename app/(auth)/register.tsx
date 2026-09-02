import { MaterialIcons } from '@expo/vector-icons'
import { Link, useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { useKeyboardState } from 'react-native-keyboard-controller'
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { authApi } from '../../src/api/auth.api'
import { ShortFormScreen } from '../../src/components/base/ShortFormScreen'
import { cn } from '../../src/lib/cn'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const steps = [
  {
    eyebrow: 'PROFILE DETAILS',
    title: 'Tell us about you',
    subtitle: 'Use the name your friends will recognize.',
    cta: 'Continue',
  },
  {
    eyebrow: 'ACCOUNT DETAILS',
    title: 'Set up your login',
    subtitle: 'Use an email you can access and a secure password.',
    cta: 'Create my account',
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
    'rounded-[20px] border bg-[#FFFBF8] px-4 py-3.5',
    isFocused ? 'border-brand bg-[#FFF7F2]' : 'border-[#F2DED0]',
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
  const fullNameInputRef = useRef<TextInput>(null)
  const emailInputRef = useRef<TextInput>(null)
  const passwordInputRef = useRef<TextInput>(null)
  const confirmPasswordInputRef = useRef<TextInput>(null)
  const isKeyboardVisible = useKeyboardState((state) => state.isVisible)

  const [step, setStep] = useState(0)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [focusedInput, setFocusedInput] = useState<FocusableField | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [touchedFields, setTouchedFields] = useState<Partial<Record<FocusableField, boolean>>>({})

  const fullNameError = getFullNameError(fullName)
  const emailError = getEmailError(email)
  const passwordError = getPasswordError(password)
  const confirmPasswordError = getConfirmPasswordError(password, confirmPassword)
  const currentStep = steps[step]
  const isPrimaryDisabled =
    isSubmitting ||
    (step === 0
      ? Boolean(fullNameError)
      : Boolean(emailError || passwordError || confirmPasswordError))
  const validationErrors = [fullNameError, emailError, passwordError, confirmPasswordError].filter(
    Boolean,
  )
  const isValidationError = Boolean(error && validationErrors.includes(error))

  const handleFieldFocus = (field: FocusableField) => {
    setFocusedInput(field)
  }

  const markFieldTouched = (field: FocusableField) => {
    setTouchedFields((currentFields) => ({ ...currentFields, [field]: true }))
  }

  const clearError = () => {
    if (error) setError('')
  }

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
    <View className="flex-1 bg-bg-primary">
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ShortFormScreen
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom: Math.max(insets.bottom + 28, 44),
            paddingHorizontal: 24,
            paddingTop: insets.top + 10,
          }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1">
            <View className="flex-row items-center">
              <TouchableOpacity
                onPress={handleBack}
                className="h-11 flex-row items-center justify-center rounded-[16px] border border-[#EEE7E2] bg-white px-3"
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={step === 0 ? 'Back to sign in' : 'Back to profile details'}
              >
                <MaterialIcons name="arrow-back" size={20} color="#1C1C1E" />
                <Text className="ml-1.5 text-sm2 font-semibold text-text-primary">Back</Text>
              </TouchableOpacity>

              <View className="ml-4 flex-1">
                <View className="mb-2 flex-row items-center justify-between">
                  <Text className="text-xs2 font-semibold uppercase tracking-[1px] text-text-muted">
                    Step {step + 1} of {steps.length}
                  </Text>
                  <Text className="text-xs2 font-semibold text-brand">{currentStep.eyebrow}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  {steps.map((_, index) => (
                    <StepIndicator key={index} active={index <= step} />
                  ))}
                </View>
              </View>
            </View>

            <View className="pt-6">
              <Text className="font-heading text-[32px] leading-[36px] tracking-[-0.6px] text-text-primary">
                {currentStep.title}
              </Text>
              <Text className="mt-2 text-base font-sans leading-6 text-text-secondary">
                {currentStep.subtitle}
              </Text>
            </View>

            <Animated.View
              key={step}
              entering={FadeInRight.duration(220)}
              exiting={FadeOutLeft.duration(180)}
              className="mt-6 flex-1"
            >
              {step === 0 ? (
                <View className="flex-1">
                  <View>
                    <Text className="mb-2 text-sm2 font-semibold text-text-primary">Full name</Text>
                    <View className={inputClassName(focusedInput === 'fullName')}>
                      <View className="flex-row items-center">
                        <MaterialIcons name="person-outline" size={20} color="#FF8A5B" />
                        <TextInput
                          ref={fullNameInputRef}
                          className="ml-3 flex-1 py-1 text-[16px] font-medium text-text-primary"
                          placeholder="Enter your full name"
                          placeholderTextColor="#9A9694"
                          value={fullName}
                          onChangeText={(value) => {
                            setFullName(value)
                            clearError()
                          }}
                          autoCapitalize="words"
                          onFocus={() => handleFieldFocus('fullName')}
                          onBlur={() => {
                            markFieldTouched('fullName')
                            setFocusedInput(null)
                          }}
                          maxLength={80}
                          returnKeyType="done"
                          onSubmitEditing={Keyboard.dismiss}
                        />
                      </View>
                    </View>
                    <Text
                      className={cn(
                        'mt-2 text-base2 leading-5',
                        touchedFields.fullName && fullNameError
                          ? 'font-medium text-status-error'
                          : 'text-text-secondary',
                      )}
                    >
                      {touchedFields.fullName && fullNameError
                        ? fullNameError
                        : 'This name will be visible on your profile.'}
                    </Text>
                  </View>
                </View>
              ) : null}

              {step === 1 ? (
                <View className="flex-1 gap-4">
                  <View>
                    <Text className="mb-2 text-sm2 font-semibold text-text-primary">
                      Email address
                    </Text>
                    <View className={inputClassName(focusedInput === 'email')}>
                      <TextInput
                        ref={emailInputRef}
                        className="py-1 text-[16px] font-medium text-text-primary"
                        placeholder="name@email.com"
                        placeholderTextColor="#9A9694"
                        value={email}
                        onChangeText={(value) => {
                          setEmail(value)
                          clearError()
                        }}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        autoCorrect={false}
                        onFocus={() => handleFieldFocus('email')}
                        onBlur={() => {
                          markFieldTouched('email')
                          setFocusedInput(null)
                        }}
                        returnKeyType="next"
                        blurOnSubmit={false}
                        onSubmitEditing={() => passwordInputRef.current?.focus()}
                      />
                    </View>
                    <Text
                      className={cn(
                        'mt-2 text-base2 leading-5',
                        touchedFields.email && emailError
                          ? 'font-medium text-status-error'
                          : 'text-text-secondary',
                      )}
                    >
                      {touchedFields.email && emailError
                        ? emailError
                        : 'We will send your verification code here.'}
                    </Text>
                  </View>

                  <View>
                    <Text className="mb-2 text-sm2 font-semibold text-text-primary">Password</Text>
                    <View className={inputClassName(focusedInput === 'password')}>
                      <View className="flex-row items-center">
                        <TextInput
                          ref={passwordInputRef}
                          className="flex-1 py-1 text-[16px] font-medium text-text-primary"
                          placeholder="At least 8 characters"
                          placeholderTextColor="#9A9694"
                          value={password}
                          onChangeText={(value) => {
                            setPassword(value)
                            clearError()
                          }}
                          secureTextEntry={!showPassword}
                          autoCorrect={false}
                          onFocus={() => handleFieldFocus('password')}
                          onBlur={() => {
                            markFieldTouched('password')
                            setFocusedInput(null)
                          }}
                          returnKeyType="next"
                          blurOnSubmit={false}
                          onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
                        />
                        <TouchableOpacity
                          className="h-10 w-10 items-center justify-center"
                          onPress={() => setShowPassword((currentValue) => !currentValue)}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={showPassword ? 'Hide passwords' : 'Show passwords'}
                        >
                          <MaterialIcons
                            name={showPassword ? 'visibility' : 'visibility-off'}
                            size={20}
                            color="#6E6E73"
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <Text
                      className={cn(
                        'mt-2 text-base2 leading-5',
                        touchedFields.password && passwordError
                          ? 'font-medium text-status-error'
                          : 'text-text-secondary',
                      )}
                    >
                      {touchedFields.password && passwordError
                        ? passwordError
                        : 'Use 8 or more characters.'}
                    </Text>
                  </View>

                  <View>
                    <Text className="mb-2 text-sm2 font-semibold text-text-primary">
                      Confirm password
                    </Text>
                    <View className={inputClassName(focusedInput === 'confirmPassword')}>
                      <TextInput
                        ref={confirmPasswordInputRef}
                        className="py-1 text-[16px] font-medium text-text-primary"
                        placeholder="Re-enter your password"
                        placeholderTextColor="#9A9694"
                        value={confirmPassword}
                        onChangeText={(value) => {
                          setConfirmPassword(value)
                          clearError()
                        }}
                        secureTextEntry={!showPassword}
                        autoCorrect={false}
                        onFocus={() => handleFieldFocus('confirmPassword')}
                        onBlur={() => {
                          markFieldTouched('confirmPassword')
                          setFocusedInput(null)
                        }}
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                    </View>
                    {touchedFields.confirmPassword && confirmPasswordError ? (
                      <Text className="mt-2 text-base2 font-medium leading-5 text-status-error">
                        {confirmPasswordError}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </Animated.View>

            <View className="mt-auto pt-8">
              {error && !isValidationError ? (
                <View className="mb-4 rounded-[16px] bg-[#FFF0EF] px-4 py-3">
                  <Text className="text-center text-base2 font-medium text-status-error">
                    {error}
                  </Text>
                </View>
              ) : null}

              <TouchableOpacity
                className={cn(
                  'h-14 flex-row items-center justify-center rounded-[20px] bg-brand',
                  isPrimaryDisabled ? 'opacity-40' : null,
                )}
                onPress={handleNext}
                disabled={isPrimaryDisabled}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ disabled: isPrimaryDisabled }}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Text className="text-base font-bold text-white">{currentStep.cta}</Text>
                    <MaterialIcons
                      name={step === steps.length - 1 ? 'check' : 'arrow-forward'}
                      size={18}
                      color="#FFFFFF"
                      style={{ marginLeft: 8 }}
                    />
                  </>
                )}
              </TouchableOpacity>

              {!isKeyboardVisible ? (
                <>
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
              ) : null}
            </View>
          </View>
        </ShortFormScreen>
      </TouchableWithoutFeedback>
    </View>
  )
}
