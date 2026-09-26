import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from '@gorhom/bottom-sheet'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { conversationApi } from '../../../api/conversation.api'
import { queryKeys } from '../../../constants/queryKeys'
import { colors } from '../../../constants/theme'
import { AppPressable, AppText } from '../../base'
import { ChatAvatar } from '../ChatAvatar'

type GroupCallInviteSheetProps = {
  conversationId: string
  currentUserId: string | null
  visible: boolean
  onClose: () => void
  onStart: (userIds: string[]) => void
}

export function GroupCallInviteSheet({
  conversationId,
  currentUserId,
  visible,
  onClose,
  onStart,
}: GroupCallInviteSheetProps) {
  const sheetRef = useRef<BottomSheetModal>(null)
  const insets = useSafeAreaInsets()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const {
    data: members = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.conversations.members(conversationId),
    queryFn: () => conversationApi.getMembers(conversationId),
    enabled: visible,
  })
  const eligibleMembers = members.filter(
    (member) => member.status === 'ACTIVE' && member.userId !== currentUserId,
  )

  useEffect(() => {
    if (visible) {
      setSelectedIds(new Set())
      sheetRef.current?.present()
    } else {
      sheetRef.current?.dismiss()
    }
  }, [visible])

  const toggle = (userId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose
      onDismiss={onClose}
      backdropComponent={(props) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.32}
          pressBehavior="close"
        />
      )}
    >
      <BottomSheetView className="px-5 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <AppText className="text-base2 font-semibold text-text-primary">
          Call selected members
        </AppText>
        <AppText className="mt-1 text-xs2 text-text-muted">
          Only selected members will receive an invitation.
        </AppText>
        {isPending ? (
          <ActivityIndicator className="my-8" color={colors.brand.primary} />
        ) : isError ? (
          <AppPressable className="min-h-12 justify-center" onPress={() => void refetch()}>
            <AppText className="text-brand">Could not load members. Tap to retry.</AppText>
          </AppPressable>
        ) : (
          <BottomSheetScrollView style={{ maxHeight: 380 }} className="mt-3">
            {eligibleMembers.map((member) => {
              const selected = selectedIds.has(member.userId)
              const name =
                member.user.fullName ||
                member.user.name ||
                member.user.username ||
                member.user.email ||
                'Velora user'
              return (
                <AppPressable
                  key={member.userId}
                  className="min-h-14 flex-row items-center border-b border-border-light"
                  onPress={() => toggle(member.userId)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Invite ${name}`}
                  accessibilityState={{ checked: selected }}
                >
                  <ChatAvatar name={name} picture={member.user.picture} size={40} />
                  <AppText className="ml-3 flex-1 text-sm2 text-text-primary" numberOfLines={1}>
                    {name}
                  </AppText>
                  <MaterialIcons
                    name={selected ? 'check-circle' : 'radio-button-unchecked'}
                    size={24}
                    color={selected ? colors.brand.primary : colors.text.tertiary}
                    accessible={false}
                  />
                </AppPressable>
              )
            })}
            {eligibleMembers.length === 0 ? (
              <View className="py-6">
                <AppText className="text-center text-sm2 text-text-muted">
                  No other active members to call.
                </AppText>
              </View>
            ) : null}
          </BottomSheetScrollView>
        )}
        <AppPressable
          className="mt-4 min-h-12 items-center justify-center rounded-full bg-brand"
          disabled={selectedIds.size === 0 || isPending || isError}
          onPress={() => onStart([...selectedIds])}
          accessibilityRole="button"
          accessibilityLabel={`Call ${selectedIds.size} selected members`}
          accessibilityState={{ disabled: selectedIds.size === 0 || isPending || isError }}
        >
          <AppText className="font-semibold text-white">Call {selectedIds.size} selected</AppText>
        </AppPressable>
      </BottomSheetView>
    </BottomSheetModal>
  )
}
