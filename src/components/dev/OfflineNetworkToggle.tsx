import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { Pressable, Text, View } from 'react-native'

import { useNetworkStatus } from '../../providers/NetworkProvider'

const shouldShowOfflineToggle = __DEV__ || process.env.EXPO_PUBLIC_ENABLE_OFFLINE_TOGGLE === 'true'

export function OfflineNetworkToggle() {
  const { isForceOffline, isNetworkResolved, isOnline, networkState, setForceOffline } =
    useNetworkStatus()

  if (!shouldShowOfflineToggle) {
    return null
  }

  const physicalOnline =
    isNetworkResolved &&
    networkState?.isConnected === true &&
    networkState?.isInternetReachable !== false

  const statusLabel = isForceOffline
    ? 'Forced offline mode is active'
    : isOnline
      ? 'App is currently online'
      : physicalOnline
        ? 'App offline'
        : 'Device offline'

  return (
    <Pressable
      className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
      onPress={() => setForceOffline((value) => !value)}
    >
      <View
        className={
          isForceOffline
            ? 'h-12 w-12 items-center justify-center rounded-full bg-[#FFF1EE]'
            : 'h-12 w-12 items-center justify-center rounded-full bg-white'
        }
      >
        <MaterialIcons
          name={isForceOffline ? 'wifi-off' : 'wifi'}
          size={20}
          color={isForceOffline ? '#FF3B30' : '#161616'}
        />
      </View>
      <View className="ml-3 flex-1">
        <Text
          className={
            isForceOffline
              ? 'font-medium text-md text-status-error'
              : 'font-medium text-md text-text-primary'
          }
        >
          {isForceOffline ? 'Simulating Offline' : 'Network Active'}
        </Text>
        <Text className="mt-1 text-sm2 text-text-secondary">{statusLabel}</Text>
      </View>

      <MaterialIcons
        name={isForceOffline ? 'toggle-on' : 'toggle-off'}
        size={36}
        color={isForceOffline ? '#FF3B30' : '#BEBEBE'}
      />
    </Pressable>
  )
}
