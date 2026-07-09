import { apiClient } from './client'

import type { CallType } from '../types/call.types'

export type CallStateResponse = {
  callId: string
  conversationId: string
  initiatorId: string
  targetUserId: string
  recipientUserId: string
  callType: CallType
  status: 'initiated' | 'ringing' | 'active' | 'cancelled' | 'ended' | 'rejected'
  initiatorDisplayName: string
  initiatorAvatarUrl?: string
  ringTimeoutMs: number
  expiresAt: string
}

export async function getCallState(callId: string) {
  const response = await apiClient.get<CallStateResponse>(`/calls/${callId}/state`, {
    timeout: 10000,
  })
  return response.data
}
