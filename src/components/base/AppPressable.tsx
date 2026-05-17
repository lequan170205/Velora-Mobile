import React from 'react'
import { Platform, Pressable } from 'react-native'

import { cn } from '../../lib/cn'

import type {
  Insets,
  PressableProps,
  PressableStateCallbackType,
  StyleProp,
  ViewStyle,
} from 'react-native'

const DEFAULT_HIT_SLOP: Insets = {
  top: 8,
  right: 8,
  bottom: 8,
  left: 8,
}

const DEFAULT_PRESS_RETENTION_OFFSET: Insets = {
  top: 8,
  right: 8,
  bottom: 8,
  left: 8,
}

type AppRippleConfig = Exclude<PressableProps['android_ripple'], null | undefined>

const DEFAULT_ANDROID_RIPPLE: AppRippleConfig = {
  color: 'rgba(22,22,22,0.08)',
  borderless: false,
}

interface AppPressableProps extends PressableProps {
  className?: string
  activeOpacity?: number
}

type NativePressableRef = React.ElementRef<typeof Pressable>

function resolvePressableStyle(
  style: PressableProps['style'],
  state: PressableStateCallbackType,
  activeOpacity: number,
  shouldUseOpacityFeedback: boolean,
  disabled?: PressableProps['disabled'],
): StyleProp<ViewStyle> {
  const resolvedStyle = typeof style === 'function' ? style(state) : style

  return [
    shouldUseOpacityFeedback && state.pressed && !disabled ? { opacity: activeOpacity } : undefined,
    resolvedStyle,
  ]
}

export const AppPressable = React.forwardRef<NativePressableRef, AppPressableProps>(
  (
    {
      className,
      style,
      activeOpacity = 0.82,
      hitSlop = DEFAULT_HIT_SLOP,
      pressRetentionOffset = DEFAULT_PRESS_RETENTION_OFFSET,
      android_ripple,
      disabled,
      ...props
    },
    ref,
  ) => {
    const resolvedRipple =
      Platform.OS === 'android' && !disabled
        ? android_ripple === undefined
          ? DEFAULT_ANDROID_RIPPLE
          : android_ripple
        : undefined

    const shouldUseOpacityFeedback = Platform.OS === 'ios' || resolvedRipple === null

    return (
      <Pressable
        ref={ref}
        className={cn(className)}
        disabled={disabled}
        hitSlop={hitSlop}
        pressRetentionOffset={pressRetentionOffset}
        android_ripple={resolvedRipple}
        style={(state) =>
          resolvePressableStyle(style, state, activeOpacity, shouldUseOpacityFeedback, disabled)
        }
        {...props}
      />
    )
  },
)

AppPressable.displayName = 'AppPressable'
