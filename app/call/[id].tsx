import { MaterialIcons } from '@expo/vector-icons'
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { useKeepAwake } from 'expo-keep-awake'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Image, Platform, useWindowDimensions, View } from 'react-native'
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { RTCView } from 'react-native-webrtc'

import { AppPressable } from '../../src/components/base/AppPressable'
import { AppText } from '../../src/components/base/AppText'
import { colors } from '../../src/constants/theme'
import { useCall } from '../../src/providers/CallProvider'
import { useAuthStore } from '../../src/stores/authStore'
import { useCallStore } from '../../src/stores/callStore'

const formatDuration = (secs: number) => {
  const minutes = Math.floor(secs / 60)
  const seconds = secs % 60
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

type IconName = ComponentProps<typeof MaterialIcons>['name']

function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  selected = false,
  expanded,
  destructive = false,
  size = 48,
}: {
  icon: IconName
  label: string
  onPress: () => void
  disabled?: boolean
  selected?: boolean
  expanded?: boolean
  destructive?: boolean
  size?: number
}) {
  return (
    <AppPressable
      activeOpacity={disabled ? 1 : 0.68}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected, expanded }}
      className="items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        opacity: disabled ? 0.34 : 1,
        backgroundColor: destructive
          ? colors.call.endCall
          : selected
            ? colors.bubble.outgoing
            : colors.call.control,
      }}
    >
      <MaterialIcons
        name={icon}
        size={destructive ? 27 : 25}
        color={selected && !destructive ? colors.bubble.outgoingText : colors.call.textPrimary}
      />
    </AppPressable>
  )
}

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

function PeerAvatar({
  avatarUrl,
  name,
  size,
}: {
  avatarUrl: string | null
  name: string | null
  size: number
}) {
  const initial = (name || 'U').trim().charAt(0).toUpperCase() || 'U'

  return (
    <View
      className="items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: colors.call.avatarFallback,
        borderColor: colors.call.avatarBorder,
        borderWidth: 1,
      }}
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} resizeMode="cover" className="h-full w-full" />
      ) : (
        <AppText
          className="font-heading font-semibold"
          style={{ color: colors.call.textSecondary, fontSize: size * 0.38 }}
        >
          {initial}
        </AppText>
      )}
    </View>
  )
}

function CameraOffSurface({
  avatarUrl,
  name,
  status,
  local = false,
}: {
  avatarUrl: string | null
  name: string | null
  status?: string
  local?: boolean
}) {
  return (
    <View
      className="flex-1 items-center justify-center overflow-hidden rounded-[18px]"
      style={{ backgroundColor: colors.call.cameraOffSurface }}
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          resizeMode="cover"
          blurRadius={42}
          className="absolute inset-0 h-full w-full"
          style={{ opacity: 0.34, transform: [{ scale: 1.25 }] }}
        />
      ) : null}
      <View className="absolute inset-0 bg-black/25" />

      {local ? (
        <View
          className="h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.call.localAvatar }}
        >
          <MaterialIcons name="person" size={42} color={colors.call.localAvatarIcon} />
        </View>
      ) : (
        <PeerAvatar avatarUrl={avatarUrl} name={name} size={52} />
      )}

      {status ? (
        <AppText
          className="mt-4 max-w-[82%] text-center text-[16px] font-medium"
          style={{ color: colors.call.textPrimary }}
          numberOfLines={2}
        >
          {status}
        </AppText>
      ) : null}
    </View>
  )
}

export default function ActiveCallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { endCall, switchCallType, switchCamera, toggleCamera, toggleMute, toggleSpeaker } =
    useCall()
  const {
    callId,
    callType,
    cameraEnabled,
    durationSec,
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
  const [controlsVisible, setControlsVisible] = useState(false)
  const participantsSheetRef = useRef<BottomSheet>(null)
  const controlsSheetRef = useRef<BottomSheet>(null)
  const switchToVoiceAfterSheetDismissRef = useRef(false)
  const currentUser = useAuthStore((state) => state.user)
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
    setParticipantsVisible(true)
    participantsSheetRef.current?.snapToIndex(0)
  }, [])

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

  const statusLabel = useMemo(() => {
    if (phase === 'outgoing_ringing') return 'Calling…'
    if (phase === 'connecting') return 'Connecting…'
    if (phase === 'reconnecting') return 'Reconnecting…'
    if (phase === 'ending') return 'Ending…'
    if (phase === 'active' && remoteAudioState === 'waiting') return 'Waiting for audio…'
    if (phase === 'active') return formatDuration(durationSec)
    return ''
  }, [durationSec, phase, remoteAudioState])

  const reconnectSecondsLeft =
    reconnectDeadlineMs && phase === 'reconnecting'
      ? Math.max(0, Math.ceil((reconnectDeadlineMs - nowMs) / 1000))
      : null

  const isVideo = callType === 'VIDEO'
  const isSheetOpen = participantsVisible || controlsVisible
  const controlsDisabled = phase !== 'active'
  const hasRemoteVideo = isVideo && remoteVideoState === 'connected' && Boolean(remoteStreamUrl)
  const hasLocalVideo = isVideo && cameraEnabled && Boolean(localStreamUrl)
  const cameraOffStatus =
    phase === 'active' ? `${peerName ? `${peerName}’s` : 'Their'} camera is off` : statusLabel

  const minimizeButton = (
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
  )

  const participantsButton = (
    <AppPressable
      className="h-12 w-12 items-center justify-center rounded-full"
      style={{ backgroundColor: colors.call.topControl }}
      activeOpacity={0.64}
      onPress={handleOpenParticipants}
      accessibilityRole="button"
      accessibilityLabel="Show participants"
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
      ) : (
        <IconButton
          icon="videocam-off"
          label="Switch to video call"
          disabled={controlsDisabled}
          onPress={() => void switchCallType('VIDEO')}
        />
      )}

      <IconButton
        icon={muted ? 'mic-off' : 'mic'}
        label={muted ? 'Unmute microphone' : 'Mute microphone'}
        selected={!muted}
        disabled={phase === 'reconnecting'}
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
        label="End call"
        destructive
        size={52}
        onPress={() => void endCall()}
      />
    </CallDock>
  )

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
      <BottomSheetView style={{ flex: 1, paddingBottom: Math.max(insets.bottom, 16) }}>
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
        <View className="px-5">
          <AppText
            className="mb-3 mt-6 text-[18px] font-bold"
            style={{ color: colors.call.textPrimary }}
          >
            In this call
          </AppText>

          <View className="flex-row items-center py-3">
            <PeerAvatar
              avatarUrl={currentUser?.picture ?? null}
              name={
                currentUser?.fullName ||
                `${currentUser?.firstName ?? ''} ${currentUser?.lastName ?? ''}`.trim() ||
                'You'
              }
              size={56}
            />
            <View className="ml-4 min-w-0 flex-1">
              <AppText
                className="text-[17px] font-semibold"
                style={{ color: colors.call.textPrimary }}
              >
                You
              </AppText>
              {currentUser?.username ? (
                <AppText className="mt-0.5 text-sm" style={{ color: colors.call.textSecondary }}>
                  @{currentUser.username}
                </AppText>
              ) : null}
            </View>
          </View>

          <View className="flex-row items-center py-3">
            <PeerAvatar avatarUrl={peerAvatarUrl} name={peerName} size={56} />
            <View className="ml-4 min-w-0 flex-1">
              <AppText
                className="text-[17px] font-semibold"
                style={{ color: colors.call.textPrimary }}
                numberOfLines={1}
              >
                {peerName || 'Unknown'}
              </AppText>
            </View>
          </View>
        </View>
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

  if (isVideo) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.call.background }}>
        <StatusBar style="light" />
        <SafeAreaView
          className="flex-1 px-1 pb-1"
          edges={['right', 'bottom', 'left']}
          pointerEvents="none"
          style={{ paddingTop: callTopInset }}
        >
          <View className="flex-1" style={{ flexDirection: isLandscape ? 'row' : 'column' }}>
            <View
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

              <LinearGradient
                pointerEvents="none"
                colors={['rgba(8,10,15,0.88)', 'rgba(8,10,15,0.10)', 'rgba(8,10,15,0)']}
                locations={[0, 0.38, 1]}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 136 }}
              />
              <View
                pointerEvents="none"
                className="absolute inset-0 rounded-[18px] border"
                style={{ borderColor: colors.call.controlBorder }}
              />
            </View>

            <View style={isLandscape ? { width: 3 } : { height: 3 }} />

            <View
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

              <LinearGradient
                pointerEvents="none"
                colors={['rgba(8,10,15,0)', 'rgba(8,10,15,0.42)', 'rgba(8,10,15,0.98)']}
                locations={[0, 0.55, 1]}
                style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 184 }}
              />
              <View
                pointerEvents="none"
                className="absolute inset-0 rounded-[18px] border"
                style={{ borderColor: colors.call.controlBorder }}
              />
            </View>
          </View>
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
      </View>
    )
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.call.background }}>
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
        </Animated.View>
      </SafeAreaView>
      {participantsSheet}
    </View>
  )
}
