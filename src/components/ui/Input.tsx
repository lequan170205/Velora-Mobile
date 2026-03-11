import React, { useState } from 'react'
import { Animated, StyleSheet, TextInput, View, type TextInputProps } from 'react-native'

import { colors, radius, spacing, typography } from '../../constants/theme'

import { Typography } from './Typography'

interface InputProps extends TextInputProps {
  label: string
  error?: string
}

export function Input({ label, error, style, onFocus, onBlur, ...props }: InputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const [focusAnim] = useState(new Animated.Value(props.value ? 1 : 0))

  const handleFocus: TextInputProps['onFocus'] = (e) => {
    setIsFocused(true)
    Animated.timing(focusAnim, {
      toValue: 1,
      duration: 150,
      useNativeDriver: false,
    }).start()
    onFocus?.(e)
  }

  const handleBlur: TextInputProps['onBlur'] = (e) => {
    setIsFocused(false)
    if (!props.value) {
      Animated.timing(focusAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: false,
      }).start()
    }
    onBlur?.(e)
  }

  return (
    <View style={styles.container}>
      <Animated.Text
        style={[
          styles.label,
          {
            top: focusAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [18, 8],
            }),
            fontSize: focusAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [typography.sizes.base, typography.sizes.xs],
            }),
            color: error
              ? colors.status.error
              : isFocused
                ? colors.brand.primary
                : colors.text.secondary,
          },
        ]}
      >
        {label}
      </Animated.Text>

      <TextInput
        style={[
          styles.input,
          isFocused && styles.inputFocused,
          !!error && styles.inputError,
          style,
        ]}
        placeholderTextColor="transparent"
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...props}
      />

      {!!error && (
        <Typography variant="caption" color={colors.status.error} style={styles.errorText}>
          {error}
        </Typography>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  errorText: {
    marginLeft: spacing.xs,
    marginTop: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface.input,
    // eslint-disable-next-line react-native/no-color-literals
    borderColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text.primary,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.base,
    height: 56,
    paddingHorizontal: spacing.lg,
    paddingTop: 16,
  },
  inputError: {
    borderColor: colors.status.error,
  },
  inputFocused: {
    backgroundColor: colors.bg.elevated,
    borderColor: colors.brand.primary,
  },
  label: {
    fontFamily: typography.fonts.bodyMedium,
    left: spacing.lg,
    position: 'absolute',
    zIndex: 1,
  },
})
