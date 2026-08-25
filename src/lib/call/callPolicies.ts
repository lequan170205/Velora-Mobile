import { isAxiosError } from 'axios'

import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '../../constants/queryKeys'

import { CALL_SETUP_CANCELLED_ERROR, TRANSPORT_CONNECTED_TIMEOUT_MS } from './callConstants'
import { isCallWaitCancelledError } from './callSocket'

import type { CallTelemetryAudioRoute } from './callTelemetry'
import type { CallStateResponse } from '../../api/call.api'
import type {
  CallEndedPayload,
  CallRejectedPayload,
  CallUiState,
  CameraFacing,
  IncomingCallPayload,
} from '../../types/call.types'
import type { Conversation } from '../../types/conversation.types'
import type {
  AudioSessionConfiguredEvent,
  NativeAudioSessionState,
  NativeCallPayload,
} from '../systemCalls/veloraSystemCalls'
import type * as MediasoupTypes from 'mediasoup-client/types'

export type AudioSessionConfiguration =
  | AudioSessionConfiguredEvent
  | NativeAudioSessionState
  | {
      configured: boolean
      category?: string
      mode?: string
      outputRouteTypes?: string[]
      inputRouteTypes?: string[]
      forcedSpeaker?: boolean
      errorCode?: string
    }

export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

const toAudioRouteType = (value: string): CallTelemetryAudioRoute['outputRouteTypes'][number] => {
  const routeTypes: Record<string, CallTelemetryAudioRoute['outputRouteTypes'][number]> = {
    Receiver: 'receiver',
    Speaker: 'speaker',
    BluetoothHFP: 'bluetooth_hfp',
    BluetoothA2DP: 'bluetooth_a2dp',
    BluetoothLE: 'bluetooth_le',
    Headphones: 'headphones',
    AirPlay: 'airplay',
    CarAudio: 'car_audio',
    USBAudio: 'usb_audio',
    LineOut: 'line_out',
  }

  return routeTypes[value] ?? 'other'
}

export const toAudioRouteTelemetry = (
  configuration: AudioSessionConfiguration | undefined,
): CallTelemetryAudioRoute | null => {
  if (!configuration?.category || !configuration.mode) {
    return null
  }

  return {
    category:
      configuration.category === 'AVAudioSessionCategoryPlayAndRecord' ||
      configuration.category === 'playAndRecord'
        ? 'play_and_record'
        : 'other',
    mode:
      configuration.mode === 'AVAudioSessionModeVoiceChat' || configuration.mode === 'voiceChat'
        ? 'voice_chat'
        : 'other',
    outputRouteTypes: [
      ...new Set((configuration.outputRouteTypes ?? []).map(toAudioRouteType)),
    ].slice(0, 4),
    inputRouteTypes: [
      ...new Set((configuration.inputRouteTypes ?? []).map(toAudioRouteType)),
    ].slice(0, 4),
    forcedSpeaker: configuration.forcedSpeaker === true,
  }
}

export const shouldDefaultVideoToSpeaker = (
  configuration: AudioSessionConfiguration | undefined,
) => {
  const externalRoutePattern = /Bluetooth|Headphones|Headset|AirPlay|CarAudio|USB|LineOut|Wired/i
  return !(configuration?.outputRouteTypes ?? []).some((routeType) =>
    externalRoutePattern.test(routeType),
  )
}

export const isBusyPhase = (phase: CallUiState['phase']) => phase !== 'idle'

export const isCallSetupCancelledError = (error: unknown) =>
  isCallWaitCancelledError(error) ||
  (error instanceof Error && error.message === CALL_SETUP_CANCELLED_ERROR)

const getConversationsFromCache = (value: unknown) => {
  if (Array.isArray(value)) {
    return value as Conversation[]
  }

  return ((value as { pages?: Conversation[][] } | undefined)?.pages?.flat() ??
    []) as Conversation[]
}

export const getPeerInfoFromConversation = ({
  conversationId,
  currentUserId,
  fallbackPeerUserId,
  queryClient,
}: {
  conversationId: string
  currentUserId: string
  fallbackPeerUserId?: string
  queryClient: QueryClient
}) => {
  const conversations = getConversationsFromCache(
    queryClient.getQueryData<unknown>(queryKeys.conversations.all),
  )
  const conversation = conversations.find((entry) => entry.id === conversationId) ?? null
  const peer =
    conversation?.participants?.find((participant) => participant.id !== currentUserId) ?? null

  return {
    conversation,
    peerUserId: peer?.id ?? fallbackPeerUserId ?? null,
    peerName: peer?.name ?? peer?.email ?? null,
    peerAvatarUrl: peer?.picture ?? null,
  }
}

export const getCallEndedMessage = (
  payload: CallEndedPayload,
  state: Pick<CallUiState, 'direction' | 'phase'>,
) => {
  if (payload.reason === 'no_answer') {
    return state.direction === 'outgoing' ? 'No one answered' : null
  }

  if (payload.reason === 'cancelled') return 'The caller canceled the call'
  if (payload.reason === 'disconnected') return 'The call was interrupted'
  if (payload.reason === 'remote_audio_not_ready') {
    return 'The other person could not activate call audio'
  }
  if (payload.reason === 'remote_accept_failed') {
    return 'The other person could not answer the call'
  }
  return null
}

export const getCallRejectedMessage = (payload: CallRejectedPayload) => {
  if (payload.reason === 'busy') return 'The other person is on another call'
  if (payload.reason === 'mic_permission_denied') {
    return 'The other person needs microphone access to answer'
  }
  if (payload.reason === 'camera_permission_denied') {
    return 'The other person needs camera access to answer a video call'
  }
  if (payload.reason === 'unsupported_video') {
    return 'The other person is using a version that does not support video calls'
  }
  return 'The call was rejected'
}

export const isWaitTimeoutError = (error: unknown) =>
  error instanceof Error && error.message.startsWith('Timed out')

export const isRetryableCallStateError = (error: unknown) => {
  if (!isAxiosError(error)) return true
  const status = error.response?.status
  return !status || status === 408 || status === 429 || status >= 500
}

export const getAcceptIncomingCallFailureCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '')

  if (/auth_not_restored/i.test(message)) return 'auth_not_restored'
  if (/socket_connect_timeout/i.test(message)) return 'socket_connect_timeout'
  if (/socket_auth_failed/i.test(message)) return 'socket_auth_failed'
  if (/network_unavailable/i.test(message)) return 'network_unavailable'
  if (/reconnect_exhausted/i.test(message)) return 'reconnect_exhausted'
  if (/audio session|audio_session/i.test(message)) return 'remote_audio_not_ready'
  if (/call not found|\b404\b/i.test(message)) return 'call_not_found'
  if (/already (ended|accepted)|call.*ended/i.test(message)) return 'call_already_ended'
  if (/timed out|timeout/i.test(message)) return 'accept_timeout'
  if (isAxiosError(error)) {
    return error.response?.status && error.response.status >= 400 && error.response.status < 500
      ? 'server_rejected'
      : 'network_error'
  }

  return /network|socket|connect/i.test(message) ? 'network_unavailable' : 'server_rejected'
}

export const getRemoteSetupFailureReason = (errorCode: string) =>
  errorCode === 'remote_audio_not_ready' ? errorCode : 'remote_accept_failed'

export const cameraConstraints = (facing: CameraFacing) => ({
  facingMode: facing,
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
})

export const isConnectedTransportState = (state: string) =>
  state === 'connected' || state === 'completed'

export const waitForTransportConnection = (
  transport: MediasoupTypes.Transport<Record<string, unknown>>,
  timeoutMs = TRANSPORT_CONNECTED_TIMEOUT_MS,
) => {
  if (isConnectedTransportState(transport.connectionState)) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      transport.off('connectionstatechange', onConnectionState)
    }
    const onConnectionState = (state: string) => {
      if (isConnectedTransportState(state)) {
        cleanup()
        resolve()
      } else if (state === 'failed' || state === 'closed') {
        cleanup()
        reject(new Error(`Transport entered ${state} state during ICE restart`))
      }
    }

    timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for transport after ICE restart'))
    }, timeoutMs)
    transport.on('connectionstatechange', onConnectionState)
    onConnectionState(transport.connectionState)
  })
}

export const toNativeIncomingCallPayload = (
  payload: IncomingCallPayload | CallStateResponse,
): NativeCallPayload => {
  const nativePayload: NativeCallPayload = {
    type: 'INCOMING_CALL',
    callId: payload.callId,
    conversationId: payload.conversationId,
    initiatorId: payload.initiatorId,
    targetUserId: payload.targetUserId,
    recipientUserId: payload.recipientUserId,
    callType: payload.callType,
    initiatorDisplayName: payload.initiatorDisplayName,
    ringTimeoutMs: payload.ringTimeoutMs,
    expiresAt: payload.expiresAt,
  }

  if (payload.initiatorAvatarUrl) nativePayload.initiatorAvatarUrl = payload.initiatorAvatarUrl
  return nativePayload
}
