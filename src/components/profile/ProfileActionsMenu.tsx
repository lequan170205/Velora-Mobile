import { MaterialIcons } from '@expo/vector-icons'
import React, { useCallback, useEffect, useRef } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
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

import { colors } from '../../constants/theme'

interface ProfileActionsMenuProps {
  visible: boolean
  username: string
  onBlock: () => void
  onClose: () => void
}

export function ProfileActionsMenu({
  visible,
  username,
  onBlock,
  onClose,
}: ProfileActionsMenuProps) {
  const insets = useSafeAreaInsets()
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isClosingRef = useRef(false)
  const progress = useSharedValue(0)
  const [isClosing, setIsClosing] = React.useState(false)

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

  const closeWithAnimation = useCallback(
    (afterClose?: () => void) => {
      if (isClosingRef.current) {
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
    [onClose, progress],
  )

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }))

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      {
        translateY: interpolate(progress.value, [0, 1], [52, 0]),
      },
      {
        scale: interpolate(progress.value, [0, 1], [0.985, 1]),
      },
    ],
  }))

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => {
        closeWithAnimation()
      }}
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
            accessibilityLabel="Close profile options"
            accessibilityRole="button"
            disabled={isClosing}
            onPress={() => {
              closeWithAnimation()
            }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>

        <Animated.View
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
          className="rounded-t-[32px] bg-surface-modal px-5 pb-8 pt-3"
        >
          <View className="items-center pb-2">
            <View className="h-1.5 w-14 rounded-full bg-[#D9D9D9]" />
          </View>

          <Animated.View
            entering={FadeInDown.springify().damping(18).stiffness(220)}
            layout={LinearTransition.springify().damping(18).stiffness(220)}
          >
            <View className="mt-3 flex-row items-start justify-between">
              <View className="flex-1 pr-4">
                <Text className="font-heading text-xl text-text-primary">Profile options</Text>
                <Text className="mt-1 text-base2 text-text-secondary">{username}</Text>
              </View>

              <Pressable
                accessibilityLabel="Close profile options"
                accessibilityRole="button"
                className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
                disabled={isClosing}
                onPress={() => {
                  closeWithAnimation()
                }}
              >
                <MaterialIcons name="close" size={20} color={colors.text.primary} />
              </Pressable>
            </View>

            <View className="mt-5">
              <Text className="mb-3 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                Account
              </Text>
              <Pressable
                accessibilityHint="Opens a confirmation before blocking this account"
                accessibilityLabel={`Block ${username}`}
                accessibilityRole="button"
                className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
                disabled={isClosing}
                onPress={() => {
                  closeWithAnimation(onBlock)
                }}
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-error">
                  <MaterialIcons name="block" size={20} color={colors.status.error} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="font-medium text-md text-status-error">Block {username}</Text>
                  <Text className="mt-1 text-sm2 text-text-secondary">
                    Stop this account from interacting with you
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={colors.text.tertiary} />
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  )
}
