import { MaterialIcons } from '@expo/vector-icons'
import { Link, useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Keyboard, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'
import { useKeyboardState } from 'react-native-keyboard-controller'
import Animated, { FadeInRight, FadeOutLeft, ReduceMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { authApi } from '../../src/api/auth.api'
import { AuthField } from '../../src/components/auth/AuthField'
import { AuthHeadline } from '../../src/components/auth/AuthHeadline'
import { AuthPrimaryButton } from '../../src/components/auth/AuthPrimaryButton'
import { ShortFormScreen } from '../../src/components/base/ShortFormScreen'
import { colors } from '../../src/constants/theme'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const steps = [
  {
    title: 'Tell us about you',
    subtitle: 'Use the name your friends will recognize.',
    cta: 'Continue',
  },
  {
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

type FocusableField = 'fullName' | 'email' | 'password' | 'confirmPassword'

function StepIndicator({ active }: { active: boolean }) {
  return (
    <View
      className={
        active ? 'h-1.5 flex-1 rounded-full bg-brand' : 'h-1.5 flex-1 rounded-full bg-surface-focus'
      }
    />
  )
}

export default function RegisterScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const fullNameInputRef = useRef<React.ComponentRef<typeof AuthField>>(null)
  const emailInputRef = useRef<React.ComponentRef<typeof AuthField>>(null)
  const passwordInputRef = useRef<React.ComponentRef<typeof AuthField>>(null)
  const confirmPasswordInputRef = useRef<React.ComponentRef<typeof AuthField>>(null)
  const isKeyboardVisible = useKeyboardState((state) => state.isVisible)

  const [step, setStep] = useState(0)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
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
    <View className="flex-1 bg-surface-cream">
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
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View className="flex-1">
            <View className="flex-row items-center">
              <TouchableOpacity
                onPress={handleBack}
                className="h-11 flex-row items-center justify-center rounded-[16px] border border-border-warm-soft bg-white px-3"
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={step === 0 ? 'Back to sign in' : 'Back to profile details'}
              >
                <MaterialIcons name="arrow-back" size={20} color={colors.text.primary} />
                <Text className="ml-1.5 text-sm2 font-semibold text-text-primary">Back</Text>
              </TouchableOpacity>

              <View className="ml-4 flex-1">
                <Text className="mb-2 text-xs2 font-semibold uppercase tracking-[1px] text-text-secondary">
                  Step {step + 1} of {steps.length}
                </Text>
                <View className="flex-row items-center gap-2">
                  {steps.map((_, index) => (
                    <StepIndicator key={index} active={index <= step} />
                  ))}
                </View>
              </View>
            </View>

            <View className="pt-6">
              <AuthHeadline size="hero" title={currentStep.title} />
              <Text className="mt-2 text-base font-sans leading-6 text-text-secondary">
                {currentStep.subtitle}
              </Text>
            </View>

            <Animated.View
              key={step}
              entering={FadeInRight.duration(220).reduceMotion(ReduceMotion.System)}
              exiting={FadeOutLeft.duration(180).reduceMotion(ReduceMotion.System)}
              className="mt-6 flex-1"
            >
              {step === 0 ? (
                <View className="flex-1">
                  <AuthField
                    ref={fullNameInputRef}
                    label="Full name"
                    icon="person-outline"
                    placeholder="Enter your full name"
                    value={fullName}
                    onChangeText={(value) => {
                      setFullName(value)
                      clearError()
                    }}
                    autoCapitalize="words"
                    onBlur={() => markFieldTouched('fullName')}
                    maxLength={80}
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    hint="This name will be visible on your profile."
                    error={touchedFields.fullName && fullNameError ? fullNameError : null}
                  />
                </View>
              ) : null}

              {step === 1 ? (
                <View className="flex-1 gap-4">
                  <AuthField
                    ref={emailInputRef}
                    label="Email address"
                    icon="mail-outline"
                    placeholder="name@email.com"
                    value={email}
                    onChangeText={(value) => {
                      setEmail(value)
                      clearError()
                    }}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoCorrect={false}
                    onBlur={() => markFieldTouched('email')}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => passwordInputRef.current?.focus()}
                    hint="We will send your verification code here."
                    error={touchedFields.email && emailError ? emailError : null}
                  />

                  <AuthField
                    ref={passwordInputRef}
                    label="Password"
                    icon="lock-outline"
                    placeholder="At least 8 characters"
                    value={password}
                    onChangeText={(value) => {
                      setPassword(value)
                      clearError()
                    }}
                    autoCorrect={false}
                    secureTextEntry={!showPassword}
                    onToggleSecure={() => setShowPassword((currentValue) => !currentValue)}
                    secureToggleLabels={{ show: 'Show passwords', hide: 'Hide passwords' }}
                    onBlur={() => markFieldTouched('password')}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
                    hint="Use 8 or more characters."
                    error={touchedFields.password && passwordError ? passwordError : null}
                  />

                  <AuthField
                    ref={confirmPasswordInputRef}
                    label="Confirm password"
                    icon="lock-outline"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChangeText={(value) => {
                      setConfirmPassword(value)
                      clearError()
                    }}
                    autoCorrect={false}
                    secureTextEntry={!showPassword}
                    onBlur={() => markFieldTouched('confirmPassword')}
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    error={
                      touchedFields.confirmPassword && confirmPasswordError
                        ? confirmPasswordError
                        : null
                    }
                  />
                </View>
              ) : null}
            </Animated.View>

            <View className="mt-auto pt-8">
              {error && !isValidationError ? (
                <View className="mb-4 rounded-[16px] bg-surface-error px-4 py-3">
                  <Text className="text-center text-base2 font-medium text-status-error-text">
                    {error}
                  </Text>
                </View>
              ) : null}

              <AuthPrimaryButton
                label={currentStep.cta}
                onPress={handleNext}
                disabled={isPrimaryDisabled}
                isLoading={isSubmitting}
                trailingIcon={step === steps.length - 1 ? 'check' : 'arrow-forward'}
              />

              {!isKeyboardVisible ? (
                <>
                  <View className="mt-6 flex-row items-center justify-center">
                    <Text className="text-base2 font-sans text-text-secondary">
                      Already have an account?{' '}
                    </Text>
                    <Link href="/(auth)/login" asChild>
                      <TouchableOpacity activeOpacity={0.7}>
                        <Text className="text-base2 font-semibold text-brand-text">Sign in</Text>
                      </TouchableOpacity>
                    </Link>
                  </View>
                </>
              ) : null}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ShortFormScreen>
    </View>
  )
}
