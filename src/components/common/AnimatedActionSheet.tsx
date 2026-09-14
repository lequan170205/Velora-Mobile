import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export interface AnimatedActionSheetControls {
  close: (afterClose?: () => void, options?: { force?: boolean }) => void
  isClosing: boolean
}

interface AnimatedActionSheetProps {
  visible: boolean
  onClose: () => void
  children: (controls: AnimatedActionSheetControls) => React.ReactNode
  disabled?: boolean
  backdropAccessibilityLabel?: string
}

export function AnimatedActionSheet({
  visible,
  onClose,
  children,
  disabled = false,
  backdropAccessibilityLabel = 'Close options',
}: AnimatedActionSheetProps) {
  const insets = useSafeAreaInsets()
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isClosingRef = useRef(false)
  const progress = useSharedValue(0)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (!visible) {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
        closeTimeoutRef.current = null
      }
      isClosingRef.current = false
      setIsClosing(false)
      return
    }

    isClosingRef.current = false
    setIsClosing(false)
    progress.value = 0
    progress.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    })
  }, [progress, visible])

  useEffect(
    () => () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
    },
    [],
  )

  const close = useCallback(
    (afterClose?: () => void, options: { force?: boolean } = {}) => {
      if ((disabled && !options.force) || isClosingRef.current) {
        return
      }

      isClosingRef.current = true
      setIsClosing(true)
      progress.value = withTiming(0, {
        duration: 150,
        easing: Easing.in(Easing.cubic),
      })

      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }

      closeTimeoutRef.current = setTimeout(() => {
        closeTimeoutRef.current = null
        onClose()
        afterClose?.()
        isClosingRef.current = false
        setIsClosing(false)
      }, 150)
    },
    [disabled, onClose, progress],
  )

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }))

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [52, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.985, 1]) },
    ],
  }))

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => close()}
    >
      <View style={StyleSheet.absoluteFillObject} className="justify-end">
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: 'rgba(8, 8, 10, 0.44)' },
            backdropAnimatedStyle,
          ]}
        >
          <Pressable
            accessibilityLabel={backdropAccessibilityLabel}
            accessibilityRole="button"
            disabled={disabled || isClosing}
            onPress={() => close()}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>

        <Animated.View
          className="rounded-t-[32px] bg-surface-modal px-5 pt-3"
          style={[
            sheetAnimatedStyle,
            {
              paddingBottom: Math.max(insets.bottom, 18),
              shadowColor: 'rgba(22, 22, 22, 0.18)',
              shadowOffset: { width: 0, height: -8 },
              shadowOpacity: 1,
              shadowRadius: 24,
              elevation: 18,
            },
          ]}
        >
          <View className="items-center pb-2">
            <View className="h-1.5 w-14 rounded-full bg-[#D9D9D9]" />
          </View>

          <Animated.View
            entering={FadeInDown.springify().damping(18).stiffness(220)}
            layout={LinearTransition.springify().damping(18).stiffness(220)}
          >
            {children({ close, isClosing })}
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  )
}
