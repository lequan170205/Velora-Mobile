import React from 'react'
import { Text } from 'react-native'

import { cn } from '../../lib/cn'

import { DEFAULT_MAX_FONT_SIZE_MULTIPLIER, resolveTextStyle } from './textRendering'

import type { TextProps } from 'react-native'

interface AppTextProps extends TextProps {
  className?: string
}

type NativeTextRef = React.ElementRef<typeof Text>

export const AppText = React.forwardRef<NativeTextRef, AppTextProps>(
  (
    {
      className,
      style,
      allowFontScaling = true,
      maxFontSizeMultiplier = DEFAULT_MAX_FONT_SIZE_MULTIPLIER,
      ...props
    },
    ref,
  ) => {
    return (
      <Text
        ref={ref}
        className={cn(className)}
        allowFontScaling={allowFontScaling}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={resolveTextStyle({ className, style })}
        {...props}
      />
    )
  },
)

AppText.displayName = 'AppText'
