import { MaterialIcons } from '@expo/vector-icons'
import React, { useState } from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'

import { colors } from '../../constants/theme'
import { cn } from '../../lib/cn'

import type { ComponentPropsWithoutRef } from 'react'
import type { TextInput as NativeTextInput } from 'react-native'

type AuthFieldProps = Omit<ComponentPropsWithoutRef<typeof NativeTextInput>, 'secureTextEntry'> & {
  label: string
  /** Material icon rendered inside the field, before the input. */
  icon?: React.ComponentProps<typeof MaterialIcons>['name']
  /** Custom leading adornment (e.g. the "@" prefix on username). */
  leadingAccessory?: React.ReactNode
  /** Renders the show/hide password toggle when provided. */
  onToggleSecure?: () => void
  secureTextEntry?: boolean
  secureToggleLabels?: { show: string; hide: string }
  /** Quiet guidance under the field; replaced by `error` when set. */
  hint?: string | null
  error?: string | null
}

// Single field anatomy for the auth flow: label above, bordered h-14 input on
// the warm cream family, optional leading icon, optional 44pt show/hide
// password toggle, hint/error line under the field.
export const AuthField = React.forwardRef<NativeTextInput, AuthFieldProps>(function AuthField(
  {
    label,
    icon,
    leadingAccessory,
    onToggleSecure,
    secureTextEntry,
    secureToggleLabels = { show: 'Show password', hide: 'Hide password' },
    hint,
    error,
    onFocus,
    onBlur,
    ...textInputProps
  },
  ref,
) {
  const [isFocused, setIsFocused] = useState(false)

  return (
    <View>
      <Text className="mb-2 text-sm2 font-semibold text-text-primary">{label}</Text>
      <View
        className={cn(
          'h-14 flex-row items-center rounded-[20px] border px-4',
          isFocused
            ? 'border-border-warm bg-surface-cream-focus'
            : 'border-border-warm-soft bg-white',
        )}
      >
        {icon ? (
          <MaterialIcons name={icon} size={20} color={colors.brand.secondary} />
        ) : leadingAccessory ? (
          leadingAccessory
        ) : null}
        <TextInput
          keyboardAppearance="light"
          ref={ref}
          className="ml-3 flex-1 text-md font-sans text-text-primary"
          placeholderTextColor={colors.text.tertiary}
          secureTextEntry={secureTextEntry}
          onFocus={(event) => {
            setIsFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setIsFocused(false)
            onBlur?.(event)
          }}
          {...textInputProps}
        />
        {onToggleSecure ? (
          <TouchableOpacity
            className="h-11 w-11 items-center justify-center"
            onPress={onToggleSecure}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={secureTextEntry ? secureToggleLabels.show : secureToggleLabels.hide}
          >
            <MaterialIcons
              name={secureTextEntry ? 'visibility-off' : 'visibility'}
              size={21}
              color={colors.text.secondary}
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? (
        <Text className="mt-2 text-base2 font-medium leading-5 text-status-error-text">
          {error}
        </Text>
      ) : hint ? (
        <Text className="font-sans mt-2 text-base2 leading-5 text-text-secondary">{hint}</Text>
      ) : null}
    </View>
  )
})
