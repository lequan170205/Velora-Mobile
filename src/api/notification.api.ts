import { Platform } from 'react-native'

import { apiClient } from './client'

export type RegisterPushTokenInput = {
  token: string
  deviceId?: string
  appVersion?: string
  lifecycleVersion?: number
}

export type RegisterVoipPushTokenInput = RegisterPushTokenInput & {
  bundleId: string
  deliveryEnvironment: 'development' | 'production'
}

type DeactivatePushTokenInput = {
  token: string
  deviceId?: string
  lifecycleVersion?: number
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
      lifecycleVersion: input.lifecycleVersion,
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
      lifecycleVersion: input.lifecycleVersion,
      bundleId: input.bundleId,
      deliveryEnvironment: input.deliveryEnvironment,
    },
    {
      timeout: 10000,
    },
  )
}

export async function deactivateVoipPushToken(input: DeactivatePushTokenInput) {
  if (Platform.OS !== 'ios') {
    return null
  }

  return apiClient.post(
    '/notifications/push-tokens/deactivate',
    {
      provider: 'apns_voip',
      token: input.token,
      deviceId: input.deviceId,
      lifecycleVersion: input.lifecycleVersion,
    },
    {
      timeout: 10000,
    },
  )
}

export async function deactivatePushToken(input: DeactivatePushTokenInput) {
  return apiClient.post(
    '/notifications/push-tokens/deactivate',
    {
      provider: 'fcm',
      token: input.token,
      deviceId: input.deviceId,
      lifecycleVersion: input.lifecycleVersion,
    },
    {
      timeout: 10000,
    },
  )
}
