import { MaterialIcons } from '@expo/vector-icons'
import React, { memo } from 'react'
import { Pressable } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { colors, radius } from '../../constants/theme'

interface ComposerSendButtonProps {
  accessibilityLabel: string
  onPress: () => void
  disabled?: boolean
  icon?: React.ComponentProps<typeof MaterialIcons>['name']
}

// The round brand "send" button shared by the chat and reel-comment composers.
export const ComposerSendButton = memo(function ComposerSendButton({
  accessibilityLabel,
  onPress,
  disabled = false,
  icon = 'send',
}: ComposerSendButtonProps) {
  const pressScale = useSharedValue(1)
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.value }] }))

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      onPressIn={() => {
        pressScale.value = withTiming(0.88, { duration: 70 })
      }}
      onPressOut={() => {
        pressScale.value = withSpring(1, { damping: 15, stiffness: 380 })
      }}
    >
      <Animated.View
        style={[
          {
            width: 40,
            height: 40,
            borderRadius: radius.xl,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.brand.primary,
          },
          pressStyle,
        ]}
      >
        <MaterialIcons
          name={icon}
          size={18}
          color={colors.text.inverse}
          style={icon === 'send' ? { marginLeft: 2 } : undefined}
        />
      </Animated.View>
    </Pressable>
  )
})
