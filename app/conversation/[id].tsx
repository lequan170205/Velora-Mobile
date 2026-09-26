import { MaterialIcons } from '@expo/vector-icons'
import { useIsFocused } from '@react-navigation/native'
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list'
import { useQuery } from '@tanstack/react-query'
import { BlurView } from 'expo-blur'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, TouchableOpacity, View } from 'react-native'
import { GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, withTiming, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getActiveGroupCall, getCallState } from '../../src/api/call.api'
import { ConversationHeader } from '../../src/components/chat/conversation/ConversationHeader'
import {
  ConversationEmptyState,
  ConversationMessageListLoadingState,
  ConversationTypingIndicator,
} from '../../src/components/chat/conversation/ConversationLoadingState'
import { ConversationMessageRow } from '../../src/components/chat/conversation/ConversationMessageRow'
import { GroupCallInviteSheet } from '../../src/components/chat/conversation/GroupCallInviteSheet'
import { MessageContextMenu } from '../../src/components/chat/MessageContextMenu'
import { MessageInput } from '../../src/components/chat/MessageInput'
import { colors } from '../../src/constants/theme'
import {
  type ConversationComposerTimelineActions,
  useConversationComposerRuntime,
} from '../../src/hooks/conversation/useConversationComposerRuntime'
import { useConversationContextMenuRuntime } from '../../src/hooks/conversation/useConversationContextMenuRuntime'
import { useConversationKeyboardRuntime } from '../../src/hooks/conversation/useConversationKeyboardRuntime'
import { useConversationMediaViewerRuntime } from '../../src/hooks/conversation/useConversationMediaViewerRuntime'
import { useConversationMetadata } from '../../src/hooks/conversation/useConversationMetadata'
import { useConversationPresence } from '../../src/hooks/conversation/useConversationPresence'
import { useConversationReceiptModel } from '../../src/hooks/conversation/useConversationReceiptModel'
import { useConversationSessionRuntime } from '../../src/hooks/conversation/useConversationSessionRuntime'
import { useConversationTimelineController } from '../../src/hooks/conversation/useConversationTimelineController'
import { groupWinnerAction } from '../../src/lib/call/groupWinnerAction'
import {
  backfillReplyPreviewFromResolvedTarget,
  getConversationMessageItemType,
  getConversationMessageKey,
} from '../../src/lib/conversation/conversationMessagePolicies'
import {
  EMPTY_READ_RECEIPT_PARTICIPANTS,
  getGroupTypingLabel,
} from '../../src/lib/conversation/conversationPresentationPolicies'
import { getMessageIdentityKey } from '../../src/lib/messageIdentity'
import { DEFAULT_MESSAGE_LAYOUT } from '../../src/lib/messageListState'
import { useCall } from '../../src/providers/CallProvider'
import { useSocket } from '../../src/providers/SocketProvider'
import { useAuthStore } from '../../src/stores/authStore'
import { useCallStore } from '../../src/stores/callStore'
import { useChatStore } from '../../src/stores/chatStore'

import type { Message } from '../../src/types/conversation.types'

const EMPTY_TYPERS: string[] = []

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const conversationId = id as string
  const router = useRouter()
  const isFocused = useIsFocused()
  const insets = useSafeAreaInsets()
  const { user } = useAuthStore()
  // VIDEO_CALL_1TO1_CONVERSATION_PATCH
  const { startVideoCall, startVoiceCall, joinGroupCall } = useCall()
  const callPhase = useCallStore((state) => state.phase)
  const currentCallId = useCallStore((state) => state.callId)
  const localGroupParticipantCount = useCallStore((state) => state.groupParticipantIds.length)
  const [pendingCallType, setPendingCallType] = useState<'VOICE' | 'VIDEO' | null>(null)
  const [openingActiveCall, setOpeningActiveCall] = useState(false)
  const [selectCallMembersOpen, setSelectCallMembersOpen] = useState(false)
  const [bannerNowMs, setBannerNowMs] = useState(Date.now())
  const callStartInFlightRef = useRef(false)
  const openingCallRef = useRef(false)
  const activeTypers = useChatStore(
    useCallback((state) => state.typingUsers[conversationId] ?? EMPTY_TYPERS, [conversationId]),
  )
  const isConversationRevoked = useChatStore(
    useCallback((state) => state.revokedConversationIds.has(conversationId), [conversationId]),
  )
  const queuedMessageCount = useChatStore(
    useCallback(
      (state) =>
        state.offlineQueue.filter((message) => message.conversationId === conversationId).length,
      [conversationId],
    ),
  )
  const {
    avatarUrl,
    currentConversation,
    displayName,
    isGroup,
    otherParticipant,
    otherUserId,
    participantsMap,
  } = useConversationMetadata({
    conversationId,
    currentUserId: user?.id ?? null,
  })

  const activeGroupCallQuery = useQuery({
    queryKey: ['calls', 'active-group', conversationId],
    queryFn: () => getActiveGroupCall(conversationId),
    enabled: isFocused && isGroup && !isConversationRevoked,
    refetchInterval: 5000,
  })
  const serverCall = activeGroupCallQuery.data
  const localWinnerQuery = useQuery({
    queryKey: ['calls', 'group-winner', user?.id, serverCall?.callId],
    queryFn: () =>
      user?.id && serverCall?.callId ? groupWinnerAction.load(user.id, serverCall.callId) : null,
    enabled: Boolean(user?.id && serverCall?.joined),
  })
  const canRejoin = Boolean(serverCall?.joined && localWinnerQuery.data && callPhase === 'idle')
  const isLocalCall =
    serverCall?.callId === currentCallId && (callPhase === 'active' || callPhase === 'reconnecting')
  const bannerAction: 'join' | 'rejoin' | 'return' | 'wait' = serverCall?.joined
    ? isLocalCall
      ? 'return'
      : canRejoin
        ? 'rejoin'
        : 'wait'
    : 'join'
  const activeGroupCall = serverCall
    ? {
        participantCount: isLocalCall ? localGroupParticipantCount : serverCall.participantCount,
        elapsedSeconds:
          serverCall.elapsedSeconds +
          Math.max(0, Math.floor((bannerNowMs - activeGroupCallQuery.dataUpdatedAt) / 1000)),
        action: bannerAction,
        canOpen: isLocalCall || canRejoin || (!serverCall.joined && callPhase === 'idle'),
      }
    : null
  const isBannerVisible = Boolean(activeGroupCall)

  useEffect(() => {
    if (!isBannerVisible) return
    const timer = setInterval(() => setBannerNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isBannerVisible])

  const handleOpenActiveGroupCall = useCallback(async () => {
    if (!serverCall || openingCallRef.current) return
    openingCallRef.current = true
    setOpeningActiveCall(true)
    try {
      const active = await getActiveGroupCall(conversationId)
      if (!active || active.callId !== serverCall.callId) {
        await activeGroupCallQuery.refetch()
        Alert.alert('Call unavailable', 'This group call has ended.')
        return
      }
      if (!active.joined) {
        if (useCallStore.getState().phase !== 'idle') return
        await joinGroupCall({ callId: active.callId, conversationId, groupName: displayName })
        return
      }
      const latest = await getCallState(active.callId)
      const local = useCallStore.getState()
      if (
        latest.status === 'active' &&
        latest.isGroupCall &&
        latest.conversationId === conversationId &&
        local.callId === latest.callId &&
        (local.phase === 'active' || local.phase === 'reconnecting')
      ) {
        router.push(`/call/${latest.callId}` as never)
      } else if (
        latest.status === 'active' &&
        latest.isGroupCall &&
        latest.conversationId === conversationId &&
        local.phase === 'idle' &&
        user?.id &&
        (await groupWinnerAction.load(user.id, active.callId))
      ) {
        await joinGroupCall({ callId: active.callId, conversationId, groupName: displayName })
      } else {
        await activeGroupCallQuery.refetch()
        Alert.alert('Call unavailable', 'This group call has ended or is no longer on this device.')
      }
    } catch {
      Alert.alert('Call unavailable', 'Could not verify the group call. Please try again.')
    } finally {
      openingCallRef.current = false
      setOpeningActiveCall(false)
    }
  }, [
    activeGroupCallQuery,
    conversationId,
    displayName,
    joinGroupCall,
    router,
    serverCall,
    user?.id,
  ])

  const { socket, isConnected, requestPresence } = useSocket()

  const {
    dismissComposer,
    dismissKeyboardForContextMenu,
    getReplyScrollViewPosition,
    handleComposerFocusChange,
    handleMessageViewportLayout,
    keyboardWrapperStyle,
    listSpacerStyle,
    messageInputRef,
    prepareContextMenuKeyboardPreservation,
    resetConversationKeyboard,
    restoreComposerAfterContextMenu,
  } = useConversationKeyboardRuntime({ bottomInset: insets.bottom })
  const composerTimelineActionsRef = useRef<ConversationComposerTimelineActions | null>(null)
  const {
    handleCancelReply,
    handleRecall,
    handleReply,
    handleSendMedia,
    handleSendSuggestedQuery,
    handleSendText,
    handleTyping,
    replyToMessage,
  } = useConversationComposerRuntime({
    conversationId,
    messageInputRef,
    socket,
    timelineActionsRef: composerTimelineActionsRef,
  })
  const {
    cancelOwnSendBottomFollow,
    currentIsFetchingOlder,
    currentOlderLoader,
    handleMomentumScrollEnd,
    handleScroll,
    handleScrollAffordancePress,
    handleScrollBeginDrag,
    handleScrollEndDrag,
    handleScrollToMessage,
    hasLoadedLatestMessagePages,
    isInitialMessagesLoading,
    isNearBottom,
    latestSeenFrontierMessageId,
    layoutById,
    layoutByIdRef,
    listRef,
    messageById,
    orderedMessages,
    prepareOwnSendBottomFollow,
    registerPendingOwnMediaBatchScrollTransaction,
    resetTimestampRevealForReply,
    scrollButtonStyle,
    timelineMode,
    timestampRevealGesture,
    timestampRevealOffset,
    timestampRevealProgress,
  } = useConversationTimelineController({
    conversation: currentConversation ?? null,
    conversationId,
    currentUserId: user?.id ?? null,
    getReplyScrollViewPosition,
    resetConversationKeyboard,
    socket,
  })
  useLayoutEffect(() => {
    const timelineActions: ConversationComposerTimelineActions = {
      cancelOwnSendBottomFollow,
      prepareOwnSendBottomFollow,
      registerPendingOwnMediaBatchScrollTransaction,
      resetTimestampRevealForReply,
    }
    composerTimelineActionsRef.current = timelineActions

    return () => {
      if (composerTimelineActionsRef.current === timelineActions) {
        composerTimelineActionsRef.current = null
      }
    }
  }, [
    cancelOwnSendBottomFollow,
    prepareOwnSendBottomFollow,
    registerPendingOwnMediaBatchScrollTransaction,
    resetTimestampRevealForReply,
  ])
  const { transitionDone } = useConversationSessionRuntime({
    conversation: currentConversation ?? null,
    conversationId,
    currentUser: user ?? null,
    hasLoadedLatestMessagePages,
    isConnected,
    isNearBottom,
    latestSeenFrontierMessageId,
    socket,
    timelineMode,
  })

  const isOtherUserTyping = activeTypers.some((typerId) => typerId !== user?.id)
  const shouldShowTypingIndicator = isOtherUserTyping && isNearBottom
  const {
    activeContextMenuData,
    activeContextMenuMessageId,
    clearActiveContextMenu,
    closeActiveContextMenu,
    handleOpenContextMenu,
  } = useConversationContextMenuRuntime({
    currentUserId: user?.id ?? null,
    dismissKeyboardForContextMenu,
    layoutById,
    messageById,
    prepareContextMenuKeyboardPreservation,
    restoreComposerAfterContextMenu,
  })

  const groupTypingLabel = useMemo(() => {
    return getGroupTypingLabel({
      activeTypers,
      conversation: currentConversation ?? null,
      currentUserId: user?.id ?? null,
    })
  }, [activeTypers, currentConversation, user?.id])

  const startOutgoingCall = useCallback(
    async (callType: 'VOICE' | 'VIDEO', selectedInviteeIds?: string[]) => {
      if (
        (!otherUserId && !currentConversation?.isGroup) ||
        (callType === 'VIDEO' && currentConversation?.isGroup) ||
        callStartInFlightRef.current ||
        callPhase !== 'idle'
      ) {
        return
      }

      callStartInFlightRef.current = true
      setPendingCallType(callType)

      try {
        const input = {
          conversationId,
          ...(otherUserId ? { peerUserId: otherUserId } : {}),
          ...(displayName ? { peerName: displayName } : {}),
          ...(avatarUrl ? { peerAvatarUrl: avatarUrl } : {}),
          ...(currentConversation?.isGroup ? { isGroupCall: true } : {}),
          ...(selectedInviteeIds ? { selectedInviteeIds } : {}),
        }

        if (callType === 'VIDEO') await startVideoCall({ ...input })
        else await startVoiceCall({ ...input })
      } finally {
        callStartInFlightRef.current = false
        setPendingCallType(null)
      }
    },
    [
      avatarUrl,
      callPhase,
      conversationId,
      currentConversation?.isGroup,
      displayName,
      otherUserId,
      startVideoCall,
      startVoiceCall,
    ],
  )

  const handleStartVoiceCall = useCallback(() => {
    if (!otherUserId && !currentConversation?.isGroup) {
      return
    }
    void startOutgoingCall('VOICE')
  }, [currentConversation?.isGroup, otherUserId, startOutgoingCall])

  const handleStartVideoCall = useCallback(() => {
    if (!otherUserId || currentConversation?.isGroup) return
    void startOutgoingCall('VIDEO')
  }, [currentConversation?.isGroup, otherUserId, startOutgoingCall])

  const { closeMediaViewer, handleOpenMedia, handleSaveMedia, mediaGalleryItems } =
    useConversationMediaViewerRuntime({
      clearActiveContextMenu,
      conversationId,
      conversationTitle: displayName,
      orderedMessages,
      timelineMode,
    })

  const handleOpenGroupInfo = useCallback(() => {
    if (!currentConversation?.isGroup) return

    dismissComposer()
    router.push({
      pathname: '/conversation/[id]/info',
      params: { id: conversationId },
    })
  }, [conversationId, currentConversation?.isGroup, dismissComposer, router])

  useEffect(() => {
    if (!isConversationRevoked) {
      return
    }

    dismissComposer()
    closeMediaViewer()
    requestAnimationFrame(() => {
      router.replace('/')
    })
  }, [closeMediaViewer, dismissComposer, isConversationRevoked, router])

  const { primaryStatusByIdentityKey, readReceiptsByIdentityKey } = useConversationReceiptModel({
    conversation: currentConversation ?? null,
    currentUserId: user?.id ?? null,
    orderedMessages,
    otherParticipant,
  })
  const { isOnline, presenceLabel } = useConversationPresence({
    conversationId,
    isConnected,
    isGroup,
    otherUserId: otherUserId ?? null,
    requestPresence,
    transitionDone,
  })

  const renderListHeader = useCallback(() => {
    return (
      <View>
        {shouldShowTypingIndicator ? (
          <ConversationTypingIndicator label={groupTypingLabel ?? `${displayName} is typing`} />
        ) : null}
        <Animated.View style={listSpacerStyle} />
      </View>
    )
  }, [displayName, groupTypingLabel, listSpacerStyle, shouldShowTypingIndicator])
  const listExtraData = useMemo(
    () => ({
      layoutById,
      primaryStatusByIdentityKey,
      readReceiptsByIdentityKey,
    }),
    [layoutById, primaryStatusByIdentityKey, readReceiptsByIdentityKey],
  )

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Message>) => {
      if (!item) return null

      const layout = layoutByIdRef.current.get(item.id) ?? DEFAULT_MESSAGE_LAYOUT
      const isOwn = item.senderId === user?.id
      const sender = item.sender ?? participantsMap.get(item.senderId)
      const messageIdentityKey = getMessageIdentityKey(item)
      const replyToId = item.replyToId ?? item.reply_to_id
      const repliedMessage = replyToId ? (messageById.get(replyToId) ?? null) : null
      const resolvedReplyTarget = repliedMessage ?? item.replyTo ?? null
      const normalizedMessage = backfillReplyPreviewFromResolvedTarget({
        conversation: currentConversation ?? null,
        currentUserId: user?.id ?? null,
        message: item,
        replyTo: resolvedReplyTarget,
      })
      const primaryStatusLabel = messageIdentityKey
        ? (primaryStatusByIdentityKey.get(messageIdentityKey) ?? null)
        : null
      const readReceiptParticipants = messageIdentityKey
        ? (readReceiptsByIdentityKey.get(messageIdentityKey) ?? EMPTY_READ_RECEIPT_PARTICIPANTS)
        : EMPTY_READ_RECEIPT_PARTICIPANTS

      return (
        <ConversationMessageRow
          message={normalizedMessage}
          repliedMessage={repliedMessage}
          layout={layout}
          isOwn={isOwn}
          showSenderName={isGroup}
          primaryStatusLabel={primaryStatusLabel}
          readReceiptParticipants={readReceiptParticipants}
          timestampRevealGesture={timestampRevealGesture}
          timestampRevealOffset={timestampRevealOffset}
          timestampRevealProgress={timestampRevealProgress}
          senderInfo={sender ?? null}
          conversationId={conversationId}
          isContextMenuActive={messageIdentityKey === activeContextMenuMessageId}
          onPressReplyPreview={handleScrollToMessage}
          onReply={handleReply}
          onSendSuggestedQuery={handleSendSuggestedQuery}
          onOpenContextMenu={handleOpenContextMenu}
          onOpenMedia={handleOpenMedia}
        />
      )
    },
    [
      activeContextMenuMessageId,
      conversationId,
      currentConversation,
      handleReply,
      handleSendSuggestedQuery,
      handleScrollToMessage,
      handleOpenContextMenu,
      handleOpenMedia,
      isGroup,
      layoutByIdRef,
      messageById,
      participantsMap,
      primaryStatusByIdentityKey,
      readReceiptsByIdentityKey,
      timestampRevealGesture,
      timestampRevealOffset,
      timestampRevealProgress,
      user?.id,
    ],
  )

  const getItemType = useCallback((item: Message) => getConversationMessageItemType(item), [])
  const keyExtractor = useCallback(
    (item: Message, index: number) => getConversationMessageKey(item, index),
    [],
  )

  const loadingIndicatorStyle = useAnimatedStyle(() => {
    const isVisible = currentIsFetchingOlder && !isInitialMessagesLoading
    return {
      transform: [
        {
          translateY: withSpring(isVisible ? 24 : -40, {
            damping: 22,
            stiffness: 260,
            mass: 0.8,
          }),
        },
        {
          scale: withSpring(isVisible ? 1 : 0.8, {
            damping: 22,
            stiffness: 260,
          }),
        },
      ],
      opacity: withTiming(isVisible ? 1 : 0, { duration: 150 }),
    }
  })

  const handleBack = useCallback(() => {
    dismissComposer()
    requestAnimationFrame(() => {
      router.back()
    })
  }, [dismissComposer, router])

  if (isConversationRevoked) {
    return <View className="flex-1 bg-bg-primary" />
  }

  return (
    <View className="flex-1 bg-bg-primary" style={{ paddingTop: insets.top }}>
      <View className="flex-1 z-10">
        <ConversationHeader
          activeGroupCall={activeGroupCall}
          openingActiveCall={openingActiveCall}
          {...(avatarUrl ? { avatarUrl } : {})}
          displayName={displayName}
          groupTypingLabel={groupTypingLabel}
          isConnected={isConnected}
          isGroup={isGroup}
          isOnline={isOnline}
          participantCount={currentConversation?.participantIds.length ?? 0}
          callActionsDisabled={callPhase !== 'idle' || pendingCallType !== null}
          pendingCallType={pendingCallType}
          presenceLabel={presenceLabel}
          queuedMessageCount={queuedMessageCount}
          showCallActions={
            callPhase === 'idle' &&
            !serverCall &&
            (currentConversation?.isGroup === true || Boolean(otherUserId))
          }
          showVideoCallAction={!currentConversation?.isGroup}
          onBack={handleBack}
          onOpenGroupInfo={handleOpenGroupInfo}
          onOpenActiveGroupCall={() => {
            void handleOpenActiveGroupCall()
          }}
          onStartVideoCall={handleStartVideoCall}
          onStartVoiceCall={handleStartVoiceCall}
          onSelectGroupCallMembers={() => setSelectCallMembersOpen(true)}
        />

        <View
          style={{ flex: 1, overflow: 'hidden', backgroundColor: 'transparent' }}
          onLayout={handleMessageViewportLayout}
        >
          <Animated.View style={[{ flex: 1 }, keyboardWrapperStyle]}>
            <View className="flex-1">
              <GestureDetector gesture={timestampRevealGesture}>
                <View className="flex-1">
                  {currentIsFetchingOlder && !isInitialMessagesLoading ? (
                    <Animated.View
                      style={[
                        loadingIndicatorStyle,
                        {
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          zIndex: 20,
                          alignItems: 'center',
                        },
                      ]}
                      pointerEvents="none"
                    >
                      {Platform.OS === 'android' ? (
                        <View
                          className="flex-row items-center justify-center rounded-full bg-surface-card px-3.5 py-2 border border-border-light"
                          style={{ elevation: 4 }}
                        >
                          <ActivityIndicator size="small" color={colors.brand.primary} />
                        </View>
                      ) : (
                        <View
                          style={{
                            borderRadius: 24,
                            shadowColor: '#000000',
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.12,
                            shadowRadius: 12,
                          }}
                        >
                          <View style={{ borderRadius: 24, overflow: 'hidden' }}>
                            <BlurView
                              intensity={65}
                              tint="light"
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                paddingHorizontal: 14,
                                paddingVertical: 8,
                                backgroundColor: 'rgba(255, 255, 255, 0.4)',
                              }}
                            >
                              <ActivityIndicator size="small" color={colors.brand.primary} />
                            </BlurView>
                          </View>
                        </View>
                      )}
                    </Animated.View>
                  ) : null}
                  <FlashList
                    ref={listRef}
                    inverted
                    data={orderedMessages}
                    extraData={listExtraData}
                    scrollEnabled={!activeContextMenuData}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    getItemType={getItemType}
                    contentContainerStyle={{
                      paddingBottom: 20,
                    }}
                    onEndReached={currentOlderLoader}
                    onEndReachedThreshold={0.2}
                    onScroll={handleScroll}
                    onScrollBeginDrag={handleScrollBeginDrag}
                    onScrollEndDrag={handleScrollEndDrag}
                    onMomentumScrollEnd={handleMomentumScrollEnd}
                    scrollEventThrottle={16}
                    keyboardDismissMode="none"
                    keyboardShouldPersistTaps="handled"
                    ListHeaderComponent={renderListHeader}
                    ListEmptyComponent={
                      isInitialMessagesLoading ? (
                        <ConversationMessageListLoadingState />
                      ) : (
                        <ConversationEmptyState />
                      )
                    }
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={false}
                    maintainVisibleContentPosition={{ disabled: Platform.OS === 'android' }}
                  />
                  <Animated.View
                    pointerEvents="box-none"
                    style={[
                      scrollButtonStyle,
                      {
                        position: 'absolute',
                        right: 16,
                        bottom: 104,
                        zIndex: 40,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      className="h-11 w-11 items-center justify-center rounded-full border border-border-light bg-surface-card"
                      onPress={handleScrollAffordancePress}
                      activeOpacity={0.8}
                      style={{
                        borderCurve: 'continuous',
                        boxShadow: '0 10px 24px rgba(22, 22, 22, 0.10)',
                      }}
                    >
                      <MaterialIcons
                        name="keyboard-arrow-down"
                        size={24}
                        color={colors.text.primary}
                      />
                    </TouchableOpacity>
                  </Animated.View>
                </View>
              </GestureDetector>
              <Animated.View
                pointerEvents="box-none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 30,
                }}
              >
                <MessageInput
                  ref={messageInputRef}
                  onSend={handleSendText}
                  onSendMedia={handleSendMedia}
                  onChangeText={handleTyping}
                  onFocusChange={handleComposerFocusChange}
                  replyTo={replyToMessage}
                  onCancelReply={handleCancelReply}
                />
              </Animated.View>
            </View>
          </Animated.View>
        </View>

        <MessageContextMenu
          visible={Boolean(activeContextMenuData)}
          message={activeContextMenuData?.message ?? null}
          replyTarget={activeContextMenuData?.replyTarget ?? null}
          previewLayout={activeContextMenuData?.previewLayout}
          isOwn={activeContextMenuData?.isOwn ?? false}
          isGroupedTop={activeContextMenuData?.isGroupedTop ?? false}
          isGroupedBottom={activeContextMenuData?.isGroupedBottom ?? false}
          anchor={activeContextMenuData?.anchor ?? null}
          gestureState={activeContextMenuData?.gestureState}
          onClose={closeActiveContextMenu}
          onReply={
            activeContextMenuData ? () => handleReply(activeContextMenuData.message) : undefined
          }
          onRecall={
            activeContextMenuData ? () => handleRecall(activeContextMenuData.message.id) : undefined
          }
          onSave={
            activeContextMenuData
              ? () => {
                  const item = mediaGalleryItems.find(
                    (galleryItem) =>
                      galleryItem.id === getMessageIdentityKey(activeContextMenuData.message),
                  )
                  if (item) {
                    void handleSaveMedia(item)
                  }
                }
              : undefined
          }
          conversationId={activeContextMenuData?.conversationId}
        />
      </View>
      <GroupCallInviteSheet
        conversationId={conversationId}
        currentUserId={user?.id ?? null}
        visible={selectCallMembersOpen}
        onClose={() => setSelectCallMembersOpen(false)}
        onStart={(userIds) => {
          setSelectCallMembersOpen(false)
          void startOutgoingCall('VOICE', userIds)
        }}
      />
    </View>
  )
}
