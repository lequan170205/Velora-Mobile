import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { Pressable, Text, View } from 'react-native'

import { colors } from '../../constants/theme'
import { AnimatedActionSheet } from '../common/AnimatedActionSheet'

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
  return (
    <AnimatedActionSheet
      visible={visible}
      onClose={onClose}
      backdropAccessibilityLabel="Close profile options"
    >
      {({ close, isClosing }) => (
        <>
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
              onPress={() => close()}
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
              onPress={() => close(onBlock)}
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
        </>
      )}
    </AnimatedActionSheet>
  )
}
