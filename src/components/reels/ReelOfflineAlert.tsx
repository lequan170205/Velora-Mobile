import { MaterialIcons } from '@expo/vector-icons'
import React, { useEffect } from 'react'
import { Text, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { colors, shadows } from '../../constants/theme'

interface ReelOfflineAlertProps {
  topOffset: number
  visible: boolean
}

export function ReelOfflineAlert({ topOffset, visible }: ReelOfflineAlertProps) {
  const visibilityProgress = useSharedValue(visible ? 1 : 0)

  useEffect(() => {
    visibilityProgress.value = withTiming(visible ? 1 : 0, {
      duration: visible ? 180 : 140,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    })
  }, [visibilityProgress, visible])

  const alertStyle = useAnimatedStyle(() => ({
    opacity: visibilityProgress.value,
    transform: [
      {
        translateY: (1 - visibilityProgress.value) * -10,
      },
      {
        scale: 0.98 + visibilityProgress.value * 0.02,
      },
    ],
  }))

  return (
    <View
      pointerEvents="none"
      className="absolute inset-x-0 z-30 items-center px-5"
      style={{ top: topOffset, elevation: 30 }}
    >
      <Animated.View
        style={[
          alertStyle,
          {
            ...shadows.md,
            shadowColor: '#000000',
            shadowOpacity: 0.18,
            shadowRadius: 16,
            maxWidth: 360,
            width: '100%',
          },
        ]}
      >
        <View className="flex-row overflow-hidden rounded-full border border-white/15 bg-black/40">
          <View className="items-center justify-center border-r border-white/10 px-3.5">
            <MaterialIcons name="wifi-off" size={18} color={colors.brand.primary} />
          </View>

          <View className="flex-1 px-4 py-3">
            <Text className="text-sm2 font-medium leading-5 text-white">
              No internet connection. Connect to the internet and try again
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  )
}
