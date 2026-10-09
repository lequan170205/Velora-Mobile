import { MaterialIcons } from '@expo/vector-icons'
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { useQuery } from '@tanstack/react-query'
import { useKeepAwake } from 'expo-keep-awake'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Platform, useWindowDimensions, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { RTCView } from 'react-native-webrtc'

import { conversationApi } from '../../src/api/conversation.api'
import { AppPressable } from '../../src/components/base/AppPressable'
import { AppText } from '../../src/components/base/AppText'
import { CameraOffSurface } from '../../src/components/call/CameraOffSurface'
import { IconButton } from '../../src/components/call/IconButton'
import { PeerAvatar } from '../../src/components/call/PeerAvatar'
import { VideoParticipantGrid } from '../../src/components/call/VideoParticipantGrid'
import { queryKeys } from '../../src/constants/queryKeys'
import { colors } from '../../src/constants/theme'
import { createCallRequestId } from '../../src/lib/call/callSocket'
import { veloraSystemCalls } from '../../src/lib/systemCalls/veloraSystemCalls'
import { useCall } from '../../src/providers/CallProvider'
import { useAuthStore } from '../../src/stores/authStore'
import { useCallStore } from '../../src/stores/callStore'

const formatDuration = (secs: number) => {
  const minutes = Math.floor(secs / 60)
  const seconds = secs % 60
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

const CALL_LAYOUT_ENTERING = FadeIn.duration(220)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System)
const CALL_LAYOUT_EXITING = FadeOut.duration(140)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System)

function CallDock({ children }: { children: ReactNode }) {
  return (
    <View
      className="flex-row items-center justify-around rounded-full px-2 py-2"
      style={{
        minHeight: 66,
        width: '100%',
        maxWidth: 420,
        alignSelf: 'center',
        backgroundColor: colors.call.dock,
        borderWidth: 1,
        borderColor: colors.call.controlBorder,
      }}
    >
      {children}
    </View>
  )
}

export default function ActiveCallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const {
    inviteGroupMember,
    endCall,
    recordCallScreenVisible,
    switchCallType,
    switchCamera,
    toggleCamera,
    toggleMute,
    toggleSpeaker,
  } = useCall()
  const {
    callId,
    callType,
    cameraEnabled,
    conversationId,
    durationSec,
    groupParticipantIds,
    groupReconnectingUserIds,
    groupMicStates,
    groupMicSyncError,
    groupInvitations,
    isGroupCall,
    localStreamUrl,
    muted,
    peerAvatarUrl,
    peerName,
    phase,
    reconnectDeadlineMs,
    remoteAudioState,
    remoteStreamUrl,
    remoteVideoState,
    speakerEnabled,
  } = useCallStore()
  const [nowMs, setNowMs] = useState(Date.now())
  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeVisibleRef = useRef(true)
  const [participantsVisible, setParticipantsVisible] = useState(false)
  const [inviteFeedback, setInviteFeedback] = useState<Record<string, string>>({})
  const inviteRequestsRef = useRef(new Map<string, string>())
  const inviteInFlightRef = useRef(new Set<string>())
  useEffect(() => {
    inviteRequestsRef.current.clear()
    inviteInFlightRef.current.clear()
    setInviteFeedback({})
  }, [callId])
  const [controlsVisible, setControlsVisible] = useState(false)
  const participantsSheetRef = useRef<BottomSheet>(null)
  const controlsSheetRef = useRef<BottomSheet>(null)
  const switchToVoiceAfterSheetDismissRef = useRef(false)
  const currentUser = useAuthStore((state) => state.user)
  const { data: groupMembers = [], refetch: refreshGroupMembers } = useQuery({
    queryKey: queryKeys.conversations.members(conversationId ?? ''),
    queryFn: () =>
      conversationId ? conversationApi.getMembers(conversationId) : Promise.resolve([]),
    enabled: isGroupCall && Boolean(conversationId),
    staleTime: 60_000,
    refetchInterval: participantsVisible && isGroupCall ? 5000 : false,
  })
  const groupPeopleIds = useMemo(
    () => (isGroupCall ? [...new Set(groupParticipantIds)] : []),
    [groupParticipantIds, isGroupCall],
  )
  const chromeProgress = useSharedValue(1)
  const isLandscape = width > height
  const systemTopInset =
    insets.top > 0 ? insets.top : Platform.OS === 'ios' && !isLandscape ? 54 : 24
  const callTopInset = systemTopInset + (isLandscape ? 4 : 6)

  const toggleCallChrome = useCallback(() => {
    const nextVisible = !chromeVisibleRef.current
    chromeVisibleRef.current = nextVisible
    setChromeVisible(nextVisible)
    chromeProgress.value = withTiming(nextVisible ? 1 : 0, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    })
  }, [chromeProgress])

  const topChromeStyle = useAnimatedStyle(() => ({
    opacity: chromeProgress.value,
    transform: [{ translateY: (1 - chromeProgress.value) * -8 }],
  }))

  const bottomChromeStyle = useAnimatedStyle(() => ({
    opacity: chromeProgress.value,
    transform: [{ translateY: (1 - chromeProgress.value) * 14 }],
  }))

  const renderSheetBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.62}
        pressBehavior="close"
        style={[props.style, { zIndex: 99 }]}
      />
    ),
    [],
  )

  const handleControlsSheetDismiss = useCallback(() => {
    setControlsVisible(false)
    if (!switchToVoiceAfterSheetDismissRef.current) return
    switchToVoiceAfterSheetDismissRef.current = false
    void switchCallType('VOICE')
  }, [switchCallType])

  const handleOpenParticipants = useCallback(() => {
    if (isGroupCall) void refreshGroupMembers()
    setParticipantsVisible(true)
    participantsSheetRef.current?.snapToIndex(0)
  }, [isGroupCall, refreshGroupMembers])

  const handleInvite = async (userId: string) => {
    if (!callId || phase !== 'active' || inviteInFlightRef.current.has(userId)) return
    const invitingCallId = callId
    const requestId = inviteRequestsRef.current.get(userId) ?? createCallRequestId('group-invite')
    inviteRequestsRef.current.set(userId, requestId)
    inviteInFlightRef.current.add(userId)
    setInviteFeedback((current) => ({ ...current, [userId]: 'Sending…' }))
    try {
      const result = await inviteGroupMember(userId, requestId)
      if (useCallStore.getState().callId !== invitingCallId) return
      inviteRequestsRef.current.delete(userId)
      const messages = {
        sent: 'Invite sent',
        already_sent: 'Invite already sent',
        cooldown: 'Please wait before inviting again',
        busy: 'Busy in another call',
        joined: 'Already in this call',
        full: 'This call is full',
        forbidden: 'Cannot invite this member',
        terminal: 'This call has ended',
      }
      setInviteFeedback((current) => ({ ...current, [userId]: messages[result.outcome] }))
    } catch (error) {
      if (useCallStore.getState().callId !== invitingCallId) return
      // Retain the request ID on an ambiguous timeout so retry cannot ring twice.
      setInviteFeedback((current) => ({
        ...current,
        [userId]:
          error instanceof Error
            ? `Unable to invite: ${error.message}`
            : 'Unable to invite. Try again.',
      }))
    } finally {
      if (useCallStore.getState().callId === invitingCallId)
        inviteInFlightRef.current.delete(userId)
    }
  }

  // A group call has no host: leaving only disconnects this member, so there is
  // nothing to confirm on behalf of the others.
  const handleEndCallPress = useCallback(() => {
    void endCall()
  }, [endCall])

  useKeepAwake()

  useEffect(() => {
    if (phase !== 'reconnecting' || !reconnectDeadlineMs) return
    setNowMs(Date.now())
    const intervalId = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(intervalId)
  }, [phase, reconnectDeadlineMs])

  const isValidPhase = useMemo(
    () =>
      phase === 'outgoing_ringing' ||
      phase === 'connecting' ||
      phase === 'reconnecting' ||
      phase === 'active' ||
      phase === 'ending',
    [phase],
  )

  useEffect(() => {
    if (!id || callId !== id || !isValidPhase) {
      if (router.canGoBack()) router.back()
      else router.replace('/')
    }
  }, [callId, id, isValidPhase, router])

  useEffect(() => {
    if (!id || callId !== id || !isValidPhase) return
    recordCallScreenVisible(id)
  }, [callId, id, isValidPhase, recordCallScreenVisible])

  const statusLabel = useMemo(() => {
    if (phase === 'outgoing_ringing') return 'Calling…'
    if (phase === 'connecting') return 'Connecting…'
    if (phase === 'reconnecting') return 'Reconnecting…'
    if (phase === 'ending') return 'Ending…'
    if (phase === 'active' && isGroupCall && groupPeopleIds.length < 2)
      return 'Waiting for others to join…'
    if (phase === 'active' && remoteAudioState === 'waiting')
      return isGroupCall ? 'Connecting group audio…' : 'Waiting for audio…'
    if (phase === 'active') return formatDuration(durationSec)
    return ''
  }, [durationSec, groupPeopleIds.length, isGroupCall, phase, remoteAudioState])

  const reconnectSecondsLeft =
    reconnectDeadlineMs && phase === 'reconnecting'
      ? Math.max(0, Math.ceil((reconnectDeadlineMs - nowMs) / 1000))
      : null

  const isVideo = callType === 'VIDEO'
  const areAllVideoCamerasOff = isVideo && !cameraEnabled && remoteVideoState === 'off'
  const shouldRenderVideoTiles = isVideo && phase !== 'outgoing_ringing' && !areAllVideoCamerasOff
  const isSheetOpen = participantsVisible || controlsVisible
  const controlsDisabled = phase !== 'active'
  const hasRemoteVideo = isVideo && remoteVideoState === 'connected' && Boolean(remoteStreamUrl)
  const hasLocalVideo = isVideo && cameraEnabled && Boolean(localStreamUrl)
  const cameraOffStatus =
    phase === 'active' ? `${peerName ? `${peerName}’s` : 'Their'} camera is off` : statusLabel

  const minimizeButton = veloraSystemCalls.usesNativeCallUi ? (
    <AppPressable
      className="h-12 w-12 items-center justify-center rounded-full"
      style={{ backgroundColor: colors.call.topControl }}
      activeOpacity={0.64}
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Minimize call"
    >
      <MaterialIcons name="keyboard-arrow-down" size={34} color={colors.call.textPrimary} />
    </AppPressable>
  ) : null

  const participantsButton = (
    <AppPressable
      className="h-12 w-12 items-center justify-center rounded-full"
      style={{ backgroundColor: colors.call.topControl }}
      activeOpacity={0.64}
      onPress={handleOpenParticipants}
      accessibilityRole="button"
      accessibilityLabel={
        isGroupCall ? `Show ${groupPeopleIds.length} participants` : 'Show participants'
      }
      accessibilityState={{ expanded: participantsVisible }}
    >
      <MaterialIcons name="people-outline" size={27} color={colors.call.textPrimary} />
    </AppPressable>
  )

  const activeControls = (
    <CallDock>
      {isVideo ? (
        <IconButton
          icon={cameraEnabled ? 'videocam' : 'videocam-off'}
          label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          selected={cameraEnabled}
          disabled={controlsDisabled}
          onPress={() => void toggleCamera()}
        />
      ) : !isGroupCall ? (
        <IconButton
          icon="videocam"
          label="Switch to video call"
          disabled={controlsDisabled}
          onPress={() => void switchCallType('VIDEO')}
        />
      ) : null}

      <IconButton
        icon={muted ? 'mic-off' : 'mic'}
        label={muted ? 'Unmute microphone' : 'Mute microphone'}
        selected={!muted}
        // Before active, mute has no track to control; only End is enabled.
        disabled={controlsDisabled}
        onPress={toggleMute}
      />

      {isVideo ? (
        <IconButton
          icon="more-horiz"
          label="More call controls"
          selected={controlsVisible}
          disabled={controlsDisabled}
          expanded={controlsVisible}
          onPress={() => {
            setControlsVisible(true)
            controlsSheetRef.current?.expand()
          }}
        />
      ) : null}

      {isVideo && cameraEnabled ? (
        <IconButton
          icon="cameraswitch"
          label="Flip camera"
          disabled={controlsDisabled}
          onPress={() => void switchCamera()}
        />
      ) : (
        <IconButton
          icon={speakerEnabled ? 'volume-up' : 'volume-off'}
          label={speakerEnabled ? 'Turn speaker off' : 'Turn speaker on'}
          selected={speakerEnabled}
          disabled={controlsDisabled}
          onPress={toggleSpeaker}
        />
      )}

      <IconButton
        icon="call-end"
        label={isGroupCall ? 'Leave call' : 'End call'}
        destructive
        size={52}
        onPress={handleEndCallPress}
      />
    </CallDock>
  )

  const participantRows = isGroupCall
    ? groupPeopleIds.map((userId, index) => {
        const member = groupMembers.find((item) => item.userId === userId)
        const isYou = userId === currentUser?.id
        const isReconnecting = groupReconnectingUserIds.includes(userId)
        const micStatus = isYou
          ? groupMicSyncError
            ? 'Mic sync failed'
            : phase === 'reconnecting'
              ? 'Mic reconnecting'
              : muted
                ? 'Mic off'
                : 'Mic on'
          : isReconnecting
            ? 'Mic status unavailable'
            : groupMicStates[userId]?.enabled === true
              ? 'Mic on'
              : groupMicStates[userId]?.enabled === false
                ? 'Mic off'
                : 'Mic status unavailable'
        return {
          id: userId,
          name: isYou
            ? 'You'
            : member?.user.fullName ||
              member?.user.name ||
              member?.user.username ||
              `Member ${index + 1}`,
          avatarUrl: isYou ? (currentUser?.picture ?? null) : (member?.user.picture ?? null),
          subtitle: isReconnecting
            ? 'Reconnecting…'
            : isYou && currentUser?.username
              ? `@${currentUser.username}`
              : null,
          isReconnecting,
          micStatus,
        }
      })
    : [
        {
          id: 'self',
          name: 'You',
          avatarUrl: currentUser?.picture ?? null,
          subtitle: currentUser?.username ? `@${currentUser.username}` : null,
          isReconnecting: false,
          micStatus: null,
        },
        {
          id: 'peer',
          name: peerName || 'Unknown',
          avatarUrl: peerAvatarUrl,
          subtitle: null,
          isReconnecting: false,
          micStatus: null,
        },
      ]
  const joinedUserIds = new Set(groupPeopleIds)
  const notInCallMembers = isGroupCall
    ? groupMembers.filter(
        (member) => member.status === 'ACTIVE' && !joinedUserIds.has(member.userId),
      )
    : []

  const participantsSheet = (
    <BottomSheet
      ref={participantsSheetRef}
      index={-1}
      snapPoints={['74%']}
      enableDynamicSizing={false}
      enablePanDownToClose
      animateOnMount={false}
      backdropComponent={renderSheetBackdrop}
      containerStyle={{ zIndex: 100 }}
      backgroundStyle={{ backgroundColor: colors.call.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.call.sheetHandle, width: 40 }}
      onChange={(index) => setParticipantsVisible(index >= 0)}
    >
      <BottomSheetView style={{ flex: 1 }}>
        <View className="flex-row items-center justify-between px-5">
          <View className="h-11 w-11" />
          <AppText
            className="font-heading text-[22px] font-bold"
            style={{ color: colors.call.textPrimary }}
          >
            People
          </AppText>
          <AppPressable
            className="h-11 w-11 items-center justify-center rounded-full"
            onPress={() => participantsSheetRef.current?.close()}
            accessibilityRole="button"
            accessibilityLabel="Close participants"
          >
            <MaterialIcons name="close" size={25} color={colors.call.textPrimary} />
          </AppPressable>
        </View>

        <View className="mt-3 h-px" style={{ backgroundColor: colors.call.controlBorder }} />
        <BottomSheetScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 16),
          }}
        >
          <AppText
            className="mb-3 mt-6 text-[18px] font-bold"
            style={{ color: colors.call.textPrimary }}
            accessibilityRole="header"
          >
            {isGroupCall ? `In this call · ${groupPeopleIds.length}` : 'In this call'}
          </AppText>
          {participantRows.map((person) => (
            <View
              key={person.id}
              className="flex-row items-center py-3"
              accessible
              accessibilityLabel={`${person.name}, ${person.isReconnecting ? 'reconnecting to this call' : 'in this call'}${person.micStatus ? `, ${person.micStatus}` : ''}`}
            >
              <PeerAvatar avatarUrl={person.avatarUrl} name={person.name} size={56} />
              <View className="ml-4 min-w-0 flex-1">
                <AppText
                  className="text-[17px] font-semibold"
                  style={{ color: colors.call.textPrimary }}
                  numberOfLines={1}
                >
                  {person.name}
                </AppText>
                {person.subtitle ? (
                  <AppText className="mt-0.5 text-sm" style={{ color: colors.call.textSecondary }}>
                    {person.subtitle}
                  </AppText>
                ) : null}
                {person.micStatus ? (
                  <View className="mt-1 flex-row items-center" accessible={false}>
                    <MaterialIcons
                      name={person.micStatus === 'Mic on' ? 'mic' : 'mic-off'}
                      size={18}
                      color={colors.call.textSecondary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                    <AppText className="ml-1 text-sm" style={{ color: colors.call.textSecondary }}>
                      {person.micStatus}
                    </AppText>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
          {notInCallMembers.length > 0 ? (
            <>
              <View className="mt-4 h-px" style={{ backgroundColor: colors.call.controlBorder }} />
              <AppText
                className="mb-3 mt-6 text-[18px] font-bold"
                style={{ color: colors.call.textPrimary }}
                accessibilityRole="header"
              >
                Not in call · {notInCallMembers.length}
              </AppText>
              {notInCallMembers.map((member) => {
                const name =
                  member.user.fullName || member.user.name || member.user.username || 'Member'
                const invite = groupInvitations[member.userId]
                const statusLabels = {
                  ringing: 'Ringing',
                  joining: 'Joining',
                  in_call: 'Connecting',
                  declined: 'Declined',
                  busy: 'Busy',
                  expired: 'Missed / expired',
                  left: 'Left the call',
                }
                const sending = inviteInFlightRef.current.has(member.userId)
                const coolingDown = Boolean(
                  invite &&
                  (invite.status === 'joining' ||
                    invite.status === 'in_call' ||
                    (invite.status === 'ringing' && Date.parse(invite.expiresAt) > nowMs) ||
                    Date.parse(invite.sentAt) + 10_000 > nowMs),
                )
                const disabled = phase !== 'active' || sending || coolingDown
                const status =
                  inviteFeedback[member.userId] === 'Sending…' || !invite
                    ? inviteFeedback[member.userId] || 'Not invited'
                    : statusLabels[invite.status]
                return (
                  <View key={member.userId} className="flex-row items-center py-3">
                    <PeerAvatar avatarUrl={member.user.picture ?? null} name={name} size={56} />
                    <View className="ml-4 min-w-0 flex-1">
                      <AppText
                        className="text-[17px]"
                        style={{ color: colors.call.textSecondary }}
                        numberOfLines={1}
                      >
                        {name}
                      </AppText>
                      <AppText
                        className="mt-1 text-sm"
                        style={{ color: colors.call.textSecondary }}
                        accessibilityLiveRegion="polite"
                      >
                        {status}
                      </AppText>
                      {inviteFeedback[member.userId] &&
                      inviteFeedback[member.userId] !== 'Sending…' ? (
                        <AppText
                          className="mt-1 text-sm"
                          style={{ color: colors.call.textSecondary }}
                        >
                          {inviteFeedback[member.userId]}
                        </AppText>
                      ) : null}
                    </View>
                    <AppPressable
                      className="ml-2 min-h-12 min-w-12 items-center justify-center rounded-full px-3"
                      onPress={() => void handleInvite(member.userId)}
                      disabled={disabled}
                      activeOpacity={0.68}
                      accessibilityRole="button"
                      accessibilityLabel={`${invite ? 'Invite again' : 'Invite'} ${name}`}
                      accessibilityState={{ disabled, busy: sending }}
                      style={{ opacity: disabled ? 0.45 : 1, backgroundColor: colors.call.control }}
                    >
                      <AppText style={{ color: colors.call.textPrimary }}>
                        {sending ? 'Sending…' : invite ? 'Invite again' : 'Invite'}
                      </AppText>
                    </AppPressable>
                  </View>
                )
              })}
            </>
          ) : null}
        </BottomSheetScrollView>
      </BottomSheetView>
    </BottomSheet>
  )

  const controlsSheet = (
    <BottomSheet
      ref={controlsSheetRef}
      index={-1}
      enableDynamicSizing
      enablePanDownToClose
      animateOnMount={false}
      backdropComponent={renderSheetBackdrop}
      containerStyle={{ zIndex: 100 }}
      backgroundStyle={{ backgroundColor: colors.call.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.call.sheetHandle, width: 40 }}
      onClose={handleControlsSheetDismiss}
    >
      <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <View className="flex-row items-center justify-between px-5">
          <View className="h-11 w-11" />
          <AppText
            className="font-heading text-[22px] font-bold"
            style={{ color: colors.call.textPrimary }}
          >
            Call controls
          </AppText>
          <AppPressable
            className="h-11 w-11 items-center justify-center rounded-full"
            onPress={() => controlsSheetRef.current?.close()}
            accessibilityRole="button"
            accessibilityLabel="Close call controls"
          >
            <MaterialIcons name="close" size={25} color={colors.call.textPrimary} />
          </AppPressable>
        </View>

        <View className="mt-3 h-px" style={{ backgroundColor: colors.call.controlBorder }} />
        <View className="px-5">
          <AppPressable
            className="mt-3 min-h-14 flex-row items-center rounded-[18px] px-3"
            activeOpacity={0.68}
            onPress={() => {
              switchToVoiceAfterSheetDismissRef.current = true
              controlsSheetRef.current?.close()
            }}
            accessibilityRole="button"
            accessibilityLabel="Switch to voice call"
          >
            <View
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.call.control }}
            >
              <MaterialIcons name="call" size={24} color={colors.call.textPrimary} />
            </View>
            <View className="ml-3 min-w-0 flex-1">
              <AppText
                className="text-[16px] font-semibold"
                style={{ color: colors.call.textPrimary }}
              >
                Switch to voice call
              </AppText>
              <AppText className="mt-0.5 text-sm" style={{ color: colors.call.textSecondary }}>
                Turn off video for this call
              </AppText>
            </View>
          </AppPressable>

          <AppPressable
            className="mb-3 min-h-14 flex-row items-center rounded-[18px] px-3 py-2"
            activeOpacity={0.68}
            onPress={toggleSpeaker}
            accessibilityRole="switch"
            accessibilityLabel="Speaker"
            accessibilityState={{ checked: speakerEnabled }}
          >
            <View
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.call.control }}
            >
              <MaterialIcons
                name={speakerEnabled ? 'volume-up' : 'volume-off'}
                size={24}
                color={colors.call.textPrimary}
              />
            </View>
            <View className="ml-3 min-w-0 flex-1">
              <AppText
                className="text-[16px] font-semibold"
                style={{ color: colors.call.textPrimary }}
              >
                Speaker
              </AppText>
              <AppText className="mt-0.5 text-sm" style={{ color: colors.call.textSecondary }}>
                {speakerEnabled ? 'On' : 'Off'}
              </AppText>
            </View>
            <MaterialIcons
              name={speakerEnabled ? 'toggle-on' : 'toggle-off'}
              size={42}
              color={speakerEnabled ? colors.bubble.outgoing : colors.call.textMuted}
            />
          </AppPressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  )

  if (shouldRenderVideoTiles) {
    return (
      <Animated.View
        key="video-grid-layout"
        entering={CALL_LAYOUT_ENTERING}
        exiting={CALL_LAYOUT_EXITING}
        className="flex-1"
        style={{ backgroundColor: colors.call.background }}
      >
        <StatusBar style="light" />
        <SafeAreaView
          className="flex-1 px-1 pb-1"
          edges={['right', 'bottom', 'left']}
          pointerEvents="none"
          style={{ paddingTop: callTopInset }}
        >
          <VideoParticipantGrid isLandscape={isLandscape}>
            <View
              key="remote-participant"
              className="relative flex-1 rounded-[18px]"
              style={{ backgroundColor: colors.call.cameraOffSurface }}
            >
              {hasRemoteVideo ? (
                <RTCView
                  key="remote-video"
                  pointerEvents="none"
                  streamURL={remoteStreamUrl ?? ''}
                  objectFit="cover"
                  mirror={false}
                  zOrder={0}
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                  }}
                />
              ) : (
                <CameraOffSurface
                  key="remote-camera-off"
                  avatarUrl={peerAvatarUrl}
                  name={peerName}
                  status={cameraOffStatus}
                />
              )}

              <View
                pointerEvents="none"
                className="absolute inset-0 rounded-[18px] border"
                style={{ borderColor: colors.call.controlBorder }}
              />
            </View>

            <View
              key="local-participant"
              className="relative flex-1 rounded-[18px]"
              style={{ backgroundColor: colors.call.cameraOffSurface }}
            >
              {hasLocalVideo ? (
                <RTCView
                  key="local-video"
                  pointerEvents="none"
                  streamURL={localStreamUrl ?? ''}
                  objectFit="cover"
                  mirror
                  zOrder={0}
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                  }}
                />
              ) : (
                <CameraOffSurface key="local-camera-off" avatarUrl={null} name={null} local />
              )}

              <View
                pointerEvents="none"
                className="absolute inset-0 rounded-[18px] border"
                style={{ borderColor: colors.call.controlBorder }}
              />
            </View>
          </VideoParticipantGrid>
        </SafeAreaView>

        <AppPressable
          accessible={false}
          activeOpacity={1}
          android_ripple={null}
          pointerEvents={isSheetOpen ? 'none' : 'auto'}
          onPress={toggleCallChrome}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 10,
          }}
        />

        <Animated.View
          pointerEvents={chromeVisible && !isSheetOpen ? 'box-none' : 'none'}
          style={[
            {
              position: 'absolute',
              top: callTopInset + 10,
              right: 14,
              left: 14,
              zIndex: 20,
            },
            topChromeStyle,
          ]}
        >
          <View className="flex-row items-center justify-between" pointerEvents="box-none">
            {minimizeButton}
            {participantsButton}
          </View>
        </Animated.View>

        <Animated.View
          pointerEvents={chromeVisible && !isSheetOpen ? 'auto' : 'none'}
          style={[
            {
              position: 'absolute',
              right: 16,
              bottom: Math.max(insets.bottom, 4) + 12,
              left: 16,
              zIndex: 20,
            },
            bottomChromeStyle,
          ]}
        >
          {activeControls}
        </Animated.View>
        {participantsSheet}
        {controlsSheet}
      </Animated.View>
    )
  }

  return (
    <Animated.View
      key="identity-layout"
      entering={CALL_LAYOUT_ENTERING}
      exiting={CALL_LAYOUT_EXITING}
      className="flex-1"
      style={{ backgroundColor: colors.call.background }}
    >
      <StatusBar style="light" />
      {peerAvatarUrl ? (
        <Image
          source={{ uri: peerAvatarUrl }}
          resizeMode="cover"
          blurRadius={48}
          className="absolute inset-0 h-full w-full"
          style={{ opacity: 0.36, transform: [{ scale: 1.28 }] }}
        />
      ) : null}
      <View className="absolute inset-0" style={{ backgroundColor: colors.call.voiceOverlay }} />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(8,10,15,0.88)', 'rgba(8,10,15,0.10)', 'rgba(8,10,15,0)']}
        locations={[0, 0.35, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 220 }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(8,10,15,0)', 'rgba(8,10,15,0.42)', 'rgba(8,10,15,0.98)']}
        locations={[0, 0.46, 1]}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 260 }}
      />

      <AppPressable
        accessible={false}
        activeOpacity={1}
        android_ripple={null}
        pointerEvents={isSheetOpen ? 'none' : 'auto'}
        onPress={toggleCallChrome}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 10,
        }}
      />

      <SafeAreaView
        className="flex-1 px-4 pb-3"
        edges={['right', 'bottom', 'left']}
        style={{ paddingTop: callTopInset, zIndex: 20 }}
        pointerEvents="box-none"
      >
        <Animated.View
          pointerEvents={chromeVisible && !isSheetOpen ? 'box-none' : 'none'}
          className="pt-2"
          style={topChromeStyle}
        >
          <View className="flex-row items-center justify-between" pointerEvents="box-none">
            {minimizeButton}
            {participantsButton}
          </View>
        </Animated.View>

        <View
          pointerEvents="none"
          className="flex-1 items-center"
          style={{ paddingTop: isLandscape ? 0 : 28 }}
        >
          <PeerAvatar avatarUrl={peerAvatarUrl} name={peerName} size={isLandscape ? 84 : 110} />
          <AppText
            className="mt-6 max-w-[86%] text-center font-heading text-[30px] font-bold tracking-[-0.5px]"
            style={{ color: colors.call.textPrimary, fontSize: isLandscape ? 24 : 30 }}
            numberOfLines={2}
          >
            {peerName || 'Unknown'}
          </AppText>
          <AppText
            className="mt-2 text-center text-[20px] font-medium"
            style={{ color: colors.call.textSecondary }}
          >
            {statusLabel}
          </AppText>
          {isGroupCall && phase === 'active' ? (
            <AppText className="mt-2 text-center text-sm" style={{ color: colors.call.textMuted }}>
              {groupPeopleIds.length} {groupPeopleIds.length === 1 ? 'person' : 'people'} in call
            </AppText>
          ) : null}
          {phase === 'reconnecting' && reconnectSecondsLeft !== null ? (
            <AppText className="mt-2 text-sm" style={{ color: colors.call.textMuted }}>
              {reconnectSecondsLeft}s remaining
            </AppText>
          ) : null}
        </View>

        <Animated.View
          pointerEvents={chromeVisible && !isSheetOpen ? 'auto' : 'none'}
          className="pb-1"
          style={bottomChromeStyle}
        >
          {activeControls}
          {isGroupCall ? (
            <AppText
              className="mt-2 text-center text-sm"
              style={{ color: colors.call.textSecondary }}
            >
              Leave call
            </AppText>
          ) : null}
        </Animated.View>
      </SafeAreaView>
      {participantsSheet}
      {controlsSheet}
    </Animated.View>
  )
}
