import React from 'react'
import { Button as PaperButton } from 'react-native-paper'

import { cn } from '../../lib/cn'

import type { ButtonProps as PaperButtonProps } from 'react-native-paper'

interface ButtonProps extends Omit<PaperButtonProps, 'children' | 'mode'> {
  title: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  isLoading?: boolean
  className?: string
}

export function Button({
  title,
  variant = 'primary',
  isLoading = false,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const mode =
    variant === 'primary'
      ? 'contained'
      : variant === 'secondary'
        ? 'contained-tonal'
        : variant === 'outline'
          ? 'outlined'
          : 'text' // ghost

  return (
    <PaperButton
      mode={mode}
      disabled={disabled || isLoading}
      loading={isLoading}
      className={cn(className)}
      {...rest}
    >
      {title}
    </PaperButton>
  )
}
