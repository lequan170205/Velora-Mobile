import { MaterialIcons } from '@expo/vector-icons'
import { useKeepAwake } from 'expo-keep-awake'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo } from 'react'
import { Image, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useCall } from '../../src/providers/CallProvider'
import { useCallStore } from '../../src/stores/callStore'

const formatDuration = (secs: number) => {
  const minutes = Math.floor(secs / 60)
  const seconds = secs % 60
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

export default function ActiveCallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { endCall, toggleMute } = useCall()
  const { callId, durationSec, muted, peerAvatarUrl, peerName, phase, remoteAudioState } =
    useCallStore()

  useKeepAwake()

  const isValidPhase = useMemo(
    () =>
      phase === 'outgoing_ringing' ||
      phase === 'connecting' ||
      phase === 'active' ||
      phase === 'ending',
    [phase],
  )

  useEffect(() => {
    if (!id || callId !== id || !isValidPhase) {
      if (router.canGoBack()) {
        router.back()
        return
      }

      router.replace('/')
    }
  }, [callId, id, isValidPhase, router])

  const statusLabel = useMemo(() => {
    if (phase === 'outgoing_ringing') {
      return 'Calling...'
    }

    if (phase === 'connecting') {
      return 'Connecting...'
    }

    if (phase === 'ending') {
      return 'Ending...'
    }

    if (phase === 'active' && remoteAudioState === 'waiting') {
      return "Waiting for the other person's audio"
    }

    if (phase === 'active') {
      return formatDuration(durationSec)
    }

    return ''
  }, [durationSec, phase, remoteAudioState])

  return (
    <View className="flex-1 bg-bg-primary">
      <SafeAreaView className="flex-1 justify-between" edges={['top', 'bottom']}>
        <View className="z-10 flex-row items-center justify-between px-4 pt-4">
          <TouchableOpacity
            className="h-12 w-12 items-center justify-center"
            onPress={() => router.back()}
          >
            <MaterialIcons name="keyboard-arrow-down" size={32} color="#1C1C1E" />
          </TouchableOpacity>
          <View className="flex-row items-center">
            <MaterialIcons name="lock" size={14} color="#AEAEB2" />
            <Text className="ml-1 text-xs2 font-medium text-text-secondary">
              End-to-End Encrypted
            </Text>
          </View>
          <View className="w-12" />
        </View>

        <View className="z-10 flex-1 items-center justify-center px-6">
          <View className="mb-10 h-40 w-40 items-center justify-center">
            {peerAvatarUrl ? (
              <Image
                source={{ uri: peerAvatarUrl }}
                style={{ width: 160, height: 160, borderRadius: 80 }}
              />
            ) : (
              <View className="h-40 w-40 items-center justify-center rounded-full bg-surface-card">
                <Text className="text-[64px] font-bold text-text-primary">
                  {(peerName || 'U').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          <Text
            className="mb-2 px-6 text-center text-[25px] font-bold text-text-primary"
            numberOfLines={1}
            adjustsFontSizeToFit={true}
          >
            {peerName || 'Unknown'}
          </Text>
          <Text className="text-center text-lg font-medium text-text-secondary">{statusLabel}</Text>
        </View>

        <View className="w-full pb-12 pt-8">
          <View className="flex-row justify-center gap-10 px-12">
            <TouchableOpacity
              className={`h-16 w-16 items-center justify-center rounded-full ${muted ? 'bg-brand' : 'bg-surface-card'}`}
              onPress={toggleMute}
              activeOpacity={0.7}
              style={
                muted
                  ? {
                      shadowColor: '#FF6B2C',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 8,
                      elevation: 6,
                    }
                  : undefined
              }
            >
              <MaterialIcons
                name={muted ? 'mic-off' : 'mic'}
                size={28}
                color={muted ? '#FFFFFF' : '#1C1C1E'}
              />
            </TouchableOpacity>

            <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-card opacity-50">
              <MaterialIcons name="volume-up" size={28} color="#1C1C1E" />
            </View>
          </View>

          <View className="mt-10 w-full items-center">
            <TouchableOpacity
              className="h-20 w-20 items-center justify-center rounded-full bg-status-error"
              onPress={() => {
                void endCall()
              }}
              activeOpacity={0.8}
              style={{
                shadowColor: '#FF3B30',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              <MaterialIcons name="call-end" size={36} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  )
}
