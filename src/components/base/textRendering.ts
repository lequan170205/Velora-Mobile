import { Platform, StyleSheet } from 'react-native'

import type { StyleProp, TextStyle } from 'react-native'

const TRACKING_PATTERN = /(?:^|\s)tracking-\[(-?\d*\.?\d+)px\](?=\s|$)/

export const DEFAULT_MAX_FONT_SIZE_MULTIPLIER = 1.15

function extractTrackingFromClassName(className?: string): number | undefined {
  if (!className) {
    return undefined
  }

  const match = className.match(TRACKING_PATTERN)
  if (!match) {
    return undefined
  }

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeAndroidLetterSpacing(letterSpacing: number): number {
  if (letterSpacing >= 0) {
    return letterSpacing
  }

  return Math.max(letterSpacing * 0.55, -0.3)
}

export function resolveTextStyle({
  className,
  style,
  trimAndroidFontPadding = true,
}: {
  className?: string | undefined
  style?: StyleProp<TextStyle> | undefined
  trimAndroidFontPadding?: boolean
}): StyleProp<TextStyle> {
  const flattenedStyle = StyleSheet.flatten(style)
  const inlineLetterSpacing =
    typeof flattenedStyle?.letterSpacing === 'number' ? flattenedStyle.letterSpacing : undefined
  const requestedLetterSpacing = inlineLetterSpacing ?? extractTrackingFromClassName(className)
  const normalizedLetterSpacing =
    Platform.OS === 'android' && requestedLetterSpacing !== undefined
      ? normalizeAndroidLetterSpacing(requestedLetterSpacing)
      : requestedLetterSpacing

  return [
    Platform.OS === 'android' && trimAndroidFontPadding ? { includeFontPadding: false } : undefined,
    style,
    normalizedLetterSpacing !== undefined ? { letterSpacing: normalizedLetterSpacing } : undefined,
  ]
}
