import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
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

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const router = useRouter()

  const handleReset = async () => {
    try {
      setIsLoading(true)
      await authApi.forgotPassword(email)
      Alert.alert('Reset Link Sent', 'Check your email for instructions.', [
        {
          text: 'OK',
          onPress: () => router.push(`/reset-password?email=${encodeURIComponent(email)}`),
        },
      ])
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = err as Error & { response?: any }
      Alert.alert('Error', error?.response?.data?.message || 'Failed to request reset')
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
            <View style={styles.content}>
              <View style={styles.navBar}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                  <MaterialIcons name="chevron-left" size={32} color="#f8fafc" />
                </TouchableOpacity>
              </View>

              <View style={styles.header}>
                <Text style={styles.title}>Forgot Password</Text>
                <Text style={styles.subtitle}>
                  Enter your email address to receive a secure link to reset your password.
                </Text>
              </View>

              <View style={styles.formSection}>
                <View style={styles.inputWrapper}>
                  <View style={[styles.inputGroup, isFocused && styles.inputGroupFocused]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Email address"
                      placeholderTextColor="#94a3b8"
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                    />
                  </View>
                </View>
              </View>

              <View style={styles.actionsContainer}>
                <TouchableOpacity
                  style={styles.buttonWrapper}
                  onPress={handleReset}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  <Text style={styles.buttonText}>
                    {isLoading ? 'Loading...' : 'Send Reset Code'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ghostButton}
                  onPress={() => router.back()}
                  activeOpacity={0.6}
                >
                  <Text style={styles.ghostButtonText}>Back to Login</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  actionsContainer: {
    gap: 16,
    marginTop: 32,
    paddingBottom: 32,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
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
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 24,
  },
  formContainer: {
    flex: 1,
  },
  formSection: {
    marginTop: 32,
  },
  ghostButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
  },
  ghostButtonText: {
    color: '#0A7CFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  header: {
    marginTop: 24,
  },
  input: {
    color: '#f8fafc',
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    height: 56,
    paddingHorizontal: 16,
  },
  inputGroup: {
    backgroundColor: '#1E1E24',
    borderRadius: 12,
    flexDirection: 'row',
  },
  inputGroupFocused: {
    backgroundColor: '#26262E',
  },
  inputWrapper: {
    flexDirection: 'column',
  },
  navBar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    marginLeft: -12,
  },
  scrollContent: {
    flexGrow: 1,
  },
  subtitle: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  title: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
  },
})
