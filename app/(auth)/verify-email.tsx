import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'

import { authApi } from '../../src/api/auth.api'
import { useAuthStore } from '../../src/stores/authStore'

export default function VerifyEmailScreen() {
  const { email } = useLocalSearchParams<{ email: string }>()
  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [countdown, setCountdown] = useState(60)
  const [isFocused, setIsFocused] = useState(false)
  const router = useRouter()
  const { hydrateAuth } = useAuthStore()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    }
    return () => clearTimeout(timer)
  }, [countdown])

  const handleVerify = async () => {
    if (token.length < 6) {
      Alert.alert('Error', 'Please enter a 6-digit code')
      return
    }

    try {
      setIsLoading(true)
      await authApi.confirm(token)
      await hydrateAuth()
      router.replace('/')
    } catch (err: unknown) {
      const error = err as Error & { response?: { data?: { message?: string }; status?: number } }
      Alert.alert('Error', error?.response?.data?.message || 'Verification failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    setCountdown(60)
    Alert.alert('Sent', 'Verification code resent to your email.')
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.formContainer}>
        <View style={styles.content}>
          <View style={styles.navBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={24} color="#f8fafc" />
            </TouchableOpacity>
          </View>

          <View style={styles.header}>
            <Text style={styles.title}>Verify Email</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{'\n'}
              <Text style={styles.emailHighlight}>{email}</Text>
            </Text>
          </View>

          <View style={styles.formSection}>
            <View style={[styles.codeContainer, isFocused && styles.codeContainerFocused]}>
              <TextInput
                style={styles.codeInput}
                value={token}
                onChangeText={setToken}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="••••••"
                placeholderTextColor="#94a3b8"
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                textAlign="center"
              />
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.buttonWrapper}
                onPress={handleVerify}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                <Text style={styles.buttonText}>{isLoading ? 'Verifying...' : 'VERIFY'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Didn&apos;t receive the code?</Text>
            <View style={styles.resendRow}>
              {countdown > 0 ? (
                <>
                  <Text style={styles.resendTextDisabled}>Resend Code in</Text>
                  <Text style={styles.timerText}>00:{countdown.toString().padStart(2, '0')}</Text>
                </>
              ) : (
                <TouchableOpacity onPress={handleResend} activeOpacity={0.7}>
                  <Text style={styles.resendTextActive}>Resend Code</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </View>
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
  codeContainer: {
    backgroundColor: '#1E1E24',
    borderRadius: 12,
    height: 64,
    justifyContent: 'center',
    marginTop: 16,
    overflow: 'hidden',
  },
  codeContainerFocused: {
    backgroundColor: '#26262E',
  },
  codeInput: {
    color: '#f8fafc',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 32,
    letterSpacing: 16,
    textAlign: 'center',
  },
  container: {
    backgroundColor: '#121212',
    flex: 1,
  },
  content: {
    flex: 1,
    paddingBottom: 48,
    paddingHorizontal: 24,
    paddingTop: 64,
  },
  emailHighlight: {
    color: '#f8fafc',
    fontFamily: 'Inter_600SemiBold',
  },
  footer: {
    alignItems: 'center',
    gap: 8,
    marginTop: 'auto',
    paddingTop: 32,
  },
  footerText: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  formContainer: {
    flex: 1,
  },
  formSection: {
    marginTop: 32,
  },
  header: {
    gap: 8,
    marginTop: 32,
  },
  navBar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  resendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  resendTextActive: {
    color: '#0A7CFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  resendTextDisabled: {
    color: '#64748b',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  subtitle: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
  },
  timerText: {
    color: '#f8fafc',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  title: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
  },
})
