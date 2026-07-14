import Constants from 'expo-constants'
import { Platform } from 'react-native'

import { callTelemetryApi } from '../../api/callTelemetry.api'
import {
  deleteCallTelemetryOutboxItems,
  dropOldestCallTelemetryQualitySamples,
  getCallTelemetryOutboxCount,
  getCallTelemetryOutboxItems,
  insertCallTelemetryOutboxItems,
  markCallTelemetryOutboxItemsAttempted,
} from '../../database/calls/callTelemetryOutbox'
import { getIsOnline } from '../network'

import type { CallDirection } from '../../types/call.types'

const MAX_OUTBOX_EVENTS = 2000
const BATCH_SIZE = 50

export type CallTelemetryMetrics = {
  packetLossRate?: number | null
  jitterMs?: number | null
  roundTripTimeMs?: number | null
  concealmentRate?: number | null
  jitterBufferDelayMs?: number | null
  packetsReceivedDelta?: number | null
  bytesReceivedDelta?: number | null
}

export type CallTelemetryAudioRoute = {
  category: 'play_and_record' | 'other'
  mode: 'voice_chat' | 'other'
  outputRouteTypes: (
    | 'receiver'
    | 'speaker'
    | 'bluetooth_hfp'
    | 'bluetooth_a2dp'
    | 'bluetooth_le'
    | 'headphones'
    | 'airplay'
    | 'car_audio'
    | 'usb_audio'
    | 'line_out'
    | 'other'
  )[]
  inputRouteTypes: (
    | 'receiver'
    | 'speaker'
    | 'bluetooth_hfp'
    | 'bluetooth_a2dp'
    | 'bluetooth_le'
    | 'headphones'
    | 'airplay'
    | 'car_audio'
    | 'usb_audio'
    | 'line_out'
    | 'other'
  )[]
  forcedSpeaker: boolean
}

export type CallTelemetryDetails = {
  audioRoute: CallTelemetryAudioRoute
}

export type CallTelemetryEvent = {
  eventId: string
  attemptId: string
  telemetryToken?: string
  eventType: 'setup_stage' | 'quality_sample' | 'terminal'
  stage: string
  outcome?: 'started' | 'succeeded' | 'failed' | 'ended'
  elapsedMs: number
  occurredAt: string
  platform: 'ios' | 'android' | 'web'
  appVersion: string
  osVersion?: string
  direction?: CallDirection
  errorCode?: string
  metrics?: CallTelemetryMetrics
  details?: CallTelemetryDetails
}

type StageOptions = {
  outcome?: CallTelemetryEvent['outcome']
  error?: unknown
  errorCode?: string
  eventType?: CallTelemetryEvent['eventType']
  metrics?: CallTelemetryMetrics
  details?: CallTelemetryDetails
}

const nowMonotonic = () => globalThis.performance?.now?.() ?? Date.now()

const createUuid = () => {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const getPlatform = (): CallTelemetryEvent['platform'] => {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return Platform.OS
  }

  return 'web'
}

const normalizeErrorCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/timed out|timeout/i.test(message)) return 'timeout'
  if (/permission/i.test(message)) return 'mic_permission_denied'
  if (/audio session/i.test(message)) return 'audio_session_not_ready'
  if (/socket|connect/i.test(message)) return 'socket_connection_failed'
  if (/consumer/i.test(message)) return 'consumer_setup_failed'
  if (/transport/i.test(message)) return 'transport_setup_failed'
  if (/media|track|producer/i.test(message)) return 'local_media_failed'
  return 'unknown_error'
}

let queueWrite = Promise.resolve()
let flushing = false

const enqueue = (event: CallTelemetryEvent) => {
  queueWrite = queueWrite
    .then(async () => {
      const count = await getCallTelemetryOutboxCount()
      if (count >= MAX_OUTBOX_EVENTS) {
        const requiredSlots = count - MAX_OUTBOX_EVENTS + 1
        const dropped = await dropOldestCallTelemetryQualitySamples(requiredSlots)

        if (dropped < requiredSlots) {
          return
        }
      }

      await insertCallTelemetryOutboxItems([
        {
          eventId: event.eventId,
          payloadJson: JSON.stringify(event),
          createdAt: Date.now(),
          retryCount: 0,
          lastAttemptedAt: null,
        },
      ])
    })
    .catch(() => undefined)

  return queueWrite
}

export const flushCallTelemetry = async () => {
  if (flushing) {
    return false
  }

  flushing = true
  try {
    await queueWrite
    if (!(await getIsOnline())) {
      return false
    }

    let records = await getCallTelemetryOutboxItems(BATCH_SIZE)
    while (records.length > 0) {
      const events = records.flatMap((record) => {
        try {
          return [JSON.parse(record.payloadJson) as CallTelemetryEvent]
        } catch {
          return []
        }
      })

      if (events.length === 0) {
        await deleteCallTelemetryOutboxItems(records)
      } else {
        try {
          await callTelemetryApi.track(events)
          await deleteCallTelemetryOutboxItems(records)
        } catch {
          await markCallTelemetryOutboxItemsAttempted(records, Date.now())
          return false
        }
      }

      records = await getCallTelemetryOutboxItems(BATCH_SIZE)
    }

    return true
  } finally {
    flushing = false
  }
}

export class CallTelemetrySession {
  readonly attemptId = createUuid()
  private readonly startedAt = nowMonotonic()
  private telemetryToken: string | undefined

  constructor(private readonly direction: CallDirection) {}

  attachCall(telemetryToken?: string) {
    this.telemetryToken = telemetryToken
  }

  record(stage: string, options: StageOptions = {}) {
    const event: CallTelemetryEvent = {
      eventId: createUuid(),
      attemptId: this.attemptId,
      ...(this.telemetryToken ? { telemetryToken: this.telemetryToken } : {}),
      eventType: options.eventType ?? 'setup_stage',
      stage,
      ...(options.outcome ? { outcome: options.outcome } : {}),
      elapsedMs: Math.max(0, Math.round(nowMonotonic() - this.startedAt)),
      occurredAt: new Date().toISOString(),
      platform: getPlatform(),
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      ...(Platform.Version ? { osVersion: String(Platform.Version) } : {}),
      direction: this.direction,
      ...(options.errorCode
        ? { errorCode: options.errorCode }
        : options.error
          ? { errorCode: normalizeErrorCode(options.error) }
          : {}),
      ...(options.metrics ? { metrics: options.metrics } : {}),
      ...(options.details ? { details: options.details } : {}),
    }

    void enqueue(event)
    return event
  }

  terminal(stage: string, error?: unknown, errorCode?: string) {
    const event = this.record(stage, {
      eventType: 'terminal',
      outcome: error ? 'failed' : 'ended',
      ...(error ? { error } : {}),
      ...(errorCode ? { errorCode } : {}),
    })
    void flushCallTelemetry()
    return event
  }
}
