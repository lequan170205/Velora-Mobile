import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

interface ReelLoadingRailProps {
  bottomOffset?: number
  opacity?: number
  railHeight?: number
}

const HIGHLIGHT_WIDTH_RATIO = 0.28

export function ReelLoadingRail({
  bottomOffset = 0,
  opacity = 1,
  railHeight = 2,
}: ReelLoadingRailProps) {
  const shimmerProgress = useSharedValue(0)
  const [railWidth, setRailWidth] = useState(0)

  useEffect(() => {
    shimmerProgress.value = 0
    shimmerProgress.value = withRepeat(
      withTiming(1, {
        duration: 1150,
        easing: Easing.linear,
      }),
      -1,
      false,
    )

    return () => {
      cancelAnimation(shimmerProgress)
    }
  }, [shimmerProgress])

  const highlightStyle = useAnimatedStyle(() => {
    const highlightWidth = railWidth > 0 ? Math.max(52, railWidth * HIGHLIGHT_WIDTH_RATIO) : 52
    const travelDistance = railWidth + highlightWidth

    return {
      width: highlightWidth,
      opacity:
        railWidth > 0
          ? interpolate(shimmerProgress.value, [0, 0.08, 0.5, 0.92, 1], [0, 0.72, 0.9, 0.72, 0])
          : 0,
      transform: [
        {
          translateX: -highlightWidth + shimmerProgress.value * travelDistance,
        },
      ],
    }
  })

  return (
    <View
      pointerEvents="none"
      className="absolute inset-x-0 z-20"
      style={{ bottom: bottomOffset, opacity }}
    >
      <View
        className="overflow-hidden bg-white/14"
        style={{ height: railHeight }}
        onLayout={(event) => {
          const nextWidth = event.nativeEvent.layout.width

          setRailWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth))
        }}
      >
        <Animated.View
          className="absolute inset-y-0 left-0 rounded-full bg-white/80"
          style={highlightStyle}
        />
      </View>
    </View>
  )
}
