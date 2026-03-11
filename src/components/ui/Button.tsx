import React from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  type TouchableOpacityProps,
} from 'react-native'

import { colors, radius, spacing } from '../../constants/theme'

import { Typography } from './Typography'

interface ButtonProps extends TouchableOpacityProps {
  title: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  isLoading?: boolean
}

export function Button({
  title,
  variant = 'primary',
  isLoading = false,
  style,
  disabled,
  ...props
}: ButtonProps) {
  const getBackgroundColor = () => {
    if (variant === 'primary') return colors.brand.primary
    if (variant === 'secondary') return colors.surface.card
    if (variant === 'outline' || variant === 'ghost') return 'transparent'
    return colors.brand.primary
  }

  const getTextColor = () => {
    if (variant === 'primary') return colors.text.primary
    if (variant === 'outline') return colors.brand.primary
    if (variant === 'ghost') return colors.text.secondary
    return colors.text.primary
  }

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: getBackgroundColor() },
        variant === 'outline' && styles.outline,
        (disabled || isLoading) && styles.disabled,
        style,
      ]}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
      {...props}
    >
      {isLoading ? (
        <ActivityIndicator color={getTextColor()} />
      ) : (
        <Typography variant="button" color={getTextColor()} align="center">
          {title}
        </Typography>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  disabled: {
    opacity: 0.6,
  },
  outline: {
    borderColor: colors.brand.primary,
    borderWidth: 1,
  },
})
