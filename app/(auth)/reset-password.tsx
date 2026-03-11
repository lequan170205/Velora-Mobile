import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useState } from 'react'
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

export default function ResetPasswordScreen() {
  const { email } = useLocalSearchParams<{ email: string }>()
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const router = useRouter()

  const handleReset = async () => {
    try {
      setIsLoading(true)
      await authApi.resetPassword({ email, token, newPassword })
      Alert.alert('Success', 'Your password has been reset.', [
        { text: 'OK', onPress: () => router.replace('/login') },
      ])
    } catch (err: unknown) {
      const error = err as Error & { response?: { data?: { message?: string }; status?: number } }
      Alert.alert('Error', error?.response?.data?.message || 'Failed to reset password')
    } finally {
      setIsLoading(false)
    }
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
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              Enter the reset code sent to your email and your new password to regain access.
            </Text>
          </View>

          <View style={styles.formSection}>
            <View style={styles.inputWrapper}>
              <View
                style={[styles.inputGroup, focusedInput === 'token' && styles.inputGroupFocused]}
              >
                <TextInput
                  style={styles.input}
                  placeholder="Enter 6-digit code"
                  placeholderTextColor="#94a3b8"
                  value={token}
                  onChangeText={setToken}
                  keyboardType="number-pad"
                  onFocus={() => setFocusedInput('token')}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>
            </View>

            <View style={styles.inputWrapper}>
              <View
                style={[
                  styles.inputGroup,
                  focusedInput === 'newPassword' && styles.inputGroupFocused,
                ]}
              >
                <View style={styles.inputInner}>
                  <TextInput
                    style={styles.inputPassword}
                    placeholder="New password"
                    placeholderTextColor="#94a3b8"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showPassword}
                    onFocus={() => setFocusedInput('newPassword')}
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
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.buttonWrapper}
              onPress={handleReset}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>{isLoading ? 'Loading...' : 'Reset Password'}</Text>
            </TouchableOpacity>
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
    paddingBottom: 32,
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
    gap: 16,
    marginTop: 32,
  },
  header: {
    marginTop: 24,
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
  inputInner: {
    flex: 1,
    flexDirection: 'row',
    position: 'relative',
  },
  inputPassword: {
    color: '#f8fafc',
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    height: 56,
    paddingLeft: 16,
    paddingRight: 48,
  },
  inputWrapper: {
    flexDirection: 'column',
  },
  navBar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    marginLeft: -12,
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
