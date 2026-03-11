/* eslint-disable react-native/no-unused-styles */
import React from 'react'
import { StyleSheet, Text, type TextProps } from 'react-native'

import { colors, typography } from '../../constants/theme'

interface TypographyProps extends TextProps {
  variant?: 'display' | 'h1' | 'h2' | 'body' | 'bodyMedium' | 'caption' | 'button'
  color?: string
  align?: 'auto' | 'left' | 'right' | 'center' | 'justify'
}

export function Typography({
  variant = 'body',
  color = colors.text.primary,
  align = 'left',
  style,
  ...props
}: TypographyProps) {
  return <Text style={[styles[variant], { color, textAlign: align }, style]} {...props} />
}

const styles = StyleSheet.create({
  body: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.base,
  },
  bodyMedium: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.md,
  },
  button: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.md,
  },
  caption: {
    color: colors.text.secondary,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.sm,
  },
  display: {
    fontFamily: typography.fonts.display,
    fontSize: typography.sizes.display,
  },
  h1: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.xxl,
  },
  h2: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.xl,
  },
})
