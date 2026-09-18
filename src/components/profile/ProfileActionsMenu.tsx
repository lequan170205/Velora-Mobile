import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '../../constants/theme'

export interface ProfileActionsMenuProps {
  sheetRef?: React.RefObject<BottomSheetModal | null>
  visible?: boolean
  username: string
  onBlock: () => void
  onClose: () => void
}

export function ProfileActionsMenu({
  sheetRef: externalSheetRef,
  visible,
  username,
  onBlock,
  onClose,
}: ProfileActionsMenuProps) {
  const insets = useSafeAreaInsets()
  const internalRef = useRef<BottomSheetModal | null>(null)
  const resolvedRef = externalSheetRef ?? internalRef
  const [isClosing, setIsClosing] = useState(false)
  const pendingActionRef = useRef<(() => void) | null>(null)

  const wasPresentedRef = useRef(false)

  useEffect(() => {
    if (visible === undefined) return
    if (visible) {
      wasPresentedRef.current = true
      setIsClosing(false)
      resolvedRef.current?.present()
    } else if (wasPresentedRef.current) {
      wasPresentedRef.current = false
      resolvedRef.current?.dismiss()
    }
  }, [visible, resolvedRef])

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        accessibilityLabel="Close profile options"
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.44}
        pressBehavior={isClosing ? 'none' : 'close'}
      />
    ),
    [isClosing],
  )

  const handleDismiss = useCallback(() => {
    setIsClosing(false)
    const nextAction = pendingActionRef.current
    pendingActionRef.current = null
    onClose()
    nextAction?.()
  }, [onClose])

  const close = useCallback(
    (afterClose?: () => void) => {
      if (isClosing) return
      setIsClosing(true)
      pendingActionRef.current = afterClose ?? null
      resolvedRef.current?.dismiss()
    },
    [isClosing, resolvedRef],
  )

  return (
    <BottomSheetModal
      ref={resolvedRef}
      enableDynamicSizing
      enablePanDownToClose={!isClosing}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      onDismiss={handleDismiss}
    >
      <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 18) }}>
        <View className="px-5 pb-1">
          <View className="mt-1 flex-row items-start justify-between">
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
              ACCOUNT
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
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  handleIndicator: {
    backgroundColor: '#D9D9D9',
    borderRadius: 9999,
    height: 6,
    width: 56,
  },
  sheetBackground: {
    backgroundColor: colors.surface.modal,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    elevation: 18,
    shadowColor: 'rgba(22, 22, 22, 0.18)',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 1,
    shadowRadius: 24,
  },
})
