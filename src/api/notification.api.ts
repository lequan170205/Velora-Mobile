import axios from 'axios'
import { Platform } from 'react-native'

const getNotificationApiBaseUrl = () => {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL

  if (!baseUrl) {
    throw new Error('Missing EXPO_PUBLIC_API_URL')
  }

  return baseUrl.replace(/\/$/, '')
}

const notificationClient = axios.create({
  timeout: 10000,
  withCredentials: true,
})

export type RegisterPushTokenInput = {
  token: string
  deviceId?: string
  appVersion?: string
}

export async function registerPushToken(input: RegisterPushTokenInput) {
  return notificationClient.post(`${getNotificationApiBaseUrl()}/notifications/push-tokens`, {
    provider: 'fcm',
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    token: input.token,
    deviceId: input.deviceId,
    appVersion: input.appVersion,
  })
}

export async function deactivatePushToken(token: string) {
  return notificationClient.post(
    `${getNotificationApiBaseUrl()}/notifications/push-tokens/deactivate`,
    {
      provider: 'fcm',
      token,
    },
  )
}
