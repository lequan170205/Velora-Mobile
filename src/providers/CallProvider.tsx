import { useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { Camera } from 'expo-camera'
import { useRouter } from 'expo-router'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { AppState, Platform } from 'react-native'
import { MediaStream, mediaDevices } from 'react-native-webrtc'

import { getCallState, type CallStateResponse } from '../api/call.api'
import { queryKeys } from '../constants/queryKeys'
import {
  authenticateCallSocket,
  clearWaitRegistry,
  createCallSocket,
  emitAndWaitForEvent,
  type CallWaitRegistry,
  waitForEventWhere,
} from '../lib/call/callSocket'
import {
  CallTelemetrySession,
  flushCallTelemetry,
  type CallTelemetryAudioRoute,
} from '../lib/call/callTelemetry'
import {
  createMediasoupDevice,
  ensureMediasoupGlobalsRegistered,
  toRouterRtpCapabilities,
  toTransportOptions,
} from '../lib/call/mediasoup'
import {
  veloraSystemCalls,
  type AudioSessionActivatedEvent,
  type AudioSessionConfiguredEvent,
  type NativeCallAction,
  type NativeAudioSessionState,
  type NativeCallPayload,
} from '../lib/systemCalls/veloraSystemCalls'
import { useAuthStore } from '../stores/authStore'
import { useCallStore } from '../stores/callStore'

import type {
  CallAnsweredPayload,
  CallEndedPayload,
  CallSocketReadyPayload,
  CallJoinedPayload,
  CallRejoinedPayload,
  CallRejectedPayload,
  CallSocket,
  IncomingCallPayload,
  NewProducerPayload,
  PeerReconnectedPayload,
  PeerReconnectingPayload,
  PeerLeftPayload,
  StartVoiceCallInput,
  TransportCreatedPayload,
  IceRestartedPayload,
  UseCallValue,
} from '../types/call.types'
import type { Conversation } from '../types/conversation.types'
import type { Device as MediasoupDevice } from 'mediasoup-client'
import type * as MediasoupTypes from 'mediasoup-client/types'
import type { MediaStreamTrack } from 'react-native-webrtc'

const CALL_JOINED_TIMEOUT_MS = 10_000
const SOCKET_CONNECT_TIMEOUT_MS = 10_000
const SOCKET_DISCONNECT_GRACE_MS = 10_000
const IOS_AUDIO_SESSION_READY_TIMEOUT_MS = 15_000
const IOS_AUDIO_SESSION_SNAPSHOT_POLL_MS = 250
const TRANSPORT_CREATED_TIMEOUT_MS = 10_000
const TRANSPORT_CONNECTED_TIMEOUT_MS = 10_000
const CONSUMER_CREATED_TIMEOUT_MS = 10_000
const CONSUMER_RESUMED_TIMEOUT_MS = 10_000
const DEFAULT_CALL_NO_ANSWER_TIMEOUT_MS = 30_000
const getOutgoingRingWaitTimeoutMs = (noAnswerTimeoutMs?: number) =>
  (noAnswerTimeoutMs && noAnswerTimeoutMs > 0
    ? noAnswerTimeoutMs
    : DEFAULT_CALL_NO_ANSWER_TIMEOUT_MS) + CALL_JOINED_TIMEOUT_MS
const REMOTE_PRODUCER_TIMEOUT_MS = 30_000
const REMOTE_AUDIO_WAIT_FALLBACK_MS = 10_000
const RTC_STATS_LOG_DELAY_MS = 1_500
const RTC_QUALITY_SAMPLE_INTERVAL_MS = 10_000
const AUDIO_FLOW_CONFIRMATION_DELAY_MS = 1_000
const PEER_LEFT_GRACE_MS = 750
const DEFAULT_RECONNECT_GRACE_MS = 15_000
const CALL_SETUP_CANCELLED_ERROR = 'Call setup was cancelled'
const RECONNECT_RECOVERY_TIMEOUT_MS = (() => {
  const configured = Number(process.env.EXPO_PUBLIC_CALL_RECONNECT_GRACE_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RECONNECT_GRACE_MS
})()

const normalizeRtcStatsEntries = (report: RTCStatsReport | unknown) => {
  if (report instanceof Map) {
    return [...report.values()] as Record<string, unknown>[]
  }

  if (Array.isArray(report)) {
    return report as Record<string, unknown>[]
  }

  if (report && typeof report === 'object') {
    return Object.values(report as Record<string, unknown>).filter(
      (value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'),
    )
  }

  return []
}

const pickRtcStat = (entries: Record<string, unknown>[], type: string, kind = 'audio') =>
  entries.find(
    (entry) =>
      entry.type === type &&
      (entry.kind === kind ||
        entry.mediaType === kind ||
        entry.id === kind ||
        typeof entry.id !== 'string'),
  ) ?? null

const summarizeRtcStatsReport = (report: RTCStatsReport | unknown) => {
  const entries = normalizeRtcStatsEntries(report)
  const outboundRtp = pickRtcStat(entries, 'outbound-rtp')
  const inboundRtp = pickRtcStat(entries, 'inbound-rtp')
  const remoteInboundRtp = pickRtcStat(entries, 'remote-inbound-rtp')
  const track = pickRtcStat(entries, 'track')
  const mediaSource = pickRtcStat(entries, 'media-source')
  const candidatePair =
    entries.find(
      (entry) =>
        entry.type === 'candidate-pair' &&
        (entry.selected === true || entry.nominated === true || entry.state === 'succeeded'),
    ) ?? null

  return {
    entryCount: entries.length,
    outboundRtp: outboundRtp && {
      packetsSent: outboundRtp.packetsSent,
      bytesSent: outboundRtp.bytesSent,
      retransmittedPacketsSent: outboundRtp.retransmittedPacketsSent,
      retransmittedBytesSent: outboundRtp.retransmittedBytesSent,
      targetBitrate: outboundRtp.targetBitrate,
      totalPacketSendDelay: outboundRtp.totalPacketSendDelay,
    },
    inboundRtp: inboundRtp && {
      packetsReceived: inboundRtp.packetsReceived,
      bytesReceived: inboundRtp.bytesReceived,
      packetsLost: inboundRtp.packetsLost,
      jitter: inboundRtp.jitter,
      audioLevel: inboundRtp.audioLevel,
      totalAudioEnergy: inboundRtp.totalAudioEnergy,
      totalSamplesDuration: inboundRtp.totalSamplesDuration,
    },
    remoteInboundRtp: remoteInboundRtp && {
      packetsLost: remoteInboundRtp.packetsLost,
      roundTripTime: remoteInboundRtp.roundTripTime,
      jitter: remoteInboundRtp.jitter,
    },
    track: track && {
      audioLevel: track.audioLevel,
      totalAudioEnergy: track.totalAudioEnergy,
      totalSamplesDuration: track.totalSamplesDuration,
      jitterBufferDelay: track.jitterBufferDelay,
      jitterBufferEmittedCount: track.jitterBufferEmittedCount,
      concealedSamples: track.concealedSamples,
      silentConcealedSamples: track.silentConcealedSamples,
    },
    mediaSource: mediaSource && {
      audioLevel: mediaSource.audioLevel,
      totalAudioEnergy: mediaSource.totalAudioEnergy,
      totalSamplesDuration: mediaSource.totalSamplesDuration,
    },
    candidatePair: candidatePair && {
      state: candidatePair.state,
      nominated: candidatePair.nominated,
      selected: candidatePair.selected,
      bytesSent: candidatePair.bytesSent,
      bytesReceived: candidatePair.bytesReceived,
      currentRoundTripTime: candidatePair.currentRoundTripTime,
    },
  }
}

type RtcQualityCounters = {
  packetsLost: number | null
  packetsReceived: number | null
  bytesReceived: number | null
  concealedSamples: number | null
  totalSamples: number | null
  jitterBufferDelay: number | null
  jitterBufferEmittedCount: number | null
}

type CachedMediasoupDevice = {
  device: MediasoupDevice
  rtpCapabilitiesKey: string
}

type AudioSessionConfiguration =
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

const debugCall = (...args: Parameters<typeof console.warn>) => {
  if (__DEV__) {
    console.warn(...args)
  }
}

const stableJson = (value: unknown): string => {
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

const toAudioRouteTelemetry = (
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

const getRtcQualityCounters = (report: RTCStatsReport | unknown): RtcQualityCounters => {
  const entries = normalizeRtcStatsEntries(report)
  const inbound = pickRtcStat(entries, 'inbound-rtp')
  const track = pickRtcStat(entries, 'track')

  const asNumber = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null

  return {
    packetsLost: asNumber(inbound?.packetsLost),
    packetsReceived: asNumber(inbound?.packetsReceived),
    bytesReceived: asNumber(inbound?.bytesReceived),
    concealedSamples: asNumber(track?.concealedSamples),
    totalSamples: asNumber(track?.totalSamplesReceived ?? track?.totalSamplesDuration),
    jitterBufferDelay: asNumber(track?.jitterBufferDelay),
    jitterBufferEmittedCount: asNumber(track?.jitterBufferEmittedCount),
  }
}

const CallContext = createContext<UseCallValue>({
  startVoiceCall: async () => {},
  acceptIncomingCall: async () => {},
  rejectIncomingCall: async () => {},
  endCall: async () => {},
  toggleMute: () => {},
  toggleSpeaker: () => {},
  dismissCallError: () => {},
})

const isBusyPhase = (phase: ReturnType<typeof useCallStore.getState>['phase']) => phase !== 'idle'

const isCallSetupCancelledError = (error: unknown) =>
  error instanceof Error && error.message === CALL_SETUP_CANCELLED_ERROR

const getConversationsFromCache = (value: unknown) => {
  if (Array.isArray(value)) {
    return value as Conversation[]
  }

  return ((value as { pages?: Conversation[][] } | undefined)?.pages?.flat() ??
    []) as Conversation[]
}

const getPeerInfoFromConversation = ({
  conversationId,
  currentUserId,
  fallbackPeerUserId,
  queryClient,
}: {
  conversationId: string
  currentUserId: string
  fallbackPeerUserId?: string
  queryClient: ReturnType<typeof useQueryClient>
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

const getCallEndedMessage = (
  payload: CallEndedPayload,
  state: Pick<ReturnType<typeof useCallStore.getState>, 'direction' | 'phase'>,
) => {
  if (payload.reason === 'no_answer') {
    return state.direction === 'outgoing' ? 'No one answered' : null
  }

  if (payload.reason === 'cancelled') {
    return 'The caller canceled the call'
  }

  if (payload.reason === 'disconnected') {
    return 'The call was interrupted'
  }

  if (payload.reason === 'remote_audio_not_ready') {
    return 'The other person could not activate call audio'
  }

  if (payload.reason === 'remote_accept_failed') {
    return 'The other person could not answer the call'
  }

  return null
}

const getCallRejectedMessage = (payload: CallRejectedPayload) => {
  if (payload.reason === 'busy') {
    return 'The other person is on another call'
  }

  if (payload.reason === 'mic_permission_denied') {
    return 'The other person needs microphone access to answer'
  }

  if (payload.reason === 'unsupported_video') {
    return 'Video calls are not supported yet'
  }

  return 'The call was rejected'
}

const isWaitTimeoutError = (error: unknown) =>
  error instanceof Error && error.message.startsWith('Timed out')

const isRetryableCallStateError = (error: unknown) => {
  if (!isAxiosError(error)) {
    return true
  }

  const status = error.response?.status
  return !status || status === 408 || status === 429 || status >= 500
}

const getAcceptIncomingCallFailureCode = (error: unknown) => {
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

const getRemoteSetupFailureReason = (errorCode: string) =>
  errorCode === 'remote_audio_not_ready' ? errorCode : 'remote_accept_failed'

const isConnectedTransportState = (state: string) => state === 'connected' || state === 'completed'

const waitForTransportConnection = (
  transport: MediasoupTypes.Transport<Record<string, unknown>>,
  timeoutMs = TRANSPORT_CONNECTED_TIMEOUT_MS,
) => {
  if (isConnectedTransportState(transport.connectionState)) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout)
      }
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

const toNativeIncomingCallPayload = (
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

  if (payload.initiatorAvatarUrl) {
    nativePayload.initiatorAvatarUrl = payload.initiatorAvatarUrl
  }

  return nativePayload
}

export const useCall = () => useContext(CallContext)

export function CallProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { isAuthenticated, isLoading, user } = useAuthStore()
  const currentUserId = user?.id ?? null
  const username = user?.username ?? null
  const callPhase = useCallStore((state) => state.phase)
  const callId = useCallStore((state) => state.callId)

  const socketRef = useRef<CallSocket | null>(null)
  const waitRegistryRef = useRef<CallWaitRegistry>(new Set())
  const deviceRef = useRef<MediasoupDevice | null>(null)
  const sendTransportRef = useRef<MediasoupTypes.Transport<Record<string, unknown>> | null>(null)
  const recvTransportRef = useRef<MediasoupTypes.Transport<Record<string, unknown>> | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const audioProducerRef = useRef<MediasoupTypes.Producer<Record<string, unknown>> | null>(null)
  const cachedDeviceRef = useRef<CachedMediasoupDevice | null>(null)
  const consumerMapRef = useRef<Map<string, MediasoupTypes.Consumer<Record<string, unknown>>>>(
    new Map(),
  )
  const connectedTransportIdsRef = useRef<Set<string>>(new Set())
  const queuedRemoteProducerMapRef = useRef<Map<string, NewProducerPayload>>(new Map())
  const handledRemoteProducerIdsRef = useRef<Set<string>>(new Set())
  const consumingProducerIdsRef = useRef<Set<string>>(new Set())
  const retryingProducerIdsRef = useRef<Set<string>>(new Set())
  const activeCallIdRef = useRef<string | null>(null)
  const telemetrySessionRef = useRef<CallTelemetrySession | null>(null)
  const rtcQualityCountersRef = useRef<RtcQualityCounters | null>(null)
  const audioFlowingRef = useRef(false)
  const audioFlowConfirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callSetupGenerationRef = useRef(0)
  const teardownInProgressRef = useRef(false)
  const callAnsweredRef = useRef(false)
  const routerRtpCapabilitiesRef = useRef<Record<string, unknown> | null>(null)
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeAtMsRef = useRef<number | null>(null)
  const remoteAudioFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const peerLeftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectRecoveryInFlightRef = useRef(false)
  const reconnectModeRef = useRef<'local' | 'peer' | null>(null)
  const nativeActionRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const socketDisconnectGraceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const processingNativeActionIdsRef = useRef(new Set<string>())
  const completedNativeActionIdsRef = useRef(new Set<string>())
  const audioSessionWaitersRef = useRef(new Map<string, Promise<AudioSessionConfiguration>>())
  const acceptingIncomingCallIdRef = useRef<string | null>(null)
  const authRestorePromiseRef = useRef<Promise<void> | null>(null)
  const socketConnectPromiseRef = useRef<Promise<CallSocket> | null>(null)
  const callSocketPromisesRef = useRef(new Map<string, Promise<CallSocket>>())
  const callSocketAuthenticatedRef = useRef(false)

  const clearNativeActionRetryTimeout = useCallback(() => {
    if (nativeActionRetryTimeoutRef.current) {
      clearTimeout(nativeActionRetryTimeoutRef.current)
      nativeActionRetryTimeoutRef.current = null
    }
  }, [])

  const clearSocketDisconnectGraceTimeout = useCallback(() => {
    if (socketDisconnectGraceTimeoutRef.current) {
      clearTimeout(socketDisconnectGraceTimeoutRef.current)
      socketDisconnectGraceTimeoutRef.current = null
    }
  }, [])

  const beginCallSetup = useCallback(() => {
    callSetupGenerationRef.current += 1
    return callSetupGenerationRef.current
  }, [])

  const invalidateCallSetup = useCallback(() => {
    callSetupGenerationRef.current += 1
  }, [])

  const isCallSetupCurrent = useCallback((setupToken: number, expectedCallId: string) => {
    const currentCallId = activeCallIdRef.current ?? useCallStore.getState().callId

    return (
      setupToken === callSetupGenerationRef.current &&
      currentCallId === expectedCallId &&
      useCallStore.getState().callId === expectedCallId
    )
  }, [])

  const assertCallSetupCurrent = useCallback(
    (setupToken: number, expectedCallId: string) => {
      if (!isCallSetupCurrent(setupToken, expectedCallId)) {
        throw new Error(CALL_SETUP_CANCELLED_ERROR)
      }
    },
    [isCallSetupCurrent],
  )

  const waitForConfiguredAudioSession = useCallback(
    async (
      setupToken: number,
      callId: string,
      timeoutMs = IOS_AUDIO_SESSION_READY_TIMEOUT_MS,
    ): Promise<AudioSessionConfiguration | undefined> => {
      if (Platform.OS !== 'ios') {
        return
      }

      assertCallSetupCurrent(setupToken, callId)

      const existingWaiter = audioSessionWaitersRef.current.get(callId)
      if (existingWaiter) {
        return existingWaiter
      }

      const waiter = new Promise<AudioSessionConfiguration>((resolve, reject) => {
        let settled = false
        let configuredSubscription: { remove: () => void } | null = null
        let activatedSubscription: { remove: () => void } | null = null
        let appStateSubscription: { remove: () => void } | null = null
        let timeout: ReturnType<typeof setTimeout> | null = null
        let snapshotPoll: ReturnType<typeof setInterval> | null = null
        let snapshotRequestInFlight = false

        const settle = (configuration?: AudioSessionConfiguration, error?: Error) => {
          if (settled) {
            return
          }

          settled = true
          if (timeout) {
            clearTimeout(timeout)
          }
          if (snapshotPoll) {
            clearInterval(snapshotPoll)
          }
          configuredSubscription?.remove()
          activatedSubscription?.remove()
          appStateSubscription?.remove()

          if (error) {
            reject(error)
            return
          }

          if (!isCallSetupCurrent(setupToken, callId)) {
            reject(new Error(CALL_SETUP_CANCELLED_ERROR))
            return
          }

          resolve(configuration ?? { configured: true })
        }

        const loadSnapshot = (source: string) => {
          if (settled || snapshotRequestInFlight) {
            return
          }

          snapshotRequestInFlight = true
          void veloraSystemCalls
            .getNativeAudioSessionState()
            .then((state) => {
              if (settled) {
                return
              }

              debugCall('[Call] audio_snapshot_loaded', JSON.stringify({ callId, source, state }))
              telemetrySessionRef.current?.record('audio_snapshot_loaded', { outcome: 'succeeded' })
              if (state.errorCode) {
                settle(state, new Error(state.errorCode))
                return
              }
              if (state.isActivated && state.isAudioEnabled) {
                debugCall('[Call] audio_already_active', JSON.stringify({ callId, source }))
                telemetrySessionRef.current?.record('audio_already_active', {
                  outcome: 'succeeded',
                })
                settle(state)
              }
            })
            .catch((error) => {
              if (settled) {
                return
              }

              // During a PushKit cold start, the Expo bridge can briefly be unavailable while
              // CallKit is already activating audio. Keep polling until the bounded timeout
              // instead of tearing down the call after a single transient snapshot failure.
              debugCall(
                '[Call] audio_snapshot_load_failed',
                JSON.stringify({ callId, source, error: String(error) }),
              )
              telemetrySessionRef.current?.record('audio_snapshot_loaded', {
                outcome: 'failed',
                error,
              })
            })
            .finally(() => {
              snapshotRequestInFlight = false
            })
        }

        timeout = setTimeout(() => {
          console.warn('[Call] Audio session activation wait timed out')
          settle(undefined, new Error('Audio session activation timed out'))
        }, timeoutMs)

        configuredSubscription = veloraSystemCalls.addAudioSessionConfiguredListener((event) => {
          settle(event, event.errorCode ? new Error(event.errorCode) : undefined)
        })
        activatedSubscription = veloraSystemCalls.addAudioSessionActivatedListener(() => {
          debugCall('[Call] audio_activation_event_received', JSON.stringify({ callId }))
          telemetrySessionRef.current?.record('audio_activation_event_received', {
            outcome: 'succeeded',
          })
          loadSnapshot('activation_event')
        })
        appStateSubscription = AppState.addEventListener('change', (nextState) => {
          if (nextState === 'active') {
            loadSnapshot('app_resume')
          }
        })
        debugCall(
          '[Call] waiting_for_audio_activation',
          JSON.stringify({ callId, timeoutMs, snapshotPollMs: IOS_AUDIO_SESSION_SNAPSHOT_POLL_MS }),
        )
        telemetrySessionRef.current?.record('waiting_for_audio_activation', { outcome: 'started' })
        loadSnapshot('wait_started')
        snapshotPoll = setInterval(() => {
          loadSnapshot('poll')
        }, IOS_AUDIO_SESSION_SNAPSHOT_POLL_MS)
      })

      audioSessionWaitersRef.current.set(callId, waiter)
      void waiter.then(
        () => audioSessionWaitersRef.current.delete(callId),
        () => audioSessionWaitersRef.current.delete(callId),
      )
      return waiter
    },
    [assertCallSetupCurrent, isCallSetupCurrent],
  )

  const scheduleRtcStatsLog = useCallback(
    ({
      callId,
      label,
      mediaId,
      getStats,
    }: {
      callId: string
      label: string
      mediaId: string
      getStats: () => Promise<RTCStatsReport>
    }) => {
      if (!__DEV__) {
        return
      }

      setTimeout(() => {
        void (async () => {
          try {
            const stats = await getStats()
            console.warn(
              `[Call] ${label} stats`,
              JSON.stringify({
                callId,
                mediaId,
                at: new Date().toISOString(),
                timestampMs: Date.now(),
                summary: summarizeRtcStatsReport(stats),
              }),
            )
          } catch (error) {
            console.warn(
              `[Call] Failed to read ${label} stats`,
              JSON.stringify({
                callId,
                mediaId,
                error: error instanceof Error ? error.message : 'unknown_error',
              }),
            )
          }
        })()
      }, RTC_STATS_LOG_DELAY_MS)
    },
    [],
  )

  const sampleRtcQuality = useCallback(async () => {
    const telemetry = telemetrySessionRef.current
    const consumer = consumerMapRef.current.values().next().value as
      MediasoupTypes.Consumer | undefined

    if (!telemetry || !consumer) {
      return
    }

    try {
      const report = await consumer.getStats()
      const entries = normalizeRtcStatsEntries(report)
      const inbound = pickRtcStat(entries, 'inbound-rtp')
      const remoteInbound = pickRtcStat(entries, 'remote-inbound-rtp')
      const candidatePair =
        entries.find(
          (entry) =>
            entry.type === 'candidate-pair' &&
            (entry.selected === true || entry.nominated === true || entry.state === 'succeeded'),
        ) ?? null
      const counters = getRtcQualityCounters(report)
      const previous = rtcQualityCountersRef.current
      rtcQualityCountersRef.current = counters
      const delta = (current: number | null, before: number | null) =>
        current === null || before === null ? null : Math.max(0, current - before)
      const lost = delta(counters.packetsLost, previous?.packetsLost ?? null)
      const received = delta(counters.packetsReceived, previous?.packetsReceived ?? null)
      const receivedBytes = delta(counters.bytesReceived, previous?.bytesReceived ?? null)
      const concealed = delta(counters.concealedSamples, previous?.concealedSamples ?? null)
      const samples = delta(counters.totalSamples, previous?.totalSamples ?? null)
      const jitterDelay = delta(counters.jitterBufferDelay, previous?.jitterBufferDelay ?? null)
      const jitterEmitted = delta(
        counters.jitterBufferEmittedCount,
        previous?.jitterBufferEmittedCount ?? null,
      )
      const numberValue = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) ? value : null
      const jitter = numberValue(inbound?.jitter)
      const roundTripTime =
        numberValue(remoteInbound?.roundTripTime) ??
        numberValue(candidatePair?.currentRoundTripTime)

      if (telemetrySessionRef.current !== telemetry || !consumerMapRef.current.has(consumer.id)) {
        return
      }

      telemetry.record('audio_quality', {
        eventType: 'quality_sample',
        metrics: {
          packetLossRate:
            lost === null || received === null || lost + received === 0
              ? null
              : lost / (lost + received),
          jitterMs: jitter === null ? null : jitter * 1000,
          roundTripTimeMs: roundTripTime === null ? null : roundTripTime * 1000,
          concealmentRate:
            concealed === null || samples === null || concealed + samples === 0
              ? null
              : concealed / (concealed + samples),
          jitterBufferDelayMs:
            jitterDelay === null || jitterEmitted === null || jitterEmitted === 0
              ? null
              : (jitterDelay / jitterEmitted) * 1000,
          packetsReceivedDelta: received,
          bytesReceivedDelta: receivedBytes,
        },
      })

      if (
        !audioFlowingRef.current &&
        ((received !== null && received > 0) || (receivedBytes !== null && receivedBytes > 0))
      ) {
        audioFlowingRef.current = true
        telemetry.record('audio_flowing', { outcome: 'succeeded' })
        telemetry.record('media_ready', { outcome: 'succeeded' })
      }
    } catch {
      // Stats are optional diagnostic data and must never affect call media.
    }
  }, [])

  const getCurrentCallId = useCallback(
    () => activeCallIdRef.current ?? useCallStore.getState().callId,
    [],
  )

  const isCurrentCall = useCallback(
    (payloadCallId: string) => payloadCallId === getCurrentCallId(),
    [getCurrentCallId],
  )

  const completeNativeCallAction = useCallback(
    (actionId: string) => {
      clearNativeActionRetryTimeout()
      veloraSystemCalls.clearPendingCallAction(actionId)

      const completedActionIds = completedNativeActionIdsRef.current
      completedActionIds.add(actionId)

      // Keep the dedupe window bounded for long-lived app sessions.
      while (completedActionIds.size > 64) {
        const oldestActionId = completedActionIds.values().next().value
        if (!oldestActionId) {
          break
        }

        completedActionIds.delete(oldestActionId)
      }
    },
    [clearNativeActionRetryTimeout],
  )

  const stopTimer = useCallback((options?: { resetDuration?: boolean }) => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current)
      timerIntervalRef.current = null
    }

    activeAtMsRef.current = null
    if (options?.resetDuration !== false) {
      useCallStore.getState().setDurationSec(0)
    }
  }, [])

  const startTimer = useCallback(
    (initialDurationSec = 0) => {
      stopTimer()
      activeAtMsRef.current = Date.now() - initialDurationSec * 1000
      useCallStore.getState().setDurationSec(initialDurationSec)

      timerIntervalRef.current = setInterval(() => {
        const startedAtMs = activeAtMsRef.current
        if (!startedAtMs) {
          return
        }

        useCallStore
          .getState()
          .setDurationSec(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)))
      }, 1000)
    },
    [stopTimer],
  )

  const clearRemoteAudioFallback = useCallback(() => {
    if (remoteAudioFallbackTimeoutRef.current) {
      clearTimeout(remoteAudioFallbackTimeoutRef.current)
      remoteAudioFallbackTimeoutRef.current = null
    }
  }, [])

  const clearAudioFlowConfirmation = useCallback(() => {
    if (audioFlowConfirmationTimeoutRef.current) {
      clearTimeout(audioFlowConfirmationTimeoutRef.current)
      audioFlowConfirmationTimeoutRef.current = null
    }
  }, [])

  const clearPeerLeftFallback = useCallback(() => {
    if (peerLeftTimeoutRef.current) {
      clearTimeout(peerLeftTimeoutRef.current)
      peerLeftTimeoutRef.current = null
    }
  }, [])

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  const armRemoteAudioFallback = useCallback(() => {
    clearRemoteAudioFallback()
    remoteAudioFallbackTimeoutRef.current = setTimeout(() => {
      const state = useCallStore.getState()
      if (state.phase === 'active' && state.remoteAudioState !== 'connected') {
        useCallStore.getState().patch({ remoteAudioState: 'waiting' })
      }
    }, REMOTE_AUDIO_WAIT_FALLBACK_MS)
  }, [clearRemoteAudioFallback])

  const presentError = useCallback((message: string) => {
    useCallStore.getState().patch({ error: message })
  }, [])

  const resetRuntimeRefs = useCallback(
    (options?: { preserveActiveCall?: boolean }) => {
      clearAudioFlowConfirmation()
      clearRemoteAudioFallback()
      clearPeerLeftFallback()
      clearReconnectTimeout()
      clearWaitRegistry(waitRegistryRef.current)
      connectedTransportIdsRef.current.clear()
      queuedRemoteProducerMapRef.current.clear()
      handledRemoteProducerIdsRef.current.clear()
      consumingProducerIdsRef.current.clear()
      retryingProducerIdsRef.current.clear()
      audioFlowingRef.current = false
      consumerMapRef.current.clear()
      deviceRef.current = null
      sendTransportRef.current = null
      recvTransportRef.current = null
      localStreamRef.current = null
      remoteStreamRef.current = null
      audioProducerRef.current = null
      routerRtpCapabilitiesRef.current = null
      reconnectRecoveryInFlightRef.current = false
      reconnectModeRef.current = null

      if (!options?.preserveActiveCall) {
        activeCallIdRef.current = null
        callAnsweredRef.current = false
      }
    },
    [
      clearAudioFlowConfirmation,
      clearPeerLeftFallback,
      clearReconnectTimeout,
      clearRemoteAudioFallback,
    ],
  )

  const disposeMediaRuntime = useCallback(
    (options?: { preserveActiveCall?: boolean }) => {
      const currentConsumers = [...consumerMapRef.current.values()]
      const currentProducer = audioProducerRef.current
      const currentSendTransport = sendTransportRef.current
      const currentRecvTransport = recvTransportRef.current
      const localStream = localStreamRef.current
      const remoteStream = remoteStreamRef.current

      currentConsumers.forEach((consumer) => {
        try {
          consumer.close()
        } catch {
          console.warn('[Call] Failed to close consumer during teardown')
        }
      })

      if (currentProducer) {
        try {
          currentProducer.close()
        } catch {
          console.warn('[Call] Failed to close producer during teardown')
        }
      }

      if (currentSendTransport) {
        try {
          currentSendTransport.close()
        } catch {
          console.warn('[Call] Failed to close send transport during teardown')
        }
      }

      if (currentRecvTransport) {
        try {
          currentRecvTransport.close()
        } catch {
          console.warn('[Call] Failed to close recv transport during teardown')
        }
      }

      localStream?.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          console.warn('[Call] Failed to stop local track during teardown')
        }
      })

      remoteStream?.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          console.warn('[Call] Failed to stop remote track during teardown')
        }
      })

      resetRuntimeRefs(options)
    },
    [resetRuntimeRefs],
  )

  const resetRemoteConsumerRuntime = useCallback(() => {
    const currentConsumers = [...consumerMapRef.current.values()]
    const remoteStream = remoteStreamRef.current

    currentConsumers.forEach((consumer) => {
      try {
        consumer.close()
      } catch {
        console.warn('[Call] Failed to close remote consumer during peer reconnect cleanup')
      }
    })

    remoteStream?.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        console.warn('[Call] Failed to stop remote track during peer reconnect cleanup')
      }
    })

    consumerMapRef.current.clear()
    handledRemoteProducerIdsRef.current.clear()
    consumingProducerIdsRef.current.clear()
    retryingProducerIdsRef.current.clear()
    queuedRemoteProducerMapRef.current.clear()
    remoteStreamRef.current = null
    useCallStore.getState().patch({ remoteStreamUrl: null })
  }, [])

  const teardownOnce = useCallback(
    async (
      reason: string,
      options?: {
        errorMessage?: string | null
        telemetryError?: unknown
        telemetryErrorCode?: string
      },
    ) => {
      if (teardownInProgressRef.current) {
        return
      }

      teardownInProgressRef.current = true
      invalidateCallSetup()
      clearSocketDisconnectGraceTimeout()
      const endingCallId = activeCallIdRef.current ?? useCallStore.getState().callId
      debugCall(
        '[Call] teardown_requested',
        JSON.stringify({
          callId: endingCallId,
          source: reason,
          reason: options?.telemetryErrorCode ?? reason,
        }),
      )
      telemetrySessionRef.current?.record('teardown_requested', {
        outcome: 'started',
        ...(options?.telemetryErrorCode ? { errorCode: options.telemetryErrorCode } : {}),
      })
      telemetrySessionRef.current?.terminal(
        reason,
        options?.telemetryError ??
          (options?.errorMessage ? new Error(options.errorMessage) : undefined),
        options?.telemetryErrorCode,
      )
      telemetrySessionRef.current = null
      rtcQualityCountersRef.current = null
      if (acceptingIncomingCallIdRef.current === endingCallId) {
        acceptingIncomingCallIdRef.current = null
      }
      if (endingCallId) {
        audioSessionWaitersRef.current.delete(endingCallId)
      }
      stopTimer()
      if (endingCallId) {
        veloraSystemCalls.endCall(endingCallId)
      }
      disposeMediaRuntime()
      useCallStore.getState().reset()

      if (options?.errorMessage) {
        useCallStore.getState().patch({ error: options.errorMessage })
      }

      teardownInProgressRef.current = false
      debugCall(`[Call] Teardown completed (${reason})`)
    },
    [clearSocketDisconnectGraceTimeout, disposeMediaRuntime, invalidateCallSetup, stopTimer],
  )

  const teardownRecoveryFailure = useCallback(
    async (reason: string) => {
      const socket = socketRef.current
      const callId = activeCallIdRef.current ?? useCallStore.getState().callId

      if (socket?.connected && callId) {
        socket.emit('leave_call', {
          callId,
          reason: 'disconnected',
        })
      }

      await teardownOnce(reason, {
        errorMessage: 'Call connection was lost',
      })
    },
    [teardownOnce],
  )

  const leaveCallFromLifecycle = useCallback(
    async (reason: string) => {
      const state = useCallStore.getState()
      if (!['active', 'reconnecting'].includes(state.phase) || !state.callId) {
        return
      }

      const socket = socketRef.current
      if (socket?.connected) {
        socket.emit('leave_call', {
          callId: state.callId,
          reason,
        })
      }

      await teardownOnce(`lifecycle_${reason}`)
    },
    [teardownOnce],
  )

  const armReconnectTimeout = useCallback(
    (reason: string, timeoutMs = RECONNECT_RECOVERY_TIMEOUT_MS) => {
      clearReconnectTimeout()
      reconnectTimeoutRef.current = setTimeout(() => {
        void teardownRecoveryFailure(reason)
      }, timeoutMs)
    },
    [clearReconnectTimeout, teardownRecoveryFailure],
  )

  const ensureMicPermission = useCallback(async () => {
    if (typeof Camera.requestMicrophonePermissionsAsync !== 'function') {
      throw new Error('Microphone permission API is unavailable in this build')
    }

    const permission = await Camera.requestMicrophonePermissionsAsync()
    const granted = permission.granted === true
    useCallStore.getState().patch({ hasMicPermission: granted })
    return granted
  }, [])

  const ensureAuthenticatedSession = useCallback(async (callId: string) => {
    const currentAuth = useAuthStore.getState()
    telemetrySessionRef.current?.record('auth_restore_started', { outcome: 'started' })
    debugCall('[Call] auth_restore_started', JSON.stringify({ callId }))

    if (currentAuth.isAuthenticated && currentAuth.user?.id) {
      telemetrySessionRef.current?.record('auth_restore_succeeded', { outcome: 'succeeded' })
      return
    }

    if (!authRestorePromiseRef.current) {
      authRestorePromiseRef.current = currentAuth.hydrateAuth({ silent: true }).then(() => {
        const restoredAuth = useAuthStore.getState()
        if (!restoredAuth.isAuthenticated || !restoredAuth.user?.id) {
          throw new Error('auth_not_restored')
        }
      })
    }

    try {
      await authRestorePromiseRef.current
      telemetrySessionRef.current?.record('auth_restore_succeeded', { outcome: 'succeeded' })
      debugCall('[Call] auth_restore_succeeded', JSON.stringify({ callId }))
    } catch (error) {
      const errorCode =
        useAuthStore.getState().authHydrationError === 'network'
          ? 'network_unavailable'
          : 'auth_not_restored'
      telemetrySessionRef.current?.record('auth_restore_failed', {
        outcome: 'failed',
        error,
        errorCode,
      })
      debugCall('[Call] auth_restore_failed', JSON.stringify({ callId, errorCode }))
      throw new Error(errorCode)
    } finally {
      authRestorePromiseRef.current = null
    }
  }, [])

  const handleTerminalCall = useCallback(
    (payload: CallEndedPayload, source: 'live' | 'socket_ready_replay') => {
      // A PushKit cold launch can have a native CallKit call even while the JS call store
      // is still idle. Always end the native system call by callId before checking JS state.
      veloraSystemCalls.dismissIncomingCall(payload.callId)

      if (!isCurrentCall(payload.callId)) {
        debugCall(
          '[Call] terminal_call_dismissed_without_js_state',
          JSON.stringify({ callId: payload.callId, reason: payload.reason, source }),
        )
        return
      }

      clearPeerLeftFallback()
      const state = useCallStore.getState()
      void teardownOnce(source === 'live' ? 'call_ended' : 'call_ended_replayed', {
        errorMessage: getCallEndedMessage(payload, state),
      })
    },
    [clearPeerLeftFallback, isCurrentCall, teardownOnce],
  )

  const ensureCallSocketConnected = useCallback(
    async (callId: string): Promise<CallSocket> => {
      const existingCallPromise = callSocketPromisesRef.current.get(callId)
      if (existingCallPromise) {
        return existingCallPromise
      }

      const callPromise = (async () => {
        await ensureAuthenticatedSession(callId)

        if (socketConnectPromiseRef.current) {
          return socketConnectPromiseRef.current
        }

        const connectionPromise = (async () => {
          let socket = socketRef.current
          if (!socket) {
            socket = createCallSocket()
            socketRef.current = socket
          }

          if (socket.connected && callSocketAuthenticatedRef.current) {
            return socket
          }

          callSocketAuthenticatedRef.current = false
          telemetrySessionRef.current?.record('socket_connect_started', { outcome: 'started' })
          debugCall('[Call] socket_connect_started', JSON.stringify({ callId }))
          await authenticateCallSocket(socket)

          await new Promise<void>((resolve, reject) => {
            let settled = false
            const settle = (error?: Error) => {
              if (settled) return
              settled = true
              clearTimeout(timeoutId)
              socket.off('call_socket_ready', handleReady)
              socket.off('connect', handleConnect)
              socket.off('connect_error', handleConnectError)
              socket.off('disconnect', handleDisconnect)
              if (error) {
                reject(error)
              } else {
                resolve()
              }
            }
            const handleReady = (payload?: CallSocketReadyPayload) => {
              callSocketAuthenticatedRef.current = true
              telemetrySessionRef.current?.record('socket_authenticated', { outcome: 'succeeded' })
              debugCall('[Call] socket_authenticated', JSON.stringify({ callId }))

              const recentTerminalCalls = payload?.recentTerminalCalls ?? []
              recentTerminalCalls.forEach((terminalCall) => {
                handleTerminalCall(terminalCall, 'socket_ready_replay')
              })

              if (
                callId !== 'runtime' &&
                recentTerminalCalls.some((terminalCall) => terminalCall.callId === callId)
              ) {
                settle(new Error('call_already_ended'))
                return
              }

              settle()
            }
            const handleConnect = () => {
              telemetrySessionRef.current?.record('socket_connected', { outcome: 'succeeded' })
              debugCall('[Call] socket_connected', JSON.stringify({ callId }))
            }
            const handleConnectError = () => settle(new Error('network_unavailable'))
            const handleDisconnect = (reason: string) => {
              settle(
                new Error(
                  reason === 'io server disconnect' ? 'socket_auth_failed' : 'network_unavailable',
                ),
              )
            }
            const timeoutId = setTimeout(
              () => settle(new Error('socket_connect_timeout')),
              SOCKET_CONNECT_TIMEOUT_MS,
            )

            socket.once('call_socket_ready', handleReady)
            socket.once('connect', handleConnect)
            socket.once('connect_error', handleConnectError)
            socket.once('disconnect', handleDisconnect)

            if (socket.connected && callSocketAuthenticatedRef.current) {
              handleReady()
            } else {
              // A connected socket with no authenticated-ready acknowledgement is not usable.
              // Reconnect so the updated auth payload is sent in a fresh handshake.
              if (socket.connected) {
                socket.disconnect()
              }
              socket.connect()
            }
          })

          return socket
        })()

        socketConnectPromiseRef.current = connectionPromise
        try {
          return await connectionPromise
        } finally {
          socketConnectPromiseRef.current = null
        }
      })()

      callSocketPromisesRef.current.set(callId, callPromise)
      void callPromise.then(
        () => callSocketPromisesRef.current.delete(callId),
        () => callSocketPromisesRef.current.delete(callId),
      )
      return callPromise
    },
    [ensureAuthenticatedSession, handleTerminalCall],
  )

  const ensureSocketConnected = useCallback(
    () => ensureCallSocketConnected(activeCallIdRef.current ?? 'runtime'),
    [ensureCallSocketConnected],
  )

  const restorePreActiveCallMembership = useCallback(async (socket: CallSocket, callId: string) => {
    const state = useCallStore.getState()
    if (state.callId !== callId) {
      return
    }

    const shouldRestoreMembership =
      state.phase === 'outgoing_ringing' ||
      state.phase === 'connecting' ||
      (state.phase === 'incoming_ringing' && acceptingIncomingCallIdRef.current === callId)

    if (!shouldRestoreMembership) {
      return
    }

    await emitAndWaitForEvent<'join_call', 'call_joined'>(
      socket,
      'join_call',
      { callId },
      {
        event: 'call_joined',
        timeoutMs: CALL_JOINED_TIMEOUT_MS,
        registry: waitRegistryRef.current,
        filter: (payload) => payload.callId === callId,
      },
    )

    debugCall(
      '[Call] setup_call_membership_restored',
      JSON.stringify({ callId, phase: state.phase }),
    )
    telemetrySessionRef.current?.record('socket_rejoin_succeeded', {
      outcome: 'succeeded',
    })
  }, [])

  const ensureDeviceLoaded = useCallback(async (payload: CallJoinedPayload) => {
    const rtpCapabilitiesKey = stableJson(payload.rtpCapabilities)
    const activeDevice = deviceRef.current

    if (activeDevice) {
      if (stableJson(routerRtpCapabilitiesRef.current) !== rtpCapabilitiesKey) {
        throw new Error('Router RTP capabilities changed during an active call')
      }

      return activeDevice
    }

    const cachedDevice = cachedDeviceRef.current
    if (cachedDevice?.rtpCapabilitiesKey === rtpCapabilitiesKey) {
      deviceRef.current = cachedDevice.device
      routerRtpCapabilitiesRef.current = payload.rtpCapabilities
      telemetrySessionRef.current?.record('device_cache_hit', { outcome: 'succeeded' })
      return cachedDevice.device
    }

    ensureMediasoupGlobalsRegistered()
    const device = createMediasoupDevice()
    await device.load({
      routerRtpCapabilities: toRouterRtpCapabilities(payload.rtpCapabilities),
    })

    cachedDeviceRef.current = { device, rtpCapabilitiesKey }
    deviceRef.current = device
    routerRtpCapabilitiesRef.current = payload.rtpCapabilities
    telemetrySessionRef.current?.record('device_cache_miss', { outcome: 'succeeded' })
    return device
  }, [])

  const createTransport = useCallback(
    async (
      socket: CallSocket,
      callId: string,
      direction: 'send' | 'recv',
      device: MediasoupDevice,
    ) => {
      const transportCreated = await emitAndWaitForEvent<'create_transport', 'transport_created'>(
        socket,
        'create_transport',
        { callId, direction },
        {
          event: 'transport_created',
          timeoutMs: TRANSPORT_CREATED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload: TransportCreatedPayload) =>
            payload.callId === callId && payload.direction === direction,
        },
      )

      const transportOptions = toTransportOptions(transportCreated)
      const transport =
        direction === 'send'
          ? device.createSendTransport<Record<string, unknown>>(transportOptions)
          : device.createRecvTransport<Record<string, unknown>>(transportOptions)

      transport.on('connectionstatechange', (state) => {
        debugCall(
          `[Call] ${direction} transport connection state changed`,
          JSON.stringify({ callId, transportId: transport.id, state }),
        )
      })

      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        void (async () => {
          try {
            debugCall(
              `[Call] Connecting ${direction} transport`,
              JSON.stringify({ callId, transportId: transport.id }),
            )
            await emitAndWaitForEvent<'connect_transport', 'transport_connected'>(
              socket,
              'connect_transport',
              {
                callId,
                transportId: transport.id,
                dtlsParameters: dtlsParameters as unknown as Record<string, unknown>,
              },
              {
                event: 'transport_connected',
                timeoutMs: TRANSPORT_CONNECTED_TIMEOUT_MS,
                registry: waitRegistryRef.current,
                filter: (payload) =>
                  payload.callId === callId && payload.transportId === transport.id,
              },
            )

            connectedTransportIdsRef.current.add(transport.id)
            telemetrySessionRef.current?.record(`${direction}_transport_connected`, {
              outcome: 'succeeded',
            })
            debugCall(
              `[Call] ${direction} transport connected`,
              JSON.stringify({ callId, transportId: transport.id }),
            )
            callback()
          } catch (error) {
            console.warn(
              `[Call] Failed to connect ${direction} transport`,
              JSON.stringify({
                callId,
                transportId: transport.id,
                error: error instanceof Error ? error.message : 'unknown_error',
              }),
            )
            errback(error instanceof Error ? error : new Error('Failed to connect transport'))
          }
        })()
      })

      if (direction === 'send') {
        transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
          void (async () => {
            try {
              debugCall(
                '[Call] Producing local media',
                JSON.stringify({ callId, transportId: transport.id, kind }),
              )
              const produced = await emitAndWaitForEvent<'produce', 'new_producer'>(
                socket,
                'produce',
                {
                  callId,
                  transportId: transport.id,
                  kind: kind as 'audio',
                  rtpParameters: rtpParameters as unknown as Record<string, unknown>,
                },
                {
                  event: 'new_producer',
                  timeoutMs: REMOTE_PRODUCER_TIMEOUT_MS,
                  registry: waitRegistryRef.current,
                  filter: (payload) =>
                    payload.callId === callId &&
                    payload.userId === currentUserId &&
                    payload.kind === 'audio',
                },
              )

              debugCall(
                '[Call] Local producer announced',
                JSON.stringify({
                  callId,
                  transportId: transport.id,
                  producerId: produced.producerId,
                  kind: produced.kind,
                }),
              )
              callback({ id: produced.producerId })
            } catch (error) {
              console.warn(
                '[Call] Failed to produce local media',
                JSON.stringify({
                  callId,
                  transportId: transport.id,
                  error: error instanceof Error ? error.message : 'unknown_error',
                }),
              )
              errback(error instanceof Error ? error : new Error('Failed to produce audio'))
            }
          })()
        })
      }

      return transport
    },
    [currentUserId],
  )

  const consumeRemoteProducer = useCallback(
    async (
      payload: NewProducerPayload,
      options?: { propagateFailure?: boolean; setupToken?: number },
    ) => {
      const socket = socketRef.current
      const callId = getCurrentCallId()
      const device = deviceRef.current
      const recvTransport = recvTransportRef.current
      const setupToken = options?.setupToken ?? callSetupGenerationRef.current

      if (!callId || payload.callId !== callId) {
        return
      }

      assertCallSetupCurrent(setupToken, callId)

      if (!socket || !device?.loaded || !recvTransport) {
        if (options?.propagateFailure) {
          throw new Error('Remote consumer runtime is unavailable')
        }

        debugCall(
          '[Call] Queueing remote producer until runtime is ready',
          JSON.stringify({
            payloadCallId: payload.callId,
            activeCallId: callId,
            producerId: payload.producerId,
            hasSocket: Boolean(socket),
            deviceLoaded: Boolean(device?.loaded),
            hasRecvTransport: Boolean(recvTransport),
          }),
        )
        queuedRemoteProducerMapRef.current.set(payload.producerId, payload)
        return
      }

      if (
        payload.callId !== callId ||
        payload.userId === currentUserId ||
        payload.kind !== 'audio' ||
        handledRemoteProducerIdsRef.current.has(payload.producerId) ||
        consumingProducerIdsRef.current.has(payload.producerId)
      ) {
        debugCall(
          '[Call] Ignoring new_producer event',
          JSON.stringify({
            payloadCallId: payload.callId,
            activeCallId: callId,
            payloadUserId: payload.userId,
            currentUserId,
            producerId: payload.producerId,
            kind: payload.kind,
            alreadyHandled: handledRemoteProducerIdsRef.current.has(payload.producerId),
            alreadyConsuming: consumingProducerIdsRef.current.has(payload.producerId),
          }),
        )
        return
      }

      const rtpCapabilities = device.rtpCapabilities
      consumingProducerIdsRef.current.add(payload.producerId)

      try {
        debugCall(
          '[Call] Consuming remote producer',
          JSON.stringify({
            callId,
            recvTransportId: recvTransport.id,
            producerId: payload.producerId,
            peerUserId: payload.userId,
          }),
        )
        const consumerCreated = await emitAndWaitForEvent<'consume', 'consumer_created'>(
          socket,
          'consume',
          {
            callId,
            transportId: recvTransport.id,
            producerId: payload.producerId,
            rtpCapabilities: rtpCapabilities as unknown as Record<string, unknown>,
          },
          {
            event: 'consumer_created',
            timeoutMs: CONSUMER_CREATED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (eventPayload) =>
              eventPayload.callId === callId && eventPayload.producerId === payload.producerId,
          },
        )
        assertCallSetupCurrent(setupToken, callId)

        debugCall(
          '[Call] Remote consumer created',
          JSON.stringify({
            callId,
            recvTransportId: recvTransport.id,
            consumerId: consumerCreated.consumerId,
            producerId: consumerCreated.producerId,
            kind: consumerCreated.kind,
          }),
        )
        const consumer = await recvTransport.consume({
          id: consumerCreated.consumerId,
          producerId: consumerCreated.producerId,
          kind: consumerCreated.kind,
          rtpParameters: consumerCreated.rtpParameters as never,
        })
        if (!isCallSetupCurrent(setupToken, callId)) {
          consumer.close()
          throw new Error(CALL_SETUP_CANCELLED_ERROR)
        }

        consumerMapRef.current.set(consumer.id, consumer)
        telemetrySessionRef.current?.record('remote_consumer_ready', { outcome: 'succeeded' })
        debugCall(
          '[Call] Remote consumer attached locally',
          JSON.stringify({
            callId,
            consumerId: consumer.id,
            producerId: payload.producerId,
            trackId: consumer.track.id,
            muted: consumer.track.muted,
            enabled: consumer.track.enabled,
            readyState: consumer.track.readyState,
          }),
        )

        consumer.track.addEventListener('mute', () => {
          debugCall(
            '[Call] Remote audio track muted',
            JSON.stringify({ callId, consumerId: consumer.id, trackId: consumer.track.id }),
          )
        })

        consumer.track.addEventListener('unmute', () => {
          debugCall(
            '[Call] Remote audio track unmuted',
            JSON.stringify({ callId, consumerId: consumer.id, trackId: consumer.track.id }),
          )
        })

        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream()
        }

        remoteStreamRef.current.addTrack(consumer.track as unknown as MediaStreamTrack)
        useCallStore.getState().patch({ remoteStreamUrl: remoteStreamRef.current.toURL() })

        await emitAndWaitForEvent<'resume_consumer', 'consumer_resumed'>(
          socket,
          'resume_consumer',
          {
            callId,
            consumerId: consumer.id,
          },
          {
            event: 'consumer_resumed',
            timeoutMs: CONSUMER_RESUMED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (eventPayload) =>
              eventPayload.callId === callId && eventPayload.consumerId === consumer.id,
          },
        )
        assertCallSetupCurrent(setupToken, callId)

        debugCall(
          '[Call] Remote consumer resumed',
          JSON.stringify({
            callId,
            consumerId: consumer.id,
            producerId: payload.producerId,
          }),
        )
        scheduleRtcStatsLog({
          callId,
          label: 'Remote consumer',
          mediaId: consumer.id,
          getStats: () => consumer.getStats(),
        })
        const wasWaitingForPeerAudio = reconnectModeRef.current === 'peer'
        const firstRemoteAudio = handledRemoteProducerIdsRef.current.size === 0
        handledRemoteProducerIdsRef.current.add(payload.producerId)
        queuedRemoteProducerMapRef.current.delete(payload.producerId)
        reconnectModeRef.current = null
        clearReconnectTimeout()
        clearRemoteAudioFallback()
        useCallStore.getState().patch({
          ...(wasWaitingForPeerAudio ? { phase: 'active', reconnectDeadlineMs: null } : {}),
          remoteAudioState: 'connected',
        })
        if (firstRemoteAudio) {
          telemetrySessionRef.current?.record('remote_consumer_resumed', { outcome: 'succeeded' })
          void sampleRtcQuality()
          clearAudioFlowConfirmation()
          audioFlowConfirmationTimeoutRef.current = setTimeout(() => {
            audioFlowConfirmationTimeoutRef.current = null
            void sampleRtcQuality()
          }, AUDIO_FLOW_CONFIRMATION_DELAY_MS)
        }

        if (wasWaitingForPeerAudio) {
          startTimer(useCallStore.getState().durationSec)
        }
      } catch (error) {
        if (!isCallSetupCurrent(setupToken, callId)) {
          if (options?.propagateFailure) {
            throw new Error(CALL_SETUP_CANCELLED_ERROR)
          }
          return
        }

        const state = useCallStore.getState()
        console.warn(
          '[Call] Failed to consume remote producer',
          JSON.stringify({
            callId,
            recvTransportId: recvTransport.id,
            producerId: payload.producerId,
            phase: state.phase,
            reconnectMode: reconnectModeRef.current,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )

        if (reconnectModeRef.current) {
          queuedRemoteProducerMapRef.current.set(payload.producerId, payload)
          useCallStore.getState().patch({ remoteAudioState: 'waiting' })

          if (!retryingProducerIdsRef.current.has(payload.producerId)) {
            retryingProducerIdsRef.current.add(payload.producerId)
            setTimeout(() => {
              retryingProducerIdsRef.current.delete(payload.producerId)
              const queuedPayload = queuedRemoteProducerMapRef.current.get(payload.producerId)

              if (
                queuedPayload &&
                reconnectModeRef.current &&
                !handledRemoteProducerIdsRef.current.has(payload.producerId)
              ) {
                void consumeRemoteProducer(queuedPayload)
              }
            }, 750)
          }
          return
        }

        if (options?.propagateFailure) {
          throw error instanceof Error ? error : new Error('Failed to consume remote producer')
        }

        await teardownOnce('consume_remote_producer', {
          errorMessage: 'Unable to set up the call',
        })
      } finally {
        consumingProducerIdsRef.current.delete(payload.producerId)
      }
    },
    [
      clearReconnectTimeout,
      clearRemoteAudioFallback,
      clearAudioFlowConfirmation,
      currentUserId,
      assertCallSetupCurrent,
      getCurrentCallId,
      isCallSetupCurrent,
      scheduleRtcStatsLog,
      sampleRtcQuality,
      startTimer,
      teardownOnce,
    ],
  )

  const flushQueuedRemoteProducers = useCallback(
    async (options: { setupToken: number }) => {
      const queuedProducers = [...queuedRemoteProducerMapRef.current.values()]

      for (const payload of queuedProducers) {
        await consumeRemoteProducer(payload, {
          propagateFailure: true,
          setupToken: options.setupToken,
        })
      }
    },
    [consumeRemoteProducer],
  )

  const postAnswerSetup = useCallback(
    async (
      payload: CallJoinedPayload | CallRejoinedPayload,
      options: { resumeDurationSec?: number; setupToken: number },
    ) => {
      const socket = socketRef.current
      if (!socket) {
        throw new Error('Call socket is not connected')
      }

      const callId = payload.callId
      const telemetry = telemetrySessionRef.current
      assertCallSetupCurrent(options.setupToken, callId)
      const device = await ensureDeviceLoaded(payload)
      telemetry?.record('device_loaded', { outcome: 'succeeded' })
      assertCallSetupCurrent(options.setupToken, callId)
      debugCall(
        '[Call] Requesting local media',
        JSON.stringify({
          callId,
          at: new Date().toISOString(),
          timestampMs: Date.now(),
        }),
      )
      const [recvTransportResult, sendTransportResult, localStreamResult] =
        await Promise.allSettled([
          createTransport(socket, callId, 'recv', device),
          createTransport(socket, callId, 'send', device),
          mediaDevices.getUserMedia({ audio: true, video: false }),
        ])

      if (
        recvTransportResult.status !== 'fulfilled' ||
        sendTransportResult.status !== 'fulfilled' ||
        localStreamResult.status !== 'fulfilled'
      ) {
        if (recvTransportResult.status === 'fulfilled') {
          recvTransportResult.value.close()
        }
        if (sendTransportResult.status === 'fulfilled') {
          sendTransportResult.value.close()
        }
        if (localStreamResult.status === 'fulfilled') {
          localStreamResult.value.getTracks().forEach((track) => track.stop())
        }

        const failedResult = [recvTransportResult, sendTransportResult, localStreamResult].find(
          (result) => result.status === 'rejected',
        )
        throw failedResult && failedResult.status === 'rejected'
          ? failedResult.reason
          : new Error('Unable to initialize call media')
      }

      const recvTransport = recvTransportResult.value
      const sendTransport = sendTransportResult.value
      const localStream = localStreamResult.value
      telemetry?.record('recv_transport_created', { outcome: 'succeeded' })
      telemetry?.record('send_transport_created', { outcome: 'succeeded' })
      if (!isCallSetupCurrent(options.setupToken, callId)) {
        recvTransport.close()
        sendTransport.close()
        localStream.getTracks().forEach((track) => track.stop())
        throw new Error(CALL_SETUP_CANCELLED_ERROR)
      }
      recvTransportRef.current = recvTransport
      sendTransportRef.current = sendTransport
      const localAudioTrack = localStream.getAudioTracks()[0]

      if (!localAudioTrack) {
        localStream.getTracks().forEach((track) => track.stop())
        throw new Error('No local audio track available')
      }

      const muted = useCallStore.getState().muted
      localAudioTrack.enabled = !muted
      localStreamRef.current = localStream
      telemetry?.record('microphone_ready', { outcome: 'succeeded' })
      debugCall(
        '[Call] Local audio track ready',
        JSON.stringify({
          callId,
          at: new Date().toISOString(),
          timestampMs: Date.now(),
          trackId: localAudioTrack.id,
          enabled: localAudioTrack.enabled,
          muted: localAudioTrack.muted,
          readyState: localAudioTrack.readyState,
        }),
      )

      if (!device.canProduce('audio')) {
        throw new Error('Device cannot produce audio')
      }

      const audioProducer = await sendTransport.produce({
        track: localAudioTrack as never,
        stopTracks: false,
      })
      if (!isCallSetupCurrent(options.setupToken, callId)) {
        audioProducer.close()
        throw new Error(CALL_SETUP_CANCELLED_ERROR)
      }
      audioProducerRef.current = audioProducer
      telemetry?.record('audio_producer_ready', { outcome: 'succeeded' })
      scheduleRtcStatsLog({
        callId,
        label: 'Local producer',
        mediaId: audioProducer.id,
        getStats: () => audioProducer.getStats(),
      })

      for (const producer of payload.activeProducers ?? []) {
        await consumeRemoteProducer(
          {
            callId,
            userId: producer.userId,
            producerId: producer.producerId,
            kind: producer.kind,
          },
          {
            propagateFailure: true,
            setupToken: options.setupToken,
          },
        )
      }

      await flushQueuedRemoteProducers({ setupToken: options.setupToken })
      assertCallSetupCurrent(options.setupToken, callId)
      callAnsweredRef.current = true
      useCallStore.getState().patch({
        phase: 'active',
        muted,
        remoteAudioState: handledRemoteProducerIdsRef.current.size > 0 ? 'connected' : 'waiting',
        remoteStreamUrl: remoteStreamRef.current?.toURL() ?? null,
        reconnectDeadlineMs: null,
      })
      startTimer(options.resumeDurationSec ?? 0)
      armRemoteAudioFallback()
    },
    [
      armRemoteAudioFallback,
      assertCallSetupCurrent,
      consumeRemoteProducer,
      createTransport,
      ensureDeviceLoaded,
      flushQueuedRemoteProducers,
      isCallSetupCurrent,
      scheduleRtcStatsLog,
      startTimer,
    ],
  )

  const restartConnectedTransports = useCallback(async (socket: CallSocket, callId: string) => {
    const transports = [sendTransportRef.current, recvTransportRef.current].filter(
      (transport): transport is MediasoupTypes.Transport<Record<string, unknown>> =>
        Boolean(transport && connectedTransportIdsRef.current.has(transport.id)),
    )

    if (transports.length === 0) {
      throw new Error('No connected media transport is available for ICE restart')
    }

    await Promise.all(
      transports.map(async (transport) => {
        const restarted = await emitAndWaitForEvent<'restart_ice', 'ice_restarted'>(
          socket,
          'restart_ice',
          { callId, transportId: transport.id },
          {
            event: 'ice_restarted',
            timeoutMs: TRANSPORT_CONNECTED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload: IceRestartedPayload) =>
              payload.callId === callId && payload.transportId === transport.id,
          },
        )

        await transport.restartIce({
          iceParameters: restarted.iceParameters as MediasoupTypes.IceParameters,
        })
      }),
    )
    await Promise.all(transports.map((transport) => waitForTransportConnection(transport)))
  }, [])

  const recoverActiveCall = useCallback(async () => {
    const socket = socketRef.current
    const state = useCallStore.getState()

    if (
      reconnectRecoveryInFlightRef.current ||
      !socket?.connected ||
      state.phase !== 'reconnecting' ||
      !state.callId
    ) {
      return
    }

    reconnectRecoveryInFlightRef.current = true

    try {
      const rejoined = await emitAndWaitForEvent<'rejoin_call', 'call_rejoined'>(
        socket,
        'rejoin_call',
        { callId: state.callId },
        {
          event: 'call_rejoined',
          timeoutMs: CALL_JOINED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload) => payload.callId === state.callId,
        },
      )

      activeCallIdRef.current = rejoined.callId
      callAnsweredRef.current = true
      telemetrySessionRef.current?.attachCall(rejoined.telemetryToken)
      try {
        await restartConnectedTransports(socket, rejoined.callId)
        reconnectModeRef.current = null
        clearReconnectTimeout()
        useCallStore.getState().patch({
          phase: 'active',
          reconnectDeadlineMs: null,
        })
        startTimer(useCallStore.getState().durationSec)
        telemetrySessionRef.current?.record('reconnect_transport_connected', {
          outcome: 'succeeded',
        })
        telemetrySessionRef.current?.record('reconnect', { outcome: 'succeeded' })
        return
      } catch (error) {
        console.warn(
          '[Call] ICE restart failed; rebuilding media runtime',
          JSON.stringify({
            callId: rejoined.callId,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )
      }

      invalidateCallSetup()
      disposeMediaRuntime({ preserveActiveCall: true })
      const setupToken = beginCallSetup()
      await postAnswerSetup(rejoined, {
        resumeDurationSec: useCallStore.getState().durationSec,
        setupToken,
      })
      telemetrySessionRef.current?.record('reconnect', { outcome: 'succeeded' })
      assertCallSetupCurrent(setupToken, rejoined.callId)

      if (useCallStore.getState().remoteAudioState !== 'connected') {
        useCallStore.getState().patch({
          reconnectDeadlineMs: Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS,
        })
        armReconnectTimeout('recover_audio_timeout')
      }
    } catch (error) {
      if (isCallSetupCancelledError(error)) {
        return
      }

      if (isWaitTimeoutError(error)) {
        console.warn(
          '[Call] Recovery helper timed out before reconnect grace window expired',
          JSON.stringify({
            callId: state.callId,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )
        return
      }

      await teardownRecoveryFailure('recover_active_call_failed')
    } finally {
      reconnectRecoveryInFlightRef.current = false
    }
  }, [
    armReconnectTimeout,
    assertCallSetupCurrent,
    beginCallSetup,
    clearReconnectTimeout,
    disposeMediaRuntime,
    invalidateCallSetup,
    postAnswerSetup,
    restartConnectedTransports,
    startTimer,
    teardownRecoveryFailure,
  ])

  const beginReconnectRecovery = useCallback(() => {
    const state = useCallStore.getState()

    if (
      !['active', 'reconnecting'].includes(state.phase) ||
      !state.callId ||
      !isAuthenticated ||
      !currentUserId ||
      reconnectRecoveryInFlightRef.current ||
      (state.phase === 'reconnecting' && reconnectModeRef.current !== 'peer')
    ) {
      return
    }

    telemetrySessionRef.current?.record('reconnect', { outcome: 'started' })
    stopTimer({ resetDuration: false })
    reconnectModeRef.current = 'local'

    const reconnectDeadlineMs = Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS
    useCallStore.getState().patch({
      phase: 'reconnecting',
      reconnectDeadlineMs,
    })

    armReconnectTimeout('reconnect_timeout')
  }, [armReconnectTimeout, currentUserId, isAuthenticated, stopTimer])

  const handlePeerReconnecting = useCallback(
    (payload: PeerReconnectingPayload) => {
      if (!isCurrentCall(payload.callId) || payload.userId === currentUserId) {
        return
      }

      const state = useCallStore.getState()
      if (state.phase !== 'active') {
        return
      }

      reconnectModeRef.current = 'peer'
      stopTimer({ resetDuration: false })
      clearRemoteAudioFallback()
      resetRemoteConsumerRuntime()
      useCallStore.getState().patch({
        phase: 'reconnecting',
        remoteAudioState: 'waiting',
        remoteStreamUrl: null,
        reconnectDeadlineMs: Date.parse(payload.reconnectDeadlineAt) || null,
      })

      const timeoutMs = Math.max(
        0,
        Date.parse(payload.reconnectDeadlineAt) - Date.now() || RECONNECT_RECOVERY_TIMEOUT_MS,
      )
      armReconnectTimeout('peer_reconnect_timeout', timeoutMs)
    },
    [
      armReconnectTimeout,
      clearRemoteAudioFallback,
      currentUserId,
      isCurrentCall,
      resetRemoteConsumerRuntime,
      stopTimer,
    ],
  )

  const handlePeerReconnected = useCallback(
    (payload: PeerReconnectedPayload) => {
      if (!isCurrentCall(payload.callId) || payload.userId === currentUserId) {
        return
      }

      if (reconnectModeRef.current !== 'peer') {
        return
      }

      const state = useCallStore.getState()
      if (state.phase !== 'reconnecting') {
        return
      }

      useCallStore.getState().patch({
        remoteAudioState: 'waiting',
        reconnectDeadlineMs: Date.now() + RECONNECT_RECOVERY_TIMEOUT_MS,
      })
      armReconnectTimeout('peer_audio_reconnect_timeout')
    },
    [armReconnectTimeout, currentUserId, isCurrentCall],
  )

  const rejectIncomingCall = useCallback(async () => {
    const state = useCallStore.getState()
    let socket = socketRef.current

    if (!socket?.connected && state.callId) {
      try {
        socket = await ensureCallSocketConnected(state.callId)
      } catch {
        socket = null
      }
    }

    if (socket?.connected && state.callId) {
      socket.emit('reject_call', {
        callId: state.callId,
      })
    }

    if (state.callId) {
      veloraSystemCalls.dismissIncomingCall(state.callId)
    }
    await teardownOnce('reject_incoming_call')
  }, [ensureCallSocketConnected, teardownOnce])

  const endCall = useCallback(
    async (reason?: string) => {
      const socket = socketRef.current
      const state = useCallStore.getState()

      if (!state.callId) {
        return
      }

      useCallStore.getState().patch({ phase: 'ending' })

      if (socket?.connected) {
        socket.emit('leave_call', {
          callId: state.callId,
          ...(reason ? { reason } : {}),
        })
      }

      await teardownOnce('end_call')
    },
    [teardownOnce],
  )

  const handleIncomingCall = useCallback(
    async (payload: IncomingCallPayload) => {
      if (!currentUserId) {
        return
      }

      const currentState = useCallStore.getState()

      if (currentState.callId === payload.callId) {
        return
      }

      if (payload.callType === 'VIDEO') {
        socketRef.current?.emit('reject_call', {
          callId: payload.callId,
          reason: 'unsupported_video',
        })
        presentError('Video calls are not supported yet')
        return
      }

      if (isBusyPhase(currentState.phase)) {
        socketRef.current?.emit('reject_call', {
          callId: payload.callId,
          reason: 'busy',
        })
        return
      }

      const peerInfo = getPeerInfoFromConversation({
        conversationId: payload.conversationId,
        currentUserId,
        fallbackPeerUserId: payload.initiatorId,
        queryClient,
      })
      const nativePayload = toNativeIncomingCallPayload(payload)

      activeCallIdRef.current = payload.callId
      callAnsweredRef.current = false
      routerRtpCapabilitiesRef.current = null
      useCallStore.getState().patch({
        phase: 'incoming_ringing',
        direction: 'incoming',
        callId: payload.callId,
        conversationId: payload.conversationId,
        peerUserId: peerInfo.peerUserId,
        peerName: payload.initiatorDisplayName || peerInfo.peerName || 'Unknown',
        peerAvatarUrl: payload.initiatorAvatarUrl ?? peerInfo.peerAvatarUrl,
        callType: payload.callType,
        muted: false,
        remoteAudioState: 'idle',
        remoteStreamUrl: null,
        reconnectDeadlineMs: null,
        error: null,
        durationSec: 0,
      })
      veloraSystemCalls.presentIncomingCall(nativePayload)
    },
    [currentUserId, presentError, queryClient],
  )

  const prepareIncomingCallFromState = useCallback(
    (callState: CallStateResponse) => {
      if (!currentUserId) {
        return false
      }

      const peerInfo = getPeerInfoFromConversation({
        conversationId: callState.conversationId,
        currentUserId,
        fallbackPeerUserId: callState.initiatorId,
        queryClient,
      })

      activeCallIdRef.current = callState.callId
      callAnsweredRef.current = false
      routerRtpCapabilitiesRef.current = null
      useCallStore.getState().patch({
        phase: 'incoming_ringing',
        direction: 'incoming',
        callId: callState.callId,
        conversationId: callState.conversationId,
        peerUserId: peerInfo.peerUserId,
        peerName: callState.initiatorDisplayName || peerInfo.peerName || 'Unknown',
        peerAvatarUrl: callState.initiatorAvatarUrl ?? peerInfo.peerAvatarUrl,
        callType: callState.callType,
        muted: false,
        remoteAudioState: 'idle',
        remoteStreamUrl: null,
        reconnectDeadlineMs: null,
        error: null,
        durationSec: 0,
      })

      return true
    },
    [currentUserId, queryClient],
  )

  const acceptIncomingCall = useCallback(
    async (source: 'native' | 'ui' = 'ui') => {
      const state = useCallStore.getState()
      let socket = socketRef.current
      const callId = state.callId

      if (!callId) {
        return
      }

      if (acceptingIncomingCallIdRef.current === callId) {
        return
      }
      acceptingIncomingCallIdRef.current = callId

      const telemetry = new CallTelemetrySession('incoming')
      telemetrySessionRef.current = telemetry
      telemetry.record('call_attempt', { outcome: 'started' })
      if (source === 'native') {
        telemetry.record('native_answer_received', { outcome: 'succeeded' })
      }

      try {
        const nativeAudioState = await veloraSystemCalls.getNativeAudioSessionState()
        debugCall(
          '[Call] audio_snapshot_loaded',
          JSON.stringify({ callId, source, nativeAudioState }),
        )
        telemetry.record('audio_snapshot_loaded', { outcome: 'succeeded' })
        if (nativeAudioState.isActivated && nativeAudioState.isAudioEnabled) {
          debugCall('[Call] audio_already_active', JSON.stringify({ callId, source }))
          telemetry.record('audio_already_active', { outcome: 'succeeded' })
        } else {
          telemetry.record('waiting_for_audio_activation', { outcome: 'started' })
        }
      } catch (error) {
        telemetry.record('audio_snapshot_loaded', { outcome: 'failed', error })
      }

      try {
        socket = await ensureCallSocketConnected(callId)
        telemetry.record('socket_connected', { outcome: 'succeeded' })
      } catch (error) {
        const errorCode = getAcceptIncomingCallFailureCode(error)
        telemetry.record('socket_connected', { outcome: 'failed', error })
        telemetry.record('accept_call_failed', { outcome: 'failed', error, errorCode })
        debugCall('[Call] accept_call_failed', JSON.stringify({ callId, errorCode }))
        await teardownOnce('accept_incoming_call_socket_failed', {
          errorMessage: 'Unable to set up the call',
          telemetryError: error,
          telemetryErrorCode: errorCode,
        })
        return
      }

      let hasPermission: boolean
      try {
        hasPermission = await ensureMicPermission()
      } catch (error) {
        const errorCode = getAcceptIncomingCallFailureCode(error)
        telemetry.record('microphone_permission', { outcome: 'failed', error })
        telemetry.record('accept_call_failed', { outcome: 'failed', error, errorCode })
        await teardownOnce('accept_incoming_call_permission_failed', {
          errorMessage: 'Velora needs microphone access to place calls',
          telemetryError: error,
          telemetryErrorCode: errorCode,
        })
        return
      }
      if (!hasPermission) {
        telemetry.record('microphone_permission', {
          outcome: 'failed',
          error: new Error('microphone permission denied'),
        })
        telemetry.record('accept_call_failed', {
          outcome: 'failed',
          error: new Error('microphone permission denied'),
          errorCode: 'server_rejected',
        })
        socket.emit('reject_call', {
          callId,
          reason: 'mic_permission_denied',
        })
        await teardownOnce('accept_incoming_call_permission_denied', {
          errorMessage: 'Velora needs microphone access to place calls',
          telemetryError: new Error('microphone permission denied'),
          telemetryErrorCode: 'server_rejected',
        })
        return
      }
      telemetry.record('microphone_permission', { outcome: 'succeeded' })

      let joinedCall = false

      try {
        const joined = await emitAndWaitForEvent<'join_call', 'call_joined'>(
          socket,
          'join_call',
          { callId },
          {
            event: 'call_joined',
            timeoutMs: CALL_JOINED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload) => payload.callId === callId,
          },
        )

        joinedCall = true
        telemetry.attachCall(joined.telemetryToken)
        telemetry.record('call_joined', { outcome: 'succeeded' })
        telemetry.record('accept_call_started', { outcome: 'started' })
        debugCall('[Call] accept_call_started', JSON.stringify({ callId, source }))

        await emitAndWaitForEvent<'answer_call', 'call_answered'>(
          socket,
          'answer_call',
          { callId },
          {
            event: 'call_answered',
            timeoutMs: CALL_JOINED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload) => payload.callId === callId,
          },
        )
        callAnsweredRef.current = true
        telemetry.record('accept_call_succeeded', { outcome: 'succeeded' })
        debugCall('[Call] accept_call_succeeded', JSON.stringify({ callId, source }))

        const setupToken = beginCallSetup()
        useCallStore.getState().patch({
          phase: 'connecting',
          remoteAudioState: 'idle',
          remoteStreamUrl: null,
          reconnectDeadlineMs: null,
        })
        router.push(`/call/${callId}` as never)

        debugCall('[Call] Waiting for configured native audio session...')
        const audioSessionConfiguration = await waitForConfiguredAudioSession(setupToken, callId)
        assertCallSetupCurrent(setupToken, callId)
        const audioRoute = toAudioRouteTelemetry(audioSessionConfiguration)
        telemetry.record('native_audio_configured', {
          outcome: 'succeeded',
          ...(audioRoute ? { details: { audioRoute } } : {}),
        })

        telemetry.record('media_setup_started', { outcome: 'started' })
        await postAnswerSetup(joined, { setupToken })
        assertCallSetupCurrent(setupToken, callId)
        if (!veloraSystemCalls.setCallActive(callId)) {
          throw new Error('Native call is no longer active')
        }
        telemetry.record('control_plane_active', { outcome: 'succeeded' })
      } catch (error) {
        if (isCallSetupCancelledError(error)) {
          return
        }

        const errorCode = getAcceptIncomingCallFailureCode(error)
        debugCall(
          '[Call] accept_call_failed',
          JSON.stringify({
            callId,
            errorCode,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )
        if (joinedCall && socket?.connected) {
          socket.emit('leave_call', {
            callId,
            reason: getRemoteSetupFailureReason(errorCode),
          })
        }
        telemetry.record('setup_failed', { outcome: 'failed', error, errorCode })
        telemetry.record('accept_call_failed', { outcome: 'failed', error, errorCode })
        await teardownOnce('accept_incoming_call_failed', {
          errorMessage: 'Unable to set up the call',
          telemetryError: error,
          telemetryErrorCode: errorCode,
        })
      }
    },
    [
      assertCallSetupCurrent,
      beginCallSetup,
      ensureMicPermission,
      ensureCallSocketConnected,
      postAnswerSetup,
      router,
      teardownOnce,
      waitForConfiguredAudioSession,
    ],
  )

  const startVoiceCall = useCallback(
    async (input: StartVoiceCallInput) => {
      if (!currentUserId || isBusyPhase(useCallStore.getState().phase)) {
        return
      }

      const telemetry = new CallTelemetrySession('outgoing')
      telemetrySessionRef.current = telemetry
      telemetry.record('call_attempt', { outcome: 'started' })

      let hasPermission: boolean
      try {
        hasPermission = await ensureMicPermission()
      } catch (error) {
        telemetry.record('microphone_permission', { outcome: 'failed', error })
        telemetry.terminal('start_voice_call_failed', error)
        telemetrySessionRef.current = null
        presentError('Velora needs microphone access to place calls')
        useCallStore.getState().patch({ phase: 'idle' })
        return
      }
      if (!hasPermission) {
        telemetry.record('microphone_permission', {
          outcome: 'failed',
          error: new Error('microphone permission denied'),
        })
        telemetry.terminal('start_voice_call_failed', new Error('microphone permission denied'))
        telemetrySessionRef.current = null
        presentError('Velora needs microphone access to place calls')
        useCallStore.getState().patch({ phase: 'idle' })
        return
      }

      try {
        const socket = await ensureSocketConnected()
        telemetry.record('socket_connected', { outcome: 'succeeded' })
        const joined = await emitAndWaitForEvent<'initiate_call', 'call_joined'>(
          socket,
          'initiate_call',
          {
            conversationId: input.conversationId,
            targetUserId: input.peerUserId,
            callType: 'VOICE',
          },
          {
            event: 'call_joined',
            timeoutMs: CALL_JOINED_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload) => payload.session.conversationId === input.conversationId,
          },
        )

        activeCallIdRef.current = joined.callId
        telemetry.attachCall(joined.telemetryToken)
        telemetry.record('call_joined', { outcome: 'succeeded' })
        callAnsweredRef.current = false
        veloraSystemCalls.registerOutgoingCall({
          callId: joined.callId,
          conversationId: input.conversationId,
          peerName: input.peerName ?? 'Unknown',
        })
        useCallStore.getState().patch({
          phase: 'outgoing_ringing',
          direction: 'outgoing',
          callId: joined.callId,
          conversationId: input.conversationId,
          peerUserId: input.peerUserId,
          peerName: input.peerName ?? 'Unknown',
          peerAvatarUrl: input.peerAvatarUrl ?? null,
          callType: 'VOICE',
          muted: false,
          remoteAudioState: 'idle',
          remoteStreamUrl: null,
          reconnectDeadlineMs: null,
          error: null,
          durationSec: 0,
        })
        router.push(`/call/${joined.callId}` as never)

        const answerWaitRegistry: CallWaitRegistry = new Set()
        let answerOutcome: 'answered' | 'ended' | 'rejected'
        const answerWaitTimeoutMs = getOutgoingRingWaitTimeoutMs(joined.noAnswerTimeoutMs)

        try {
          answerOutcome = await Promise.race([
            waitForEventWhere(socket, 'call_answered', {
              timeoutMs: answerWaitTimeoutMs,
              registry: answerWaitRegistry,
              filter: (payload: CallAnsweredPayload) => payload.callId === joined.callId,
            }).then(() => 'answered' as const),
            waitForEventWhere(socket, 'call_ended', {
              timeoutMs: answerWaitTimeoutMs,
              registry: answerWaitRegistry,
              filter: (payload) => payload.callId === joined.callId,
            }).then(() => 'ended' as const),
            waitForEventWhere(socket, 'call_rejected', {
              timeoutMs: answerWaitTimeoutMs,
              registry: answerWaitRegistry,
              filter: (payload) => payload.callId === joined.callId,
            }).then(() => 'rejected' as const),
          ])
        } finally {
          clearWaitRegistry(answerWaitRegistry)
        }

        if (answerOutcome !== 'answered') {
          return
        }

        callAnsweredRef.current = true
        const setupToken = beginCallSetup()
        useCallStore.getState().patch({ phase: 'connecting', reconnectDeadlineMs: null })

        debugCall('[Call] Waiting for configured native audio session...')
        const audioSessionConfiguration = await waitForConfiguredAudioSession(
          setupToken,
          joined.callId,
        )
        assertCallSetupCurrent(setupToken, joined.callId)
        const audioRoute = toAudioRouteTelemetry(audioSessionConfiguration)
        telemetry.record('native_audio_configured', {
          outcome: 'succeeded',
          ...(audioRoute ? { details: { audioRoute } } : {}),
        })

        await postAnswerSetup(joined, { setupToken })
        assertCallSetupCurrent(setupToken, joined.callId)
        if (!veloraSystemCalls.setCallActive(joined.callId)) {
          throw new Error('Native call is no longer active')
        }
        telemetry.record('control_plane_active', { outcome: 'succeeded' })
      } catch (error) {
        if (isCallSetupCancelledError(error)) {
          return
        }

        const activeCallId = activeCallIdRef.current
        if (socketRef.current?.connected && activeCallId) {
          socketRef.current.emit('leave_call', {
            callId: activeCallId,
            reason: 'timeout',
          })
        }
        telemetry.record('setup_failed', { outcome: 'failed', error })
        await teardownOnce('start_voice_call_failed', {
          errorMessage: 'Unable to set up the call',
        })
      }
    },
    [
      assertCallSetupCurrent,
      beginCallSetup,
      currentUserId,
      ensureMicPermission,
      ensureSocketConnected,
      postAnswerSetup,
      presentError,
      router,
      teardownOnce,
      waitForConfiguredAudioSession,
    ],
  )

  const processNativeCallAction = useCallback(
    async (action: NativeCallAction) => {
      if (
        completedNativeActionIdsRef.current.has(action.actionId) ||
        processingNativeActionIdsRef.current.has(action.actionId)
      ) {
        return
      }

      if (isLoading || !isAuthenticated || !currentUserId || !username?.trim()) {
        return
      }

      try {
        processingNativeActionIdsRef.current.add(action.actionId)

        let callState: CallStateResponse
        try {
          callState = await getCallState(action.callId)
        } catch (error) {
          if (isRetryableCallStateError(error)) {
            clearNativeActionRetryTimeout()
            nativeActionRetryTimeoutRef.current = setTimeout(() => {
              nativeActionRetryTimeoutRef.current = null
              const pendingAction = veloraSystemCalls.getPendingCallAction()

              if (pendingAction?.actionId === action.actionId) {
                void processNativeCallAction(pendingAction)
              }
            }, 1500)
            return
          }

          veloraSystemCalls.dismissIncomingCall(action.callId)
          completeNativeCallAction(action.actionId)
          return
        }

        if (callState.callType === 'VIDEO') {
          veloraSystemCalls.dismissIncomingCall(action.callId)
          completeNativeCallAction(action.actionId)
          return
        }

        if (
          callState.status === 'ended' ||
          callState.status === 'cancelled' ||
          callState.status === 'rejected'
        ) {
          if (isCurrentCall(action.callId)) {
            await teardownOnce('native_action_terminal_state')
          } else {
            veloraSystemCalls.dismissIncomingCall(action.callId)
          }
          completeNativeCallAction(action.actionId)
          return
        }

        if (action.action === 'answer') {
          if (callState.status !== 'initiated' && callState.status !== 'ringing') {
            veloraSystemCalls.dismissIncomingCall(action.callId)
            completeNativeCallAction(action.actionId)
            return
          }

          if (acceptingIncomingCallIdRef.current === action.callId) {
            completeNativeCallAction(action.actionId)
            return
          }

          if (prepareIncomingCallFromState(callState)) {
            await acceptIncomingCall('native')
          }
          completeNativeCallAction(action.actionId)
          return
        }

        if (action.action === 'end') {
          const state = useCallStore.getState()
          if (state.callId === action.callId && isBusyPhase(state.phase)) {
            await endCall('ended')
          } else if (callState.status === 'active') {
            const socket = await ensureCallSocketConnected(action.callId)
            socket.emit('leave_call', {
              callId: action.callId,
              reason: 'ended',
            })
            await teardownOnce('native_end_call')
          } else {
            veloraSystemCalls.dismissIncomingCall(action.callId)
          }

          completeNativeCallAction(action.actionId)
          return
        }

        if (callState.status === 'initiated' || callState.status === 'ringing') {
          prepareIncomingCallFromState(callState)
          await rejectIncomingCall()
        } else {
          veloraSystemCalls.dismissIncomingCall(action.callId)
        }

        completeNativeCallAction(action.actionId)
      } catch (error) {
        console.warn(
          '[Call] Failed to process native call action',
          JSON.stringify({
            callId: action.callId,
            action: action.action,
            actionId: action.actionId,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )
      } finally {
        processingNativeActionIdsRef.current.delete(action.actionId)
      }
    },
    [
      acceptIncomingCall,
      acceptingIncomingCallIdRef,
      clearNativeActionRetryTimeout,
      completeNativeCallAction,
      currentUserId,
      endCall,
      ensureCallSocketConnected,
      isAuthenticated,
      isCurrentCall,
      isLoading,
      prepareIncomingCallFromState,
      rejectIncomingCall,
      teardownOnce,
      username,
    ],
  )

  const processPendingNativeCallAction = useCallback(
    (source: 'auth_ready' | 'app_resume') => {
      const pendingAction = veloraSystemCalls.getPendingCallAction()
      if (!pendingAction) {
        return
      }

      debugCall(
        '[Call] pending_native_action_replayed',
        JSON.stringify({
          source,
          callId: pendingAction.callId,
          action: pendingAction.action,
          actionId: pendingAction.actionId,
        }),
      )
      void processNativeCallAction(pendingAction)
    },
    [processNativeCallAction],
  )

  const toggleMute = useCallback(() => {
    const localAudioTrack = localStreamRef.current?.getAudioTracks()[0]
    if (!localAudioTrack) {
      return
    }

    const nextMuted = !useCallStore.getState().muted
    localAudioTrack.enabled = !nextMuted
    useCallStore.getState().patch({ muted: nextMuted })
  }, [])

  const toggleSpeaker = useCallback(() => {
    const state = useCallStore.getState()
    if (state.phase !== 'active') {
      return
    }

    const nextSpeakerEnabled = !state.speakerEnabled
    if (!veloraSystemCalls.setSpeakerEnabled(nextSpeakerEnabled)) {
      console.warn('[Call] Failed to change speaker route')
      return
    }

    state.patch({ speakerEnabled: nextSpeakerEnabled })
  }, [])

  const dismissCallError = useCallback(() => {
    useCallStore.getState().patch({ error: null })
  }, [])

  useEffect(() => {
    if ((callPhase !== 'active' && callPhase !== 'reconnecting') || !callId) {
      return
    }

    const handlePageExit = () => {
      void leaveCallFromLifecycle('app_closed')
    }

    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return
    }

    window.addEventListener('pagehide', handlePageExit)
    window.addEventListener('beforeunload', handlePageExit)

    return () => {
      window.removeEventListener('pagehide', handlePageExit)
      window.removeEventListener('beforeunload', handlePageExit)
    }
  }, [callId, callPhase, leaveCallFromLifecycle])

  useEffect(() => {
    const subscription = veloraSystemCalls.addCallActionListener((action) => {
      void processNativeCallAction(action)
    })

    return () => {
      subscription.remove()
    }
  }, [processNativeCallAction])

  useEffect(() => {
    const subscription = veloraSystemCalls.addAudioSessionActivatedListener(
      (event: AudioSessionActivatedEvent) => {
        debugCall('[Call] Native audio session activated', JSON.stringify(event))
      },
    )

    return () => {
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    const subscription = veloraSystemCalls.addAudioSessionConfiguredListener(
      (event: AudioSessionConfiguredEvent) => {
        debugCall('[Call] Native audio session configured', JSON.stringify(event))
      },
    )

    return () => {
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return
      }

      // Notification/full-screen actions are persisted by the Android receiver before
      // MainActivity is brought forward. The live native event may be missed while JS is
      // suspended, so always replay the persisted action when the app becomes active.
      processPendingNativeCallAction('app_resume')

      const resumedCallId = activeCallIdRef.current ?? useCallStore.getState().callId
      if (!resumedCallId) {
        return
      }

      void veloraSystemCalls
        .getNativeAudioSessionState()
        .then((state) => {
          debugCall(
            '[Call] audio_snapshot_loaded',
            JSON.stringify({ callId: resumedCallId, source: 'app_resume', state }),
          )
          telemetrySessionRef.current?.record('audio_snapshot_loaded', { outcome: 'succeeded' })
        })
        .catch(() => undefined)
    })

    return () => {
      subscription.remove()
    }
  }, [processPendingNativeCallAction])

  useEffect(() => {
    void flushCallTelemetry()
    const interval = setInterval(() => {
      void flushCallTelemetry()
    }, 15_000)
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void flushCallTelemetry()
      }
    })

    return () => {
      clearInterval(interval)
      appStateSubscription.remove()
    }
  }, [])

  useEffect(() => {
    if (callPhase !== 'active' || !callId) {
      return
    }

    rtcQualityCountersRef.current = null
    void sampleRtcQuality()
    const interval = setInterval(() => {
      void sampleRtcQuality()
    }, RTC_QUALITY_SAMPLE_INTERVAL_MS)

    return () => {
      clearInterval(interval)
    }
  }, [callId, callPhase, sampleRtcQuality])

  useEffect(() => {
    if (isLoading || !isAuthenticated || !currentUserId || !username?.trim()) {
      return
    }

    processPendingNativeCallAction('auth_ready')
  }, [currentUserId, isAuthenticated, isLoading, processPendingNativeCallAction, username])

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!isAuthenticated || !currentUserId) {
      const pendingNativeAnswer = veloraSystemCalls.getPendingCallAction()?.action === 'answer'
      const authHydrationError = useAuthStore.getState().authHydrationError
      if (pendingNativeAnswer && authHydrationError === 'network') {
        return
      }

      socketRef.current?.removeAllListeners()
      socketRef.current?.disconnect()
      socketRef.current = null
      void teardownOnce('auth_lost')
      return
    }

    let socket: CallSocket

    try {
      socket = socketRef.current ?? createCallSocket()
    } catch (error) {
      presentError('Unable to set up the call')
      return
    }

    socketRef.current = socket

    const handleSocketReady = (payload?: CallSocketReadyPayload) => {
      callSocketAuthenticatedRef.current = true
      ;(payload?.recentTerminalCalls ?? []).forEach((terminalCall) => {
        handleTerminalCall(terminalCall, 'socket_ready_replay')
      })
    }

    const handleConnect = () => {
      if (
        useCallStore.getState().phase === 'reconnecting' &&
        reconnectModeRef.current === 'local'
      ) {
        void recoverActiveCall()
      }
    }

    const handleDisconnect = (reason: string) => {
      const state = useCallStore.getState()
      const { callId: disconnectedCallId, phase } = state
      callSocketAuthenticatedRef.current = false
      debugCall(
        '[Call] socket_disconnected',
        JSON.stringify({ callId: disconnectedCallId, reason }),
      )
      telemetrySessionRef.current?.record('socket_disconnected', {
        outcome: 'failed',
        errorCode: reason === 'io server disconnect' ? 'socket_auth_failed' : 'network_unavailable',
      })

      if (phase === 'reconnecting') {
        if (reconnectModeRef.current === 'peer') {
          beginReconnectRecovery()
        }
        return
      }

      if (phase === 'active') {
        beginReconnectRecovery()
        return
      }

      if (!isBusyPhase(phase) || !disconnectedCallId) {
        return
      }

      telemetrySessionRef.current?.record('socket_reconnect_started', { outcome: 'started' })
      debugCall(
        '[Call] socket_reconnect_started',
        JSON.stringify({ callId: disconnectedCallId, reason }),
      )
      clearSocketDisconnectGraceTimeout()
      socketDisconnectGraceTimeoutRef.current = setTimeout(() => {
        if (callSocketAuthenticatedRef.current || !isCurrentCall(disconnectedCallId)) {
          return
        }

        telemetrySessionRef.current?.record('socket_reconnect_failed', {
          outcome: 'failed',
          errorCode: 'reconnect_exhausted',
        })
        void teardownOnce('socket_disconnect_grace_expired', {
          errorMessage: 'The call was interrupted',
          telemetryError: new Error('reconnect_exhausted'),
          telemetryErrorCode: 'reconnect_exhausted',
        })
      }, SOCKET_DISCONNECT_GRACE_MS)

      void ensureCallSocketConnected(disconnectedCallId)
        .then(async (connectedSocket) => {
          await restorePreActiveCallMembership(connectedSocket, disconnectedCallId)
          clearSocketDisconnectGraceTimeout()
          telemetrySessionRef.current?.record('socket_reconnect_succeeded', {
            outcome: 'succeeded',
          })
          debugCall(
            '[Call] socket_reconnect_succeeded',
            JSON.stringify({ callId: disconnectedCallId }),
          )
          if (useCallStore.getState().phase === 'reconnecting') {
            void recoverActiveCall()
          }
        })
        .catch((error) => {
          telemetrySessionRef.current?.record('socket_reconnect_failed', {
            outcome: 'failed',
            error,
            errorCode: getAcceptIncomingCallFailureCode(error),
          })
        })
    }

    const handleCallRejected = (payload: CallRejectedPayload) => {
      if (!isCurrentCall(payload.callId)) {
        return
      }

      void teardownOnce('call_rejected', {
        errorMessage: getCallRejectedMessage(payload),
      })
    }

    const handleCallEnded = (payload: CallEndedPayload) => {
      handleTerminalCall(payload, 'live')
    }

    const handlePeerLeft = (payload: PeerLeftPayload) => {
      if (!isCurrentCall(payload.callId)) {
        return
      }

      clearPeerLeftFallback()
      peerLeftTimeoutRef.current = setTimeout(() => {
        void teardownOnce('peer_left', {
          errorMessage: 'The call was interrupted',
        })
      }, PEER_LEFT_GRACE_MS)
    }

    socket.on('connect', handleConnect)
    socket.on('call_socket_ready', handleSocketReady)
    socket.on('disconnect', handleDisconnect)
    socket.on('incoming_call', (payload) => {
      void handleIncomingCall(payload)
    })
    socket.on('new_producer', (payload) => {
      void consumeRemoteProducer(payload)
    })
    socket.on('call_answered', (payload) => {
      if (isCurrentCall(payload.callId)) {
        callAnsweredRef.current = true
      }
    })
    socket.on('call_rejected', handleCallRejected)
    socket.on('peer_reconnecting', handlePeerReconnecting)
    socket.on('peer_reconnected', handlePeerReconnected)
    socket.on('peer_left', handlePeerLeft)
    socket.on('call_ended', handleCallEnded)

    void ensureCallSocketConnected('runtime').catch(() => undefined)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('call_socket_ready', handleSocketReady)
      socket.off('disconnect', handleDisconnect)
      socket.off('call_rejected', handleCallRejected)
      socket.off('peer_reconnecting', handlePeerReconnecting)
      socket.off('peer_reconnected', handlePeerReconnected)
      socket.off('peer_left', handlePeerLeft)
      socket.off('call_ended', handleCallEnded)
      socket.off('incoming_call')
      socket.off('new_producer')
      socket.off('call_answered')
    }
  }, [
    consumeRemoteProducer,
    currentUserId,
    beginReconnectRecovery,
    clearSocketDisconnectGraceTimeout,
    handlePeerReconnected,
    handlePeerReconnecting,
    handleIncomingCall,
    handleTerminalCall,
    ensureCallSocketConnected,
    isAuthenticated,
    isCurrentCall,
    isLoading,
    presentError,
    recoverActiveCall,
    restorePreActiveCallMembership,
    teardownOnce,
    clearPeerLeftFallback,
  ])

  useEffect(() => {
    const waitRegistry = waitRegistryRef.current

    return () => {
      socketRef.current?.removeAllListeners()
      socketRef.current?.disconnect()
      socketRef.current = null
      clearSocketDisconnectGraceTimeout()
      callSocketPromisesRef.current.clear()
      socketConnectPromiseRef.current = null
      callSocketAuthenticatedRef.current = false
      stopTimer()
      clearNativeActionRetryTimeout()
      clearRemoteAudioFallback()
      clearPeerLeftFallback()
      clearWaitRegistry(waitRegistry)
    }
  }, [
    clearNativeActionRetryTimeout,
    clearPeerLeftFallback,
    clearRemoteAudioFallback,
    clearSocketDisconnectGraceTimeout,
    stopTimer,
  ])

  const value = useMemo<UseCallValue>(
    () => ({
      startVoiceCall,
      acceptIncomingCall,
      rejectIncomingCall,
      endCall,
      toggleMute,
      toggleSpeaker,
      dismissCallError,
    }),
    [
      acceptIncomingCall,
      dismissCallError,
      endCall,
      rejectIncomingCall,
      startVoiceCall,
      toggleMute,
      toggleSpeaker,
    ],
  )

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}
