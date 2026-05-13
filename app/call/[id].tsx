import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { Image, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { cn } from '../../src/lib/cn'
import { useCallStore } from '../../src/stores/callStore'

export default function ActiveCallScreen() {
  const { type } = useLocalSearchParams<{ type: string }>()
  const router = useRouter()

  const { isActive, duration, callerName, avatarUrl, isVideo, endCall } = useCallStore()

  const [isMuted, setIsMuted] = useState(false)
  const [isVideoEnabled, setIsVideoEnabled] = useState(type?.toLowerCase() === 'video')
  const [isSpeakerOn, setIsSpeakerOn] = useState(type?.toLowerCase() === 'video')

  useEffect(() => {
    if (!isActive) {
      router.canGoBack() ? router.back() : router.replace('/')
    }
  }, [isActive])

  const handleEndCall = () => {
    endCall()
    router.back()
  }

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  return (
    <View className="flex-1 bg-bg-primary">
      <SafeAreaView className="flex-1 justify-between" edges={['top', 'bottom']}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-4 z-10">
          <TouchableOpacity
            className="w-12 h-12 items-center justify-center"
            onPress={() => router.back()}
          >
            <MaterialIcons name="keyboard-arrow-down" size={32} color="#1C1C1E" />
          </TouchableOpacity>
          <View className="flex-row items-center">
            <MaterialIcons name="lock" size={14} color="#AEAEB2" />
            <Text className="text-text-secondary font-medium text-xs2 ml-1">
              End-to-End Encrypted
            </Text>
          </View>
          <View className="w-12" />
        </View>

        {/* Main content */}
        <View className="flex-1 items-center justify-center w-full z-10">
          {isVideo ? (
            // Video call placeholder
            <View className="flex-1 w-full items-center justify-center bg-[#1C1C1E] relative">
              <Text className="text-white/60 font-medium text-base2">Remote Video Stream</Text>
              {/* PiP local video */}
              <View className="absolute bottom-6 right-6 w-[110px] h-40 bg-[#2C2C2E] rounded-xl items-center justify-center">
                <Text className="text-white/50 font-medium text-xs2">Local</Text>
              </View>
            </View>
          ) : (
            // Voice call placeholder
            <View className="flex-1 items-center justify-center w-full">
              <View className="w-40 h-40 items-center justify-center mb-10">
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    // NativeWind limitation: kept as inline — exact borderRadius must match w/h
                    style={{ width: 160, height: 160, borderRadius: 80 }}
                  />
                ) : (
                  <View className="w-40 h-40 rounded-full bg-surface-card items-center justify-center">
                    <Text className="text-text-primary font-bold text-[64px]">
                      {callerName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                className="text-text-primary font-bold text-[25px] text-center px-6 mb-2"
                numberOfLines={1}
                adjustsFontSizeToFit={true}
              >
                {callerName}
              </Text>
              <Text className="text-text-secondary font-medium text-lg">
                {formatDuration(duration)}
              </Text>
            </View>
          )}
        </View>

        {/* Controls */}
        <View className="w-full pb-12 pt-8">
          {/* Control buttons row */}
          <View className="flex-row justify-between px-12 w-full">
            {/* Mute */}
            <TouchableOpacity
              className={cn(
                'w-16 h-16 rounded-full items-center justify-center',
                isMuted ? 'bg-brand' : 'bg-surface-card',
              )}
              onPress={() => setIsMuted(!isMuted)}
              activeOpacity={0.7}
              style={
                isMuted
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
                name={isMuted ? 'mic-off' : 'mic'}
                size={28}
                color={isMuted ? '#FFFFFF' : '#1C1C1E'}
              />
            </TouchableOpacity>

            {/* Video toggle */}
            <TouchableOpacity
              className={cn(
                'w-16 h-16 rounded-full items-center justify-center',
                !isVideoEnabled ? 'bg-brand' : 'bg-surface-card',
              )}
              onPress={() => setIsVideoEnabled(!isVideoEnabled)}
              activeOpacity={0.7}
              style={
                !isVideoEnabled
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
                name={isVideoEnabled ? 'videocam' : 'videocam-off'}
                size={28}
                color={!isVideoEnabled ? '#FFFFFF' : '#1C1C1E'}
              />
            </TouchableOpacity>

            {/* Speaker */}
            <TouchableOpacity
              className={cn(
                'w-16 h-16 rounded-full items-center justify-center',
                isSpeakerOn ? 'bg-brand' : 'bg-surface-card',
              )}
              onPress={() => setIsSpeakerOn(!isSpeakerOn)}
              activeOpacity={0.7}
              style={
                isSpeakerOn
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
                name={isSpeakerOn ? 'volume-up' : 'volume-down'}
                size={28}
                color={isSpeakerOn ? '#FFFFFF' : '#1C1C1E'}
              />
            </TouchableOpacity>
          </View>

          {/* End call button */}
          <View className="items-center w-full mt-10">
            <TouchableOpacity
              className="w-20 h-20 rounded-full bg-status-error items-center justify-center"
              onPress={handleEndCall}
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
