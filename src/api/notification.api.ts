import { Platform } from 'react-native'

import { apiClient } from './client'

export type RegisterPushTokenInput = {
  token: string
  deviceId?: string
  appVersion?: string
}

export type RegisterVoipPushTokenInput = RegisterPushTokenInput & {
  bundleId: string
  deliveryEnvironment: 'development' | 'production'
}

export async function registerPushToken(input: RegisterPushTokenInput) {
  return apiClient.post(
    '/notifications/push-tokens',
    {
      provider: 'fcm',
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      token: input.token,
      deviceId: input.deviceId,
      appVersion: input.appVersion,
    },
    {
      timeout: 10000,
    },
  )
}

export async function registerVoipPushToken(input: RegisterVoipPushTokenInput) {
  if (Platform.OS !== 'ios') {
    return null
  }

  return apiClient.post(
    '/notifications/push-tokens',
    {
      provider: 'apns_voip',
      platform: 'ios',
      token: input.token,
      deviceId: input.deviceId,
      appVersion: input.appVersion,
      bundleId: input.bundleId,
      deliveryEnvironment: input.deliveryEnvironment,
    },
    {
      timeout: 10000,
    },
  )
}

export async function deactivateVoipPushToken(token: string) {
  if (Platform.OS !== 'ios') {
    return null
  }

  return apiClient.post(
    '/notifications/push-tokens/deactivate',
    {
      provider: 'apns_voip',
      token,
    },
    {
      timeout: 10000,
    },
  )
}

export async function deactivatePushToken(token: string) {
  return apiClient.post(
    '/notifications/push-tokens/deactivate',
    {
      provider: 'fcm',
      token,
    },
    {
      timeout: 10000,
    },
  )
}
