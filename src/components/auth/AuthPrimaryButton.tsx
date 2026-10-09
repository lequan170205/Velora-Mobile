import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { ActivityIndicator, Text } from 'react-native'

import { colors } from '../../constants/theme'
import { AppPressable } from '../base/AppPressable'

type AuthPrimaryButtonProps = {
  label: string
  onPress: () => void
  disabled?: boolean
  isLoading?: boolean
  trailingIcon?: React.ComponentProps<typeof MaterialIcons>['name']
  accessibilityLabel?: string
}

// Single CTA spec for the auth flow: h-14 pill, brand fill, 18px bold label,
// spinner while loading, quiet 40% opacity when disabled. Deliberately no
// glow shadow — the frost canvas keeps elevation flat.
export function AuthPrimaryButton({
  label,
  onPress,
  disabled = false,
  isLoading = false,
  trailingIcon,
  accessibilityLabel,
}: AuthPrimaryButtonProps) {
  const isDisabled = disabled || isLoading

  return (
    <AppPressable
      className="h-14 flex-row items-center justify-center rounded-full bg-brand"
      style={{ opacity: isDisabled ? 0.4 : 1 }}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: isLoading }}
    >
      {isLoading ? (
        <ActivityIndicator color={colors.text.inverse} size="small" />
      ) : (
        <>
          <Text className="text-lg font-bold text-white">{label}</Text>
          {trailingIcon ? (
            <MaterialIcons
              name={trailingIcon}
              size={18}
              color={colors.text.inverse}
              style={{ marginLeft: 8 }}
            />
          ) : null}
        </>
      )}
    </AppPressable>
  )
}
