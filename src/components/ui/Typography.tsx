import React from 'react'
import { Text } from 'react-native'

import { cn } from '../../lib/cn'

import type { TextProps } from 'react-native'

type TypographyVariant = 'display' | 'h1' | 'h2' | 'body' | 'bodyMedium' | 'caption' | 'button'

const variantClasses: Record<TypographyVariant, string> = {
  display: 'font-bold text-hero text-text-primary',
  h1: 'font-bold text-xxl text-text-primary',
  h2: 'font-heading text-xl text-text-primary',
  body: 'font-sans text-base text-text-primary',
  bodyMedium: 'font-medium text-md text-text-primary',
  button: 'font-heading text-md text-text-primary',
  caption: 'font-sans text-xs2 text-text-secondary',
}

interface TypographyProps extends TextProps {
  variant?: TypographyVariant
  color?: string
  align?: 'auto' | 'left' | 'right' | 'center' | 'justify'
  className?: string
}

export function Typography({
  variant = 'body',
  color,
  align = 'left',
  className,
  style,
  ...props
}: TypographyProps) {
  return (
    <Text
      className={cn(variantClasses[variant], className)}
      style={[
        // NativeWind limitation: kept as inline — dynamic color/align props cannot map to className at runtime
        color ? { color } : undefined,
        align !== 'left' ? { textAlign: align } : undefined,
        style,
      ]}
      {...props}
    />
  )
}
