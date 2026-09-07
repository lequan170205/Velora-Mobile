import React from 'react'
import { View } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'

import type { SharedValue } from 'react-native-reanimated'

export function CropGridOverlay({ opacity }: { opacity: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }))

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, animatedStyle]}
    >
      <View
        style={{
          backgroundColor: 'rgba(255,255,255,0.58)',
          bottom: 0,
          position: 'absolute',
          top: 0,
          width: 1,
          left: '33.333%',
        }}
      />
      <View
        style={{
          backgroundColor: 'rgba(255,255,255,0.58)',
          bottom: 0,
          position: 'absolute',
          top: 0,
          width: 1,
          left: '66.666%',
        }}
      />
      <View
        style={{
          backgroundColor: 'rgba(255,255,255,0.58)',
          height: 1,
          left: 0,
          position: 'absolute',
          right: 0,
          top: '33.333%',
        }}
      />
      <View
        style={{
          backgroundColor: 'rgba(255,255,255,0.58)',
          height: 1,
          left: 0,
          position: 'absolute',
          right: 0,
          top: '66.666%',
        }}
      />
    </Animated.View>
  )
}
