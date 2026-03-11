import { MaterialIcons } from '@expo/vector-icons'
import { Link, useRouter } from 'expo-router'
import React, { useState } from 'react'
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'

import { authApi } from '../../src/api/auth.api'

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const router = useRouter()

  const handleRegister = async () => {
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    try {
      setIsLoading(true)
      setError('')
      await authApi.register({ email, password, firstName, lastName })
      router.push(`/verify-email?email=${encodeURIComponent(email)}`)
    } catch (err: unknown) {
      const error = err as Error & { response?: { data?: { message?: string }; status?: number } }
      const errorMsg = error?.response?.data?.message || 'Registration failed'
      setError(errorMsg)
      Alert.alert('Error', errorMsg)
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
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#f8fafc" />
          </TouchableOpacity>
        </View>

        <View style={styles.header}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join our messaging community.</Text>
        </View>

        <View style={styles.formSection}>
          <View style={styles.row}>
            <View style={styles.halfInputContainer}>
              <View
                style={[
                  styles.inputGroup,
                  focusedInput === 'firstName' && styles.inputGroupFocused,
                ]}
              >
                <TextInput
                  style={styles.input}
                  placeholder="First Name"
                  placeholderTextColor="#94a3b8"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  onFocus={() => setFocusedInput('firstName')}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>
            </View>

            <View style={styles.halfInputContainer}>
              <View
                style={[styles.inputGroup, focusedInput === 'lastName' && styles.inputGroupFocused]}
              >
                <TextInput
                  style={styles.input}
                  placeholder="Last Name"
                  placeholderTextColor="#94a3b8"
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  onFocus={() => setFocusedInput('lastName')}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>
            </View>
          </View>

          <View style={styles.fullInputContainer}>
            <View style={[styles.inputGroup, focusedInput === 'email' && styles.inputGroupFocused]}>
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor="#94a3b8"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                onFocus={() => setFocusedInput('email')}
                onBlur={() => setFocusedInput(null)}
              />
            </View>
          </View>

          <View style={styles.fullInputContainer}>
            <View
              style={[styles.inputGroup, focusedInput === 'password' && styles.inputGroupFocused]}
            >
              <View style={styles.inputInner}>
                <TextInput
                  style={styles.inputPassword}
                  placeholder="Password"
                  placeholderTextColor="#94a3b8"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  onFocus={() => setFocusedInput('password')}
                  onBlur={() => setFocusedInput(null)}
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
          </View>

          <View style={styles.fullInputContainer}>
            <View
              style={[
                styles.inputGroup,
                focusedInput === 'confirmPassword' && styles.inputGroupFocused,
              ]}
            >
              <TextInput
                style={styles.input}
                placeholder="Confirm password"
                placeholderTextColor="#94a3b8"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                onFocus={() => setFocusedInput('confirmPassword')}
                onBlur={() => setFocusedInput(null)}
              />
            </View>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.buttonWrapper}
              onPress={handleRegister}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>{isLoading ? 'Loading...' : 'Sign Up'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity>
              <Text style={styles.signinText}>Sign in</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  buttonContainer: {
    marginTop: 24,
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
    marginTop: 32,
  },
  footerText: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  formSection: {
    gap: 16,
    marginTop: 16,
  },
  fullInputContainer: {
    flexDirection: 'column',
  },
  halfInputContainer: {
    flex: 1,
    flexDirection: 'column',
  },
  header: {
    paddingBottom: 24,
    paddingTop: 8,
  },
  iconContainerRight: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
  },
  input: {
    color: '#f8fafc',
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  inputGroup: {
    backgroundColor: '#1E1E24',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  inputGroupFocused: {
    backgroundColor: '#26262E',
  },
  inputInner: {
    flexDirection: 'row',
    position: 'relative',
  },
  inputPassword: {
    color: '#f8fafc',
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    paddingLeft: 16,
    paddingRight: 48,
    paddingVertical: 16,
  },
  navBar: {
    alignItems: 'flex-start',
    paddingBottom: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingBottom: 48,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 48,
  },
  signinText: {
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
  },
})
