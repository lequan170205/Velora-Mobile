import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { apiClient } from './client'

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export interface DeviceTokenPayload {
  deviceType: 'IOS' | 'ANDROID' | 'WEB'
  token: string
  voipToken?: string
  appVersion?: string
  osVersion?: string
}

export async function registerPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device')
    return null
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') {
    console.log('Failed to get push notification permissions')
    return null
  }

  try {
    // Get native push token (APNs for iOS, FCM for Android)
    const pushToken = await Notifications.getDevicePushTokenAsync()

    const pushTokenString = pushToken.data
    console.log('Native push token obtained:', pushTokenString.substring(0, 20) + '...')

    // Register token with backend
    const deviceType = Platform.OS === 'ios' ? 'IOS' : 'ANDROID'

    await apiClient.post('/notifications/tokens', {
      deviceType,
      token: pushTokenString,
      appVersion: '1.0.0',
      osVersion: Platform.OS === 'ios' ? Platform.Version?.toString() : Platform.Version.toString(),
    })

    console.log('Push token registered with backend')
    return pushTokenString
  } catch (error) {
    console.error('Error registering push token:', error)
    return null
  }
}

export async function unregisterPushToken(token: string): Promise<void> {
  try {
    await apiClient.delete('/notifications/tokens', {
      data: { token },
    })
    console.log('Push token unregistered')
  } catch (error) {
    console.error('Error unregistering push token:', error)
  }
}

export async function unregisterAllTokens(): Promise<void> {
  try {
    await apiClient.delete('/notifications/tokens')
    console.log('All push tokens unregistered')
  } catch (error) {
    console.error('Error unregistering all push tokens:', error)
  }
}
