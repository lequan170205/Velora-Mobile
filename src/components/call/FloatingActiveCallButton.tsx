import { MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { usePathname, useRouter } from 'expo-router'
import { useEffect, useMemo } from 'react'
import { Platform, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '../../constants/theme'
import { useCallStore } from '../../stores/callStore'
import { AppPressable } from '../base/AppPressable'
import { getDockedTabBarHeight } from '../navigation/CustomTabBar'

const BUTTON_SIZE = 48
const EDGE_INSET = 16
const TOP_CLEARANCE = 76
const BOTTOM_CLEARANCE = 16
const CONVERSATION_COMPOSER_CLEARANCE = 88
const TOP_LEVEL_PATHS = new Set(['/', '/search', '/reels', '/friends', '/profile'])

const POSITION_SPRING = {
  damping: 20,
  stiffness: 260,
  mass: 0.8,
  reduceMotion: ReduceMotion.System,
} as const

export function FloatingActiveCallButton() {
  const router = useRouter()
  const pathname = usePathname()
  const { height, width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation()
  const callId = useCallStore((state) => state.callId)
  const callType = useCallStore((state) => state.callType)
  const peerName = useCallStore((state) => state.peerName)
  const phase = useCallStore((state) => state.phase)

  const minimumX = insets.left + EDGE_INSET
  const maximumX = Math.max(minimumX, width - insets.right - EDGE_INSET - BUTTON_SIZE)
  const minimumY = insets.top + TOP_CLEARANCE
  const isConversationRoute = pathname.startsWith('/conversation/')
  const tabBarClearance = TOP_LEVEL_PATHS.has(pathname)
    ? getDockedTabBarHeight(insets.bottom) + BOTTOM_CLEARANCE
    : insets.bottom + BOTTOM_CLEARANCE + (isConversationRoute ? CONVERSATION_COMPOSER_CLEARANCE : 0)
  const maximumY = Math.max(minimumY, height - tabBarClearance - BUTTON_SIZE)
  const translateX = useSharedValue(maximumX)
  const translateY = useSharedValue(maximumY)
  const dragStartX = useSharedValue(maximumX)
  const dragStartY = useSharedValue(maximumY)

  useEffect(() => {
    const clampedX = Math.min(maximumX, Math.max(minimumX, translateX.value))
    const nearestEdgeX = clampedX < (minimumX + maximumX) / 2 ? minimumX : maximumX

    translateX.value = withSpring(nearestEdgeX, POSITION_SPRING)
    translateY.value = withSpring(
      Math.min(maximumY, Math.max(minimumY, translateY.value)),
      POSITION_SPRING,
    )
  }, [maximumX, maximumY, minimumX, minimumY, translateX, translateY])

  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(8)
        .onBegin(() => {
          dragStartX.value = translateX.value
          dragStartY.value = translateY.value
        })
        .onUpdate((event) => {
          translateX.value = Math.min(
            maximumX,
            Math.max(minimumX, dragStartX.value + event.translationX),
          )
          translateY.value = Math.min(
            maximumY,
            Math.max(minimumY, dragStartY.value + event.translationY),
          )
        })
        .onEnd((event) => {
          const projectedX = translateX.value + event.velocityX * 0.12
          const nearestEdgeX = projectedX < (minimumX + maximumX) / 2 ? minimumX : maximumX

          translateX.value = withSpring(nearestEdgeX, POSITION_SPRING)
          translateY.value = withSpring(translateY.value, POSITION_SPRING)
        }),
    [dragStartX, dragStartY, maximumX, maximumY, minimumX, minimumY, translateX, translateY],
  )

  const positionStyle = useAnimatedStyle(() => {
    const liveKeyboardOffset = Math.abs(keyboardHeight.value)
    const keyboardAwareY = Math.max(
      minimumY,
      Math.min(maximumY, translateY.value - liveKeyboardOffset),
    )

    return {
      transform: [{ translateX: translateX.value }, { translateY: keyboardAwareY }],
    }
  }, [keyboardHeight, maximumY, minimumY, translateX, translateY])

  const isReturnable =
    Boolean(callId && callType) &&
    (phase === 'outgoing_ringing' ||
      phase === 'connecting' ||
      phase === 'reconnecting' ||
      phase === 'active')

  if (!isReturnable || !callId || !callType || pathname.startsWith('/call/')) return null

  const callKind = callType === 'VIDEO' ? 'video' : 'voice'

  return (
    <GestureDetector gesture={dragGesture}>
      <Animated.View
        entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
        exiting={FadeOut.duration(100).reduceMotion(ReduceMotion.System)}
        style={[
          {
            position: 'absolute',
            left: 0,
            top: 0,
            zIndex: 80,
            elevation: 12,
          },
          positionStyle,
        ]}
      >
        <AppPressable
          className="h-12 w-12 items-center justify-center overflow-hidden rounded-full border"
          style={{
            backgroundColor: colors.bubble.outgoing,
            borderColor: 'rgba(255,255,255,0.28)',
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 5 },
            shadowOpacity: Platform.OS === 'ios' ? 0.18 : 0,
            shadowRadius: 10,
          }}
          activeOpacity={0.68}
          hitSlop={0}
          onPress={() => {
            void Haptics.selectionAsync()
            router.push(`/call/${callId}` as never)
          }}
          accessibilityRole="button"
          accessibilityLabel={`Return to ${callKind} call${peerName ? ` with ${peerName}` : ''}`}
          accessibilityHint="Opens the call already in progress. Drag to move this button."
        >
          <MaterialIcons
            name={callType === 'VIDEO' ? 'videocam' : 'call'}
            size={22}
            color={colors.text.inverse}
          />
        </AppPressable>
      </Animated.View>
    </GestureDetector>
  )
}
