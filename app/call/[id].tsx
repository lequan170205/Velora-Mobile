import { MaterialIcons } from '@expo/vector-icons'
import { useKeepAwake } from 'expo-keep-awake'
import { useLocalSearchParams, useRouter } from 'expo-router'
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

const ControlButton = ({
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
  <TouchableOpacity
    className={`h-14 w-14 items-center justify-center rounded-full ${active ? 'bg-brand' : 'bg-surface-card'} ${disabled ? 'opacity-45' : ''}`}
    activeOpacity={disabled ? 1 : 0.72}
    disabled={disabled}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled, selected: active }}
  >
    <MaterialIcons name={icon} size={25} color={active ? '#FFFFFF' : '#1C1C1E'} />
  </TouchableOpacity>
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
      return callType === 'VIDEO' ? 'Incoming video call' : 'Incoming call'
    if (phase === 'outgoing_ringing') return 'Calling...'
    if (phase === 'connecting') return 'Connecting...'
    if (phase === 'reconnecting') return 'Reconnecting...'
    if (phase === 'ending') return 'Ending...'
    if (phase === 'active' && remoteAudioState === 'waiting')
      return "Waiting for the other person's audio"
    if (phase === 'active') return formatDuration(durationSec)
    return ''
  }, [callType, durationSec, phase, remoteAudioState])

  const reconnectSecondsLeft =
    reconnectDeadlineMs && phase === 'reconnecting'
      ? Math.max(0, Math.ceil((reconnectDeadlineMs - nowMs) / 1000))
      : null

  const isVideo = callType === 'VIDEO'
  const controlsDisabled = phase !== 'active'
  const hasRemoteVideo = isVideo && remoteVideoState === 'connected' && Boolean(remoteStreamUrl)
  const showOutgoingPreviewAsMain =
    isVideo && phase === 'outgoing_ringing' && cameraEnabled && Boolean(localStreamUrl)

  const avatarFallback = (
    <View className="items-center justify-center">
      {peerAvatarUrl ? (
        <Image
          source={{ uri: peerAvatarUrl }}
          style={{ width: 144, height: 144, borderRadius: 72 }}
        />
      ) : (
        <View className="h-36 w-36 items-center justify-center rounded-full bg-surface-card">
          <Text className="text-[58px] font-bold text-text-primary">
            {(peerName || 'U').charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <Text
        className="mt-5 px-8 text-center text-[25px] font-bold text-text-primary"
        numberOfLines={1}
      >
        {peerName || 'Unknown'}
      </Text>
      <Text className="mt-2 text-center text-base font-medium text-text-secondary">
        {isVideo && remoteVideoState === 'off' && phase === 'active' ? 'Camera off' : statusLabel}
      </Text>
    </View>
  )

  return (
    <View className={`flex-1 ${isVideo ? 'bg-black' : 'bg-bg-primary'}`}>
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
          ) : (
            <View className="flex-1 items-center justify-center bg-bg-primary">
              {avatarFallback}
            </View>
          )}
          {isVideo && localStreamUrl && cameraEnabled && !showOutgoingPreviewAsMain ? (
            <View
              className="absolute right-4 top-24 h-44 w-28 overflow-hidden rounded-[22px] border border-white/30 bg-black"
              style={{ elevation: 12 }}
            >
              <RTCView streamURL={localStreamUrl} objectFit="cover" mirror style={{ flex: 1 }} />
            </View>
          ) : null}
        </View>
      ) : null}

      <SafeAreaView className="flex-1 justify-between" edges={['top', 'bottom']}>
        <View className="z-20 flex-row items-center justify-between px-4 pt-4">
          <TouchableOpacity
            className={`h-12 w-12 items-center justify-center rounded-full ${isVideo ? 'bg-black/35' : ''}`}
            onPress={() => router.back()}
          >
            <MaterialIcons
              name="keyboard-arrow-down"
              size={32}
              color={isVideo ? '#FFFFFF' : '#1C1C1E'}
            />
          </TouchableOpacity>
          <View
            className={`flex-row items-center rounded-full px-3 py-1.5 ${isVideo ? 'bg-black/35' : ''}`}
          >
            <MaterialIcons name="lock" size={14} color={isVideo ? '#FFFFFF' : '#AEAEB2'} />
            <Text
              className={`ml-1 text-xs2 font-medium ${isVideo ? 'text-white' : 'text-text-secondary'}`}
            >
              Encrypted call
            </Text>
          </View>
          <View className="w-12" />
        </View>

        {!isVideo ? (
          <View className="z-10 flex-1 items-center justify-center px-6">{avatarFallback}</View>
        ) : !hasRemoteVideo && !showOutgoingPreviewAsMain ? (
          <View className="z-10 flex-1" />
        ) : (
          <View className="z-10 flex-1 items-center justify-end pb-3" pointerEvents="none">
            <View className="rounded-full bg-black/45 px-4 py-2">
              <Text className="text-sm font-medium text-white">{statusLabel}</Text>
            </View>
            {phase === 'reconnecting' ? (
              <Text className="mt-2 text-xs2 text-white/85">
                {reconnectSecondsLeft !== null
                  ? `${reconnectSecondsLeft}s to restore`
                  : 'Restoring call...'}
              </Text>
            ) : null}
          </View>
        )}

        <View className={`z-20 w-full pb-8 pt-5 ${isVideo ? 'bg-black/20' : ''}`}>
          {phase === 'incoming_ringing' ? (
            <View className="flex-row items-center justify-center gap-12 px-6">
              <TouchableOpacity
                className="h-20 w-20 items-center justify-center rounded-full bg-status-error"
                onPress={() => void rejectIncomingCall()}
                accessibilityRole="button"
                accessibilityLabel="Decline call"
              >
                <MaterialIcons name="call-end" size={36} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity
                className="h-20 w-20 items-center justify-center rounded-full bg-call-green"
                onPress={() => void acceptIncomingCall()}
                accessibilityRole="button"
                accessibilityLabel="Answer call"
              >
                <MaterialIcons name={isVideo ? 'videocam' : 'call'} size={36} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View className="flex-row flex-wrap items-center justify-center gap-4 px-6">
                <ControlButton
                  icon={muted ? 'mic-off' : 'mic'}
                  active={muted}
                  disabled={phase === 'reconnecting'}
                  label={muted ? 'Unmute microphone' : 'Mute microphone'}
                  onPress={toggleMute}
                />

                {isVideo ? (
                  <>
                    <ControlButton
                      icon={cameraEnabled ? 'videocam' : 'videocam-off'}
                      active={!cameraEnabled}
                      disabled={controlsDisabled}
                      label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                      onPress={() => void toggleCamera()}
                    />
                    <ControlButton
                      icon="flip-camera-ios"
                      disabled={controlsDisabled || !cameraEnabled}
                      label="Switch camera"
                      onPress={() => void switchCamera()}
                    />
                  </>
                ) : (
                  <ControlButton
                    icon="videocam"
                    disabled={controlsDisabled}
                    label="Switch to video call"
                    onPress={() => void switchCallType('VIDEO')}
                  />
                )}

                <ControlButton
                  icon="volume-up"
                  active={speakerEnabled}
                  disabled={controlsDisabled}
                  label={speakerEnabled ? 'Turn speaker off' : 'Turn speaker on'}
                  onPress={toggleSpeaker}
                />

                {isVideo ? (
                  <ControlButton
                    icon="call"
                    disabled={controlsDisabled}
                    label="Switch to voice call"
                    onPress={() => void switchCallType('VOICE')}
                  />
                ) : null}
              </View>

              <View className="mt-7 items-center">
                <TouchableOpacity
                  className="h-20 w-20 items-center justify-center rounded-full bg-status-error"
                  onPress={() => void endCall()}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="End call"
                >
                  <MaterialIcons name="call-end" size={36} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  )
}
