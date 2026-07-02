import { LinearGradient } from 'expo-linear-gradient'
import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { ReelLoadingRail } from './ReelLoadingRail'

interface ReelOfflineSkeletonProps {
  bottomContentInset?: number
  height: number
}

const SCRUBBER_TOUCH_ZONE_HEIGHT = 40

export function ReelOfflineSkeleton({ bottomContentInset = 0, height }: ReelOfflineSkeletonProps) {
  const pulseProgress = useSharedValue(0)
  const safeBottomContentInset = Math.max(0, bottomContentInset)
  const metadataBottom = safeBottomContentInset + SCRUBBER_TOUCH_ZONE_HEIGHT + 14

  useEffect(() => {
    pulseProgress.value = withRepeat(
      withTiming(1, {
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    )

    return () => {
      cancelAnimation(pulseProgress)
    }
  }, [pulseProgress])

  const placeholderStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulseProgress.value, [0, 1], [0.28, 0.72]),
  }))

  return (
    <View className="flex-1 bg-[#050505]" style={{ height }}>
      <View className="flex-1 bg-[#050505]">
        <Animated.View className="absolute inset-0 bg-white/[0.03]" style={placeholderStyle} />

        <LinearGradient
          colors={['rgba(0,0,0,0.12)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']}
          locations={[0, 0.38, 1]}
          pointerEvents="none"
          style={StyleSheet.absoluteFillObject}
        />

        <View
          pointerEvents="none"
          className="absolute inset-x-0"
          style={{ bottom: metadataBottom }}
        >
          <View className="px-4">
            <View className="flex-row items-end">
              <View className="max-w-[78%] flex-1 flex-row items-start">
                <Animated.View
                  className="h-[42px] w-[42px] rounded-full bg-white/12"
                  style={placeholderStyle}
                />

                <View className="ml-3 flex-1">
                  <Animated.View
                    className="h-4 w-32 rounded-full bg-white/14"
                    style={placeholderStyle}
                  />
                  <Animated.View
                    className="mt-2 h-3 w-20 rounded-full bg-white/10"
                    style={placeholderStyle}
                  />
                  <Animated.View
                    className="mt-4 h-3 w-56 max-w-full rounded-full bg-white/10"
                    style={placeholderStyle}
                  />
                  <Animated.View
                    className="mt-2 h-3 w-40 max-w-[82%] rounded-full bg-white/10"
                    style={placeholderStyle}
                  />
                </View>
              </View>

              <View className="ml-auto items-center gap-3">
                <Animated.View
                  className="h-10 w-10 rounded-full bg-white/14"
                  style={placeholderStyle}
                />
                <Animated.View
                  className="h-10 w-10 rounded-full bg-white/14"
                  style={placeholderStyle}
                />
              </View>
            </View>
          </View>
        </View>

        <ReelLoadingRail bottomOffset={safeBottomContentInset} opacity={0.9} />
      </View>
    </View>
  )
}
