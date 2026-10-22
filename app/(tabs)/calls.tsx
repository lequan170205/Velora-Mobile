import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppPressable, AppText } from '../../src/components/base'
import { ChatAvatar } from '../../src/components/chat/ChatAvatar'
import { SafeTouchableOpacity } from '../../src/components/common/SafeTouchableOpacity'
import { getDockedTabBarHeight } from '../../src/components/navigation/CustomTabBar'
import { colors } from '../../src/constants/theme'
import {
  useCallHistory,
  useMarkMissedCallsSeen,
  useMissedCallCount,
} from '../../src/hooks/useCallHistory'
import { useConversationNavigation } from '../../src/hooks/useConversationNavigation'
import {
  describeCallForViewer,
  formatCallListTime,
} from '../../src/lib/call/callHistoryPresentation'
import { useCall } from '../../src/providers/CallProvider'

import type { CallHistoryItem } from '../../src/api/call.api'

const EMPTY_ITEMS: CallHistoryItem[] = []

const getCallTitle = (item: CallHistoryItem) => {
  if (item.isGroupCall) return item.groupName || 'Group call'
  const peer = item.peers[0]
  return peer?.fullName || (peer?.username ? `@${peer.username}` : 'Velora user')
}

function CallRow({
  item,
  onOpen,
  onCallBack,
}: {
  item: CallHistoryItem
  onOpen: (item: CallHistoryItem) => void
  onCallBack: (item: CallHistoryItem) => void
}) {
  const title = getCallTitle(item)
  const presentation = describeCallForViewer({
    callType: item.callType,
    isGroupCall: item.isGroupCall,
    outcome: item.outcome,
    ...(item.terminalReason ? { terminalReason: item.terminalReason } : {}),
    ...(item.durationSec !== undefined ? { durationSec: item.durationSec } : {}),
    role: item.role,
    result: item.result,
  })
  const picture = item.isGroupCall ? item.groupAvatarUrl : item.peers[0]?.picture
  const subtitle = [presentation.title, presentation.detail].filter(Boolean).join(' · ')

  return (
    <View className="flex-row items-center px-5 py-3">
      <AppPressable
        className="min-w-0 flex-1 flex-row items-center"
        onPress={() => onOpen(item)}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${subtitle}, ${formatCallListTime(item.startedAt)}`}
      >
        <ChatAvatar
          name={title}
          picture={picture ?? null}
          size={52}
          showGroupBadge={item.isGroupCall}
        />
        <View className="ml-3 min-w-0 flex-1 pr-3">
          <AppText
            className={`font-medium text-md ${
              presentation.isMissed ? 'text-status-error-text' : 'text-text-primary'
            }`}
            numberOfLines={1}
          >
            {title}
          </AppText>
          <View className="mt-0.5 flex-row items-center">
            <MaterialIcons
              name={presentation.icon}
              size={15}
              color={presentation.isMissed ? colors.status.error : colors.text.secondary}
            />
            <AppText
              className="font-sans ml-1 flex-shrink text-sm2 text-text-secondary"
              numberOfLines={1}
            >
              {subtitle}
            </AppText>
          </View>
        </View>
        <AppText className="font-sans mr-3 text-xs2 text-text-muted">
          {formatCallListTime(item.startedAt)}
        </AppText>
      </AppPressable>
      <SafeTouchableOpacity
        className="h-11 w-11 items-center justify-center overflow-hidden rounded-[16px] bg-surface-muted"
        onPress={() => onCallBack(item)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={
          item.isGroupCall
            ? `Open ${title}`
            : item.callType === 'VIDEO'
              ? `Video call ${title}`
              : `Call ${title}`
        }
      >
        <MaterialIcons
          name={item.callType === 'VIDEO' && !item.isGroupCall ? 'videocam' : 'call'}
          size={20}
          color={colors.brand.primary}
        />
      </SafeTouchableOpacity>
    </View>
  )
}

function CallsEmptyState({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <View className="items-center px-8 pb-6 pt-16">
      <View className="h-12 w-12 items-center justify-center rounded-[18px] border border-brand-soft bg-surface-accent">
        <MaterialIcons
          name={failed ? 'error-outline' : 'call'}
          size={22}
          color={colors.brand.tertiary}
        />
      </View>
      <AppText className="mt-4 text-center font-heading text-lg text-text-primary">
        {failed ? 'Could not load calls' : 'No calls yet'}
      </AppText>
      <AppText className="font-sans mt-1.5 text-center text-base2 leading-5 text-text-secondary">
        {failed
          ? 'Check your connection and try again.'
          : 'Voice and video calls you make or receive will show up here.'}
      </AppText>
      {failed ? (
        <AppPressable
          className="mt-5 h-11 items-center justify-center overflow-hidden rounded-full bg-brand px-6"
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry loading calls"
        >
          <AppText className="text-base2 font-semibold text-white">Try again</AppText>
        </AppPressable>
      ) : null}
    </View>
  )
}

export default function CallsScreen() {
  const insets = useSafeAreaInsets()
  const history = useCallHistory()
  const missedCount = useMissedCallCount()
  const markSeen = useMarkMissedCallsSeen()
  const { openConversation } = useConversationNavigation()
  const { startVoiceCall, startVideoCall } = useCall()

  const items = useMemo(
    () => history.data?.pages.flatMap((page) => page.items) ?? EMPTY_ITEMS,
    [history.data],
  )

  // Opening the tab is what "seeing" missed calls means for the badge.
  const unseenMissedCalls = missedCount.data ?? 0
  const { mutate: markMissedCallsSeen, isPending: isMarkingSeen } = markSeen
  useFocusEffect(
    useCallback(() => {
      if (unseenMissedCalls > 0 && !isMarkingSeen) {
        markMissedCallsSeen()
      }
    }, [isMarkingSeen, markMissedCallsSeen, unseenMissedCalls]),
  )

  const openItem = useCallback(
    (item: CallHistoryItem) => {
      openConversation(item.conversationId)
    },
    [openConversation],
  )

  const callBack = useCallback(
    (item: CallHistoryItem) => {
      const peer = item.peers[0]
      // Group calls need invitees, which the conversation screen asks for.
      if (item.isGroupCall || !peer) {
        openConversation(item.conversationId)
        return
      }

      const input = {
        conversationId: item.conversationId,
        peerUserId: peer.id,
        ...(peer.fullName ? { peerName: peer.fullName } : {}),
        ...(peer.picture ? { peerAvatarUrl: peer.picture } : {}),
      }
      void (item.callType === 'VIDEO' ? startVideoCall(input) : startVoiceCall(input))
    },
    [openConversation, startVideoCall, startVoiceCall],
  )

  const { fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = history
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  // Only a pull shows the spinner: a background refetch (a call row arriving)
  // can run while the tab is off screen, where iOS leaves the spinner stuck.
  const [isRefreshing, setIsRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await Promise.all([refetch(), missedCount.refetch()])
    } finally {
      setIsRefreshing(false)
    }
  }, [missedCount, refetch])

  const renderItem = useCallback(
    ({ item }: { item: CallHistoryItem }) => (
      <CallRow item={item} onOpen={openItem} onCallBack={callBack} />
    ),
    [callBack, openItem],
  )

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <View className="px-5 pb-3 pt-2">
        <AppText className="text-xs2 font-semibold uppercase tracking-[1.8px] text-brand-dark">
          Velora
        </AppText>
        <AppText className="font-display text-[28px] leading-[34px] tracking-[-0.7px] text-text-primary">
          Calls
        </AppText>
      </View>
      {history.isPending ? (
        <View className="flex-1 items-center pt-16">
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.callId}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.brand.primary}
            />
          }
          ListEmptyComponent={
            <CallsEmptyState failed={history.isError} onRetry={() => void refetch()} />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-4">
                <ActivityIndicator color={colors.brand.primary} />
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: getDockedTabBarHeight(insets.bottom) + 16 }}
        />
      )}
    </SafeAreaView>
  )
}
