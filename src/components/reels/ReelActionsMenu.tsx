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

interface ReelActionsMenuProps {
  visible: boolean
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}

export function ReelActionsMenu({ visible, onEdit, onDelete, onClose }: ReelActionsMenuProps) {
  const insets = useSafeAreaInsets()
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progress = useSharedValue(0)

  useEffect(() => {
    if (!visible) {
      return
    }

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
      progress.value = withTiming(0, {
        duration: 150,
        easing: Easing.in(Easing.cubic),
      })

      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }

      closeTimeoutRef.current = setTimeout(() => {
        onClose()
        afterClose?.()
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
          className="rounded-t-[32px] bg-white px-5 pb-8 pt-3"
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
                <Text className="font-heading text-xl text-text-primary">Reel options</Text>
                <Text className="mt-1 text-base2 text-text-secondary">
                  Focus actions for this reel
                </Text>
              </View>

              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
                onPress={() => {
                  closeWithAnimation()
                }}
              >
                <MaterialIcons name="close" size={20} color="#161616" />
              </Pressable>
            </View>

            <View className="mt-5">
              <Text className="mb-3 text-xs2 uppercase tracking-[1.1px] text-text-muted">
                Manage
              </Text>
              <View className="gap-3">
                <Pressable
                  className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
                  onPress={() => {
                    closeWithAnimation(onEdit)
                  }}
                >
                  <View className="h-12 w-12 items-center justify-center rounded-full bg-white">
                    <MaterialIcons name="edit" size={20} color="#161616" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="font-medium text-md text-text-primary">Edit details</Text>
                    <Text className="mt-1 text-sm2 text-text-secondary">
                      Title, caption, hashtags, visibility
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#BEBEBE" />
                </Pressable>

                <Pressable
                  className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
                  onPress={() => {
                    closeWithAnimation(onDelete)
                  }}
                >
                  <View className="h-12 w-12 items-center justify-center rounded-full bg-[#FFF1EE]">
                    <MaterialIcons name="delete-outline" size={20} color="#FF3B30" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="font-medium text-md text-status-error">Delete reel</Text>
                    <Text className="mt-1 text-sm2 text-text-secondary">
                      Permanently remove this post
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#BEBEBE" />
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  )
}
