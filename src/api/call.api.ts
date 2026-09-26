import { apiClient } from './client'

import type { CallType } from '../types/call.types'

export type CallStateResponse = {
  callId: string
  conversationId: string
  initiatorId: string
  targetUserId: string
  recipientUserId: string
  callType: CallType
  status: 'initiated' | 'ringing' | 'accepting' | 'active' | 'cancelled' | 'ended' | 'rejected'
  initiatorDisplayName: string
  initiatorAvatarUrl?: string
  isGroupCall?: boolean
  groupName?: string
  groupAvatarUrl?: string
  ringTimeoutMs: number
  expiresAt: string
}

export async function getCallState(callId: string) {
  const response = await apiClient.get<CallStateResponse>(`/calls/${callId}/state`, {
    timeout: 10000,
  })
  return response.data
}

export type ActiveGroupCall = {
  callId: string
  conversationId: string
  participantCount: number
  startedAt: string
  elapsedSeconds: number
  joined: boolean
}

export async function getActiveGroupCall(conversationId: string) {
  const response = await apiClient.get<{ call: ActiveGroupCall | null }>(
    `/calls/conversations/${encodeURIComponent(conversationId)}/active-group`,
    { timeout: 10000 },
  )
  return response.data.call
}
