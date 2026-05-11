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
        {/* Content card — white frosted glass */}
        <View
          className="items-center w-[85%] bg-bg-primary rounded-3xl py-10 px-6"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.15,
            shadowRadius: 24,
            elevation: 12,
          }}
        >
          <Typography variant="caption" color="#8E8E93">
            Incoming {type === 'VIDEO' ? 'Video' : 'Voice'} Call
          </Typography>

          {/* Animated avatar ring */}
          <Animated.View
            // NativeWind limitation: reanimated animated value — must stay as inline style
            style={[{ marginVertical: 32 }, animatedStyle]}
            className="w-[140px] h-[140px] rounded-full bg-[rgba(255,107,44,0.12)] items-center justify-center"
          >
            <View className="w-[100px] h-[100px] rounded-full bg-brand items-center justify-center">
              <Typography variant="h1" color="#ffffff">
                {callerName.charAt(0)}
              </Typography>
            </View>
          </Animated.View>

          <Typography variant="h2" className="mb-8">
            {callerName}
          </Typography>

          {/* Action buttons */}
          <View className="flex-row justify-around w-full mt-4">
            <TouchableOpacity
              className="w-[72px] h-[72px] rounded-full bg-status-error items-center justify-center"
              onPress={onReject}
              activeOpacity={0.8}
              style={{
                shadowColor: '#FF3B30',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 6,
              }}
            >
              <Typography variant="button" color="#FFFFFF">
                Decline
              </Typography>
            </TouchableOpacity>

            <TouchableOpacity
              className="w-[72px] h-[72px] rounded-full bg-status-success items-center justify-center"
              onPress={onAccept}
              activeOpacity={0.8}
              style={{
                shadowColor: '#34C759',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 6,
              }}
            >
              <Typography variant="button" color="#FFFFFF">
                Accept
              </Typography>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
