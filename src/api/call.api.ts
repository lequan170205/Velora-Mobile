import { apiClient } from './client'

import type { CallType } from '../types/call.types'

export type CallStateResponse = {
  callId: string
  invitationId?: string
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

export type CallHistoryPeer = {
  id: string
  fullName: string | null
  username: string | null
  picture: string | null
}

/** One call from the signed-in user's side (GET /calls/history). */
export type CallHistoryItem = {
  callId: string
  conversationId: string
  callType: CallType
  isGroupCall: boolean
  groupName?: string
  groupAvatarUrl?: string
  initiatorId: string
  outcome: 'COMPLETED' | 'MISSED' | 'DECLINED' | 'FAILED'
  terminalReason?: string
  role: 'CALLER' | 'CALLEE'
  result: 'ANSWERED' | 'MISSED' | 'DECLINED' | 'CANCELLED' | 'FAILED'
  startedAt: string
  endedAt: string
  durationSec?: number
  peerUserIds: string[]
  peers: CallHistoryPeer[]
}

export type CallHistoryPage = {
  items: CallHistoryItem[]
  nextCursor: string | null
}

export async function getCallHistory(cursor?: string) {
  const response = await apiClient.get<CallHistoryPage>('/calls/history', {
    params: cursor ? { cursor } : {},
    timeout: 10000,
  })
  return response.data
}

export async function getMissedCallCount() {
  const response = await apiClient.get<{ count: number }>('/calls/history/missed-count', {
    timeout: 10000,
  })
  return response.data.count
}

export async function markMissedCallsSeen() {
  const response = await apiClient.post<{ updated: number }>('/calls/history/seen')
  return response.data.updated
}
