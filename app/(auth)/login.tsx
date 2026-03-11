import { MaterialIcons } from '@expo/vector-icons'
import { Link, useRouter } from 'expo-router'
import React, { useState } from 'react'
import {
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native'

import { authApi } from '../../src/api/auth.api'
import { useAuthStore } from '../../src/stores/authStore'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [isEmailFocused, setIsEmailFocused] = useState(false)
  const [isPasswordFocused, setIsPasswordFocused] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { setUser } = useAuthStore()
  const router = useRouter()

  const handleLogin = async () => {
    try {
      setIsLoading(true)
      setError('')
      await authApi.login({ email, password })
      const meResponse = await authApi.me()

      setUser(meResponse.user)
      router.replace('/')
    } catch (err: unknown) {
      const error = err as Error & { response?: { data?: { message?: string }; status?: number } }
      if (error?.response?.status === 403) {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`)
      } else {
        const errorMsg = error?.response?.data?.message || 'Login failed'
        setError(errorMsg)
        Alert.alert('Error', errorMsg)
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.formContainer}>
            {/* Top App Bar area spacing */}
            <View style={styles.header}></View>

            <View style={styles.content}>
              {/* Header Section */}
              <View style={styles.logoContainer}>
                <View style={styles.iconCircle}>
                  <MaterialIcons name="forum" size={48} color="#0A7CFF" />
                </View>
                <Text style={styles.title}>Sign In</Text>
                <Text style={styles.subtitle}>Welcome back to Messenger!</Text>
              </View>

              {/* Form Section */}
              <View style={styles.formSection}>
                {/* Email Input */}
                <View style={[styles.inputGroup, isEmailFocused && styles.inputGroupFocused]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Email address"
                    placeholderTextColor="#94a3b8"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    onFocus={() => setIsEmailFocused(true)}
                    onBlur={() => setIsEmailFocused(false)}
                  />
                </View>

                {/* Password Input */}
                <View style={[styles.inputGroup, isPasswordFocused && styles.inputGroupFocused]}>
                  <View style={styles.inputInner}>
                    <TextInput
                      style={styles.input}
                      placeholder="Password"
                      placeholderTextColor="#94a3b8"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      onFocus={() => setIsPasswordFocused(true)}
                      onBlur={() => setIsPasswordFocused(false)}
                    />
                    <TouchableOpacity
                      style={styles.iconContainerRight}
                      onPress={() => setShowPassword(!showPassword)}
                    >
                      <MaterialIcons
                        name={showPassword ? 'visibility' : 'visibility-off'}
                        size={20}
                        color="#94a3b8"
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                {/* Forgot Password Link */}
                <View style={styles.forgotPasswordContainer}>
                  <Link href="/(auth)/forgot-password" asChild>
                    <TouchableOpacity>
                      <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                    </TouchableOpacity>
                  </Link>
                </View>

                {/* Sign In Button */}
                <View style={styles.buttonContainer}>
                  <TouchableOpacity
                    style={styles.buttonWrapper}
                    onPress={handleLogin}
                    disabled={isLoading}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.buttonText}>{isLoading ? 'Loading...' : 'Sign In'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Footer */}
              <View style={styles.footer}>
                <Text style={styles.footerText}>Don&apos;t have an account? </Text>
                <Link href="/(auth)/register" asChild>
                  <TouchableOpacity>
                    <Text style={styles.signupText}>Sign up</Text>
                  </TouchableOpacity>
                </Link>
              </View>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  buttonContainer: {
    marginTop: 32,
  },
  buttonText: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  buttonWrapper: {
    alignItems: 'center',
    backgroundColor: '#0A7CFF',
    borderRadius: 12,
    flexDirection: 'row',
    height: 56,
    justifyContent: 'center',
  },
  container: {
    backgroundColor: '#121212',
    flex: 1,
  },
  content: {
    flex: 1,
    paddingBottom: 48,
    paddingHorizontal: 24,
  },
  errorText: {
    color: '#ef4444',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 'auto',
    paddingTop: 32,
  },
  footerText: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  forgotPasswordContainer: {
    alignItems: 'flex-end',
    marginTop: 0,
  },
  forgotPasswordText: {
    color: '#0A7CFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  formContainer: {
    flex: 1,
  },
  formSection: {
    flex: 1,
  },
  header: {
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 78,
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: 'rgba(10, 124, 255, 0.15)',
    borderRadius: 48,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  iconContainerRight: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  input: {
    color: '#f8fafc',
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    paddingHorizontal: 16,
  },
  inputGroup: {
    backgroundColor: '#1E1E24',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    marginBottom: 16,
  },
  inputGroupFocused: {
    backgroundColor: '#26262E',
  },
  inputInner: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
    marginTop: 24,
  },
  scrollContent: {
    flexGrow: 1,
  },
  signupText: {
    color: '#0A7CFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  subtitle: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    marginTop: 8,
  },
  title: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    marginTop: 24,
  },
})
