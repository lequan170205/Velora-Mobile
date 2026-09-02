import { MaterialIcons } from '@expo/vector-icons'
import { useKeepAwake } from 'expo-keep-awake'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { type ComponentProps, useEffect, useMemo, useState } from 'react'
import { Image, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { RTCView } from 'react-native-webrtc'

import { useCall } from '../../src/providers/CallProvider'
import { useCallStore } from '../../src/stores/callStore'

const formatDuration = (secs: number) => {
  const minutes = Math.floor(secs / 60)
  const seconds = secs % 60
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

const CallControl = ({
  icon,
  active = false,
  disabled = false,
  label,
  onPress,
}: {
  icon: ComponentProps<typeof MaterialIcons>['name']
  active?: boolean
  disabled?: boolean
  label: string
  onPress: () => void
}) => (
  <View className="w-[72px] items-center">
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.72}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      className="h-[58px] w-[58px] items-center justify-center rounded-full"
      style={{
        backgroundColor: active ? '#F26B38' : 'rgba(255,255,255,0.11)',
        borderWidth: 1,
        borderColor: active ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)',
        opacity: disabled ? 0.38 : 1,
      }}
    >
      <MaterialIcons name={icon} size={25} color="#FFFFFF" />
    </TouchableOpacity>
    <Text
      className="mt-2 text-center text-[11px] font-medium"
      style={{ color: disabled ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.72)' }}
      numberOfLines={1}
    >
      {label}
    </Text>
  </View>
)

const RoundActionButton = ({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: ComponentProps<typeof MaterialIcons>['name']
  label: string
  tone: 'accept' | 'decline'
  onPress: () => void
}) => (
  <View className="items-center">
    <TouchableOpacity
      className="h-[72px] w-[72px] items-center justify-center rounded-full"
      style={{ backgroundColor: tone === 'accept' ? '#32C66B' : '#F04444' }}
      activeOpacity={0.78}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialIcons name={icon} size={32} color="#FFFFFF" />
    </TouchableOpacity>
    <Text className="mt-2.5 text-xs font-medium text-white/75">{label}</Text>
  </View>
)

export default function ActiveCallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const {
    acceptIncomingCall,
    endCall,
    rejectIncomingCall,
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

  useKeepAwake()

  useEffect(() => {
    if (phase !== 'reconnecting' || !reconnectDeadlineMs) return
    setNowMs(Date.now())
    const intervalId = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(intervalId)
  }, [phase, reconnectDeadlineMs])

  const isValidPhase = useMemo(
    () =>
      phase === 'incoming_ringing' ||
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
    if (phase === 'incoming_ringing')
      return callType === 'VIDEO' ? 'Incoming video call' : 'Incoming voice call'
    if (phase === 'outgoing_ringing') return 'Calling…'
    if (phase === 'connecting') return 'Connecting…'
    if (phase === 'reconnecting') return 'Reconnecting…'
    if (phase === 'ending') return 'Ending…'
    if (phase === 'active' && remoteAudioState === 'waiting') return 'Waiting for audio…'
    if (phase === 'active') return formatDuration(durationSec)
    return ''
  }, [callType, durationSec, phase, remoteAudioState])

  const reconnectSecondsLeft =
    reconnectDeadlineMs && phase === 'reconnecting'
      ? Math.max(0, Math.ceil((reconnectDeadlineMs - nowMs) / 1000))
      : null

  const isVideo = callType === 'VIDEO'
  const isIncoming = phase === 'incoming_ringing'
  const controlsDisabled = phase !== 'active'
  const hasRemoteVideo = isVideo && remoteVideoState === 'connected' && Boolean(remoteStreamUrl)
  const showOutgoingPreviewAsMain =
    isVideo && phase === 'outgoing_ringing' && cameraEnabled && Boolean(localStreamUrl)
  const showVideoCanvas =
    hasRemoteVideo ||
    showOutgoingPreviewAsMain ||
    (isVideo && cameraEnabled && Boolean(localStreamUrl))
  const peerInitial = (peerName || 'U').charAt(0).toUpperCase()
  const visibleStatus =
    isVideo && remoteVideoState === 'off' && phase === 'active' ? 'Camera off' : statusLabel

  const identity = (
    <View className="items-center px-8">
      <View
        className="h-[148px] w-[148px] items-center justify-center overflow-hidden rounded-full"
        style={{
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.16)',
          backgroundColor: 'rgba(255,255,255,0.08)',
        }}
      >
        {peerAvatarUrl ? (
          <Image source={{ uri: peerAvatarUrl }} className="h-full w-full" />
        ) : (
          <Text className="text-[56px] font-semibold text-white">{peerInitial}</Text>
        )}
      </View>

      <Text
        className="mt-6 max-w-[300px] text-center text-[30px] font-bold tracking-[-0.6px] text-white"
        numberOfLines={1}
      >
        {peerName || 'Unknown'}
      </Text>
      <View
        className="mt-3 flex-row items-center rounded-full px-3.5 py-2"
        style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
      >
        <View
          className="mr-2 h-2 w-2 rounded-full"
          style={{ backgroundColor: phase === 'active' ? '#32C66B' : '#F2A13B' }}
        />
        <Text className="text-[13px] font-medium text-white/75">{visibleStatus}</Text>
      </View>

      {phase === 'reconnecting' ? (
        <Text className="mt-2 text-xs text-white/50">
          {reconnectSecondsLeft !== null
            ? `${reconnectSecondsLeft}s remaining to restore the call`
            : 'Restoring your call…'}
        </Text>
      ) : null}
    </View>
  )

  return (
    <View className="flex-1" style={{ backgroundColor: '#080A0F' }}>
      <StatusBar style="light" />

      {!isVideo && peerAvatarUrl ? (
        <Image
          source={{ uri: peerAvatarUrl }}
          resizeMode="cover"
          blurRadius={36}
          className="absolute inset-0 h-full w-full"
          style={{ opacity: 0.16, transform: [{ scale: 1.18 }] }}
        />
      ) : null}

      {isVideo ? (
        <View className="absolute inset-0">
          {hasRemoteVideo ? (
            <RTCView
              streamURL={remoteStreamUrl ?? ''}
              objectFit="cover"
              mirror={false}
              style={{ flex: 1 }}
            />
          ) : showOutgoingPreviewAsMain ? (
            <RTCView
              streamURL={localStreamUrl ?? ''}
              objectFit="cover"
              mirror
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
      ) : null}

      <LinearGradient
        pointerEvents="none"
        colors={['rgba(8,10,15,0.88)', 'rgba(8,10,15,0.10)', 'rgba(8,10,15,0)']}
        locations={[0, 0.2, 0.46]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '48%' }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(8,10,15,0)', 'rgba(8,10,15,0.42)', 'rgba(8,10,15,0.98)']}
        locations={[0, 0.42, 1]}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '52%' }}
      />

      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <View className="z-20 flex-row items-center justify-between px-4 pt-2">
          <TouchableOpacity
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{
              backgroundColor: 'rgba(12,14,19,0.48)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
            }}
            activeOpacity={0.72}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Minimize call"
          >
            <MaterialIcons name="keyboard-arrow-down" size={29} color="#FFFFFF" />
          </TouchableOpacity>

          <View className="items-center">
            <Text className="text-[13px] font-semibold tracking-[0.2px] text-white/90">
              {isVideo ? 'Video call' : 'Voice call'}
            </Text>
            <View className="mt-1 flex-row items-center">
              <MaterialIcons name="lock" size={11} color="rgba(255,255,255,0.46)" />
              <Text className="ml-1 text-[10px] font-medium text-white/45">Encrypted</Text>
            </View>
          </View>

          <View className="h-11 w-11" />
        </View>

        <View className="relative flex-1">
          {!showVideoCanvas ? (
            <View key="identity" className="flex-1 items-center justify-center pb-16">
              {identity}
            </View>
          ) : (
            <View key="video-canvas" className="flex-1">
              <View className="mt-6 items-center" pointerEvents="none">
                <View
                  className="max-w-[82%] items-center rounded-[20px] px-4 py-2.5"
                  style={{ backgroundColor: 'rgba(8,10,15,0.38)' }}
                >
                  <Text className="text-[16px] font-semibold text-white" numberOfLines={1}>
                    {peerName || 'Unknown'}
                  </Text>
                  <Text className="mt-0.5 text-xs font-medium text-white/65">{visibleStatus}</Text>
                </View>
              </View>

              {localStreamUrl && cameraEnabled && !showOutgoingPreviewAsMain ? (
                <View
                  className="absolute right-4 top-24 h-[176px] w-[118px] overflow-hidden rounded-[24px]"
                  style={{
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.28)',
                    backgroundColor: '#111318',
                    shadowColor: '#000000',
                    shadowOpacity: 0.35,
                    shadowRadius: 16,
                    shadowOffset: { width: 0, height: 8 },
                    elevation: 12,
                  }}
                >
                  <RTCView
                    streamURL={localStreamUrl}
                    objectFit="cover"
                    mirror
                    style={{ flex: 1 }}
                  />
                </View>
              ) : null}
            </View>
          )}
        </View>

        <View className="z-20 px-3 pb-2">
          <View
            className="rounded-[30px] px-4 pb-5 pt-4"
            style={{
              backgroundColor: 'rgba(20,22,28,0.94)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
              shadowColor: '#000000',
              shadowOpacity: 0.3,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
              elevation: 18,
            }}
          >
            {isIncoming ? (
              <>
                <Text className="mb-5 text-center text-sm font-medium text-white/55">
                  {isVideo ? 'Incoming video call' : 'Incoming voice call'}
                </Text>
                <View className="flex-row items-center justify-center gap-16">
                  <RoundActionButton
                    icon="call-end"
                    label="Decline"
                    tone="decline"
                    onPress={() => void rejectIncomingCall()}
                  />
                  <RoundActionButton
                    icon={isVideo ? 'videocam' : 'call'}
                    label="Answer"
                    tone="accept"
                    onPress={() => void acceptIncomingCall()}
                  />
                </View>
              </>
            ) : (
              <>
                <View className="flex-row items-start justify-around">
                  <CallControl
                    icon={muted ? 'mic-off' : 'mic'}
                    active={muted}
                    disabled={phase === 'reconnecting'}
                    label={muted ? 'Unmute' : 'Mute'}
                    onPress={toggleMute}
                  />

                  {isVideo ? (
                    <CallControl
                      icon={cameraEnabled ? 'videocam' : 'videocam-off'}
                      active={!cameraEnabled}
                      disabled={controlsDisabled}
                      label={cameraEnabled ? 'Camera' : 'Camera off'}
                      onPress={() => void toggleCamera()}
                    />
                  ) : (
                    <CallControl
                      icon="videocam"
                      disabled={controlsDisabled}
                      label="Video"
                      onPress={() => void switchCallType('VIDEO')}
                    />
                  )}

                  <CallControl
                    icon="volume-up"
                    active={speakerEnabled}
                    disabled={controlsDisabled}
                    label="Speaker"
                    onPress={toggleSpeaker}
                  />

                  {isVideo ? (
                    <CallControl
                      icon="flip-camera-ios"
                      disabled={controlsDisabled || !cameraEnabled}
                      label="Flip"
                      onPress={() => void switchCamera()}
                    />
                  ) : (
                    <CallControl icon="call" disabled label="Voice" onPress={() => undefined} />
                  )}
                </View>

                {isVideo ? (
                  <View className="mt-3 items-center">
                    <TouchableOpacity
                      activeOpacity={0.72}
                      disabled={controlsDisabled}
                      onPress={() => void switchCallType('VOICE')}
                      className="flex-row items-center rounded-full px-4 py-2.5"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.07)',
                        opacity: controlsDisabled ? 0.42 : 1,
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Switch to voice call"
                    >
                      <MaterialIcons name="call" size={16} color="rgba(255,255,255,0.78)" />
                      <Text className="ml-2 text-xs font-semibold text-white/75">
                        Switch to voice
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                <View className="mt-5 items-center">
                  <TouchableOpacity
                    className="h-[68px] w-[68px] items-center justify-center rounded-full"
                    style={{
                      backgroundColor: '#F04444',
                      shadowColor: '#F04444',
                      shadowOpacity: 0.24,
                      shadowRadius: 14,
                      shadowOffset: { width: 0, height: 6 },
                    }}
                    onPress={() => void endCall()}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel="End call"
                  >
                    <MaterialIcons name="call-end" size={31} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  )
}
