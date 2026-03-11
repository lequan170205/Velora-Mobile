import React, { useEffect } from 'react'
import { Modal, TouchableOpacity, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { Typography } from '../ui/Typography'

interface IncomingCallModalProps {
  visible: boolean
  callerName: string
  type: 'VOICE' | 'VIDEO'
  onAccept: () => void
  onReject: () => void
}

export function IncomingCallModal({
  visible,
  callerName,
  type,
  onAccept,
  onReject,
}: IncomingCallModalProps) {
  const scale = useSharedValue(1)

  useEffect(() => {
    if (visible) {
      scale.value = withRepeat(
        withTiming(1.2, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      )
    } else {
      scale.value = 1
    }
  }, [visible, scale])

  // NativeWind limitation: reanimated animated value — must stay as inline style
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* Overlay */}
      <View className="flex-1 items-center justify-center bg-overlay">
        {/* Content */}
        <View className="items-center w-full">
          <Typography variant="caption" color="#8E8EA0">
            Incoming {type === 'VIDEO' ? 'Video' : 'Voice'} Call
          </Typography>

          {/* Animated avatar ring */}
          <Animated.View
            // NativeWind limitation: reanimated animated value — must stay as inline style
            style={[{ marginVertical: 32 }, animatedStyle]}
            className="w-[140px] h-[140px] rounded-full bg-[rgba(108,99,255,0.2)] items-center justify-center"
          >
            <View className="w-[100px] h-[100px] rounded-full bg-brand-violet items-center justify-center">
              <Typography variant="h1" color="#ffffff">
                {callerName.charAt(0)}
              </Typography>
            </View>
          </Animated.View>

          <Typography variant="h2" className="mb-8">
            {callerName}
          </Typography>

          {/* Action buttons */}
          <View className="flex-row justify-around w-4/5 mt-8">
            <TouchableOpacity
              className="w-[100px] h-[100px] rounded-full bg-status-error items-center justify-center"
              onPress={onReject}
              activeOpacity={0.8}
            >
              <Typography variant="button" color="#f8fafc">
                Decline
              </Typography>
            </TouchableOpacity>

            <TouchableOpacity
              className="w-[100px] h-[100px] rounded-full bg-status-success items-center justify-center"
              onPress={onAccept}
              activeOpacity={0.8}
            >
              <Typography variant="button" color="#f8fafc">
                Accept
              </Typography>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
