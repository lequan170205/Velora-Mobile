import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { Pressable, Text, View } from 'react-native'

import { colors } from '../../constants/theme'
import { AnimatedActionSheet } from '../common/AnimatedActionSheet'

interface ReelActionsMenuProps {
  visible: boolean
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}

export function ReelActionsMenu({ visible, onEdit, onDelete, onClose }: ReelActionsMenuProps) {
  return (
    <AnimatedActionSheet
      visible={visible}
      onClose={onClose}
      backdropAccessibilityLabel="Close reel options"
    >
      {({ close, isClosing }) => (
        <>
          <View className="mt-3 flex-row items-start justify-between">
            <View className="flex-1 pr-4">
              <Text className="font-heading text-xl text-text-primary">Reel options</Text>
              <Text className="mt-1 text-base2 text-text-secondary">
                Focus actions for this reel
              </Text>
            </View>

            <Pressable
              accessibilityLabel="Close reel options"
              accessibilityRole="button"
              className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
              disabled={isClosing}
              onPress={() => close()}
            >
              <MaterialIcons name="close" size={20} color={colors.text.primary} />
            </Pressable>
          </View>

          <View className="mt-5">
            <Text className="mb-3 text-xs2 uppercase tracking-[1.1px] text-text-muted">Manage</Text>
            <View className="gap-3">
              <Pressable
                accessibilityLabel="Edit reel details"
                accessibilityRole="button"
                className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
                disabled={isClosing}
                onPress={() => close(onEdit)}
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-white">
                  <MaterialIcons name="edit" size={20} color={colors.text.primary} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="font-medium text-md text-text-primary">Edit details</Text>
                  <Text className="mt-1 text-sm2 text-text-secondary">
                    Title, caption, hashtags, visibility
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={colors.text.tertiary} />
              </Pressable>

              <Pressable
                accessibilityLabel="Delete reel"
                accessibilityRole="button"
                className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
                disabled={isClosing}
                onPress={() => close(onDelete)}
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-[#FFF1EE]">
                  <MaterialIcons name="delete-outline" size={20} color={colors.status.error} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="font-medium text-md text-status-error">Delete reel</Text>
                  <Text className="mt-1 text-sm2 text-text-secondary">
                    Permanently remove this post
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={colors.text.tertiary} />
              </Pressable>
            </View>
          </View>
        </>
      )}
    </AnimatedActionSheet>
  )
}
