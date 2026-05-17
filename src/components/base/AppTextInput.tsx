import React from 'react'
import { Platform, TextInput } from 'react-native'

import { cn } from '../../lib/cn'

import { DEFAULT_MAX_FONT_SIZE_MULTIPLIER, resolveTextStyle } from './textRendering'

import type { TextInputProps } from 'react-native'

interface AppTextInputProps extends TextInputProps {
  className?: string
}

type NativeTextInputRef = React.ElementRef<typeof TextInput>

export const AppTextInput = React.forwardRef<NativeTextInputRef, AppTextInputProps>(
  (
    {
      className,
      style,
      multiline,
      allowFontScaling = true,
      maxFontSizeMultiplier = DEFAULT_MAX_FONT_SIZE_MULTIPLIER,
      underlineColorAndroid = 'transparent',
      ...props
    },
    ref,
  ) => {
    return (
      <TextInput
        ref={ref}
        className={cn(className)}
        multiline={multiline}
        allowFontScaling={allowFontScaling}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        underlineColorAndroid={underlineColorAndroid}
        style={[
          Platform.OS === 'android'
            ? {
                paddingTop: 0,
                paddingBottom: 0,
                paddingVertical: 0,
                textAlignVertical: multiline ? 'top' : 'center',
              }
            : undefined,
          resolveTextStyle({ className, style }),
        ]}
        {...props}
      />
    )
  },
)

AppTextInput.displayName = 'AppTextInput'
