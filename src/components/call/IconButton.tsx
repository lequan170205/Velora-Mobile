import { MaterialIcons } from '@expo/vector-icons'

import { colors } from '../../constants/theme'
import { AppPressable } from '../base/AppPressable'

import type { ComponentProps } from 'react'

type IconName = ComponentProps<typeof MaterialIcons>['name']

export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  selected = false,
  expanded,
  destructive = false,
  size = 48,
}: {
  icon: IconName
  label: string
  onPress: () => void
  disabled?: boolean
  selected?: boolean
  expanded?: boolean
  destructive?: boolean
  size?: number
}) {
  return (
    <AppPressable
      activeOpacity={disabled ? 1 : 0.68}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected, expanded }}
      className="items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        opacity: disabled ? 0.34 : 1,
        backgroundColor: destructive
          ? colors.call.endCall
          : selected
            ? colors.bubble.outgoing
            : colors.call.control,
      }}
    >
      <MaterialIcons
        name={icon}
        size={destructive ? 27 : 25}
        color={selected && !destructive ? colors.bubble.outgoingText : colors.call.textPrimary}
      />
    </AppPressable>
  )
}
