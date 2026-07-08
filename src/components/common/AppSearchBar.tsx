import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'

import { cn } from '../../lib/cn'
import { AppTextInput } from '../base'

import type { TextInputProps } from 'react-native'

interface AppSearchBarProps extends Omit<TextInputProps, 'onChangeText' | 'value'> {
  value: string
  onChangeText: (value: string) => void
  containerClassName?: string
  inputClassName?: string
  iconColor?: string
  iconPlacement?: 'left' | 'right'
  isLoading?: boolean
  loadingColor?: string
  onClear?: (() => void) | undefined
  size?: 'default' | 'compact'
}

type NativeTextInputRef = React.ElementRef<typeof AppTextInput>

export const AppSearchBar = React.forwardRef<NativeTextInputRef, AppSearchBarProps>(
  (
    {
      autoCapitalize = 'none',
      autoCorrect = false,
      className,
      containerClassName,
      iconColor = '#A6A6A6',
      iconPlacement = 'right',
      inputClassName,
      isLoading = false,
      loadingColor = '#FF6B2C',
      onChangeText,
      onClear,
      placeholder = 'Search',
      placeholderTextColor = '#A6A6A6',
      returnKeyType = 'search',
      size = 'default',
      value,
      ...props
    },
    ref,
  ) => {
    const isCompact = size === 'compact'
    const iconSize = isCompact ? 18 : 20
    const hasValue = value.trim().length > 0

    const icon = <MaterialIcons name="search" size={iconSize} color={iconColor} />

    return (
      <View
        className={cn(
          'flex-row items-center rounded-full bg-surface-input',
          isCompact ? 'h-10 px-3.5' : 'px-4 py-3.5',
          containerClassName,
        )}
      >
        {iconPlacement === 'left' ? icon : null}

        <AppTextInput
          ref={ref}
          className={cn(
            'flex-1 text-base text-text-primary',
            iconPlacement === 'left' ? 'ml-2.5' : '',
            inputClassName,
            className,
          )}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={placeholderTextColor}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          returnKeyType={returnKeyType}
          {...props}
        />

        {isLoading ? (
          <ActivityIndicator color={loadingColor} size="small" />
        ) : hasValue && onClear ? (
          <Pressable className="ml-2" onPress={onClear}>
            <MaterialIcons name="close" size={iconSize} color={iconColor} />
          </Pressable>
        ) : iconPlacement === 'right' ? (
          <View className="ml-3">{icon}</View>
        ) : null}
      </View>
    )
  },
)

AppSearchBar.displayName = 'AppSearchBar'
