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
import { createUuid } from '../uuid'

import { callLifecycleTelemetryStage, reduceCallLifecycle } from './callLifecycle'

import type { CallLifecycleState } from './callLifecycle'
import type { CallTelemetryOutboxItemModel } from '../../database/models/CallTelemetryOutboxItemModel'
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

const getHttpStatus = (error: unknown) => {
  if (!error || typeof error !== 'object') return null

  const response = (error as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : null
}

const isPermanentTelemetryError = (error: unknown) => {
  const status = getHttpStatus(error)
  return status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429
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
const ephemeralTelemetryTokens = new Map<string, string>()

const rememberEphemeralTelemetryToken = (event: CallTelemetryEvent) => {
  if (!event.telemetryToken) return

  ephemeralTelemetryTokens.set(event.eventId, event.telemetryToken)
  while (ephemeralTelemetryTokens.size > MAX_OUTBOX_EVENTS) {
    const oldestEventId = ephemeralTelemetryTokens.keys().next().value
    if (!oldestEventId) break
    ephemeralTelemetryTokens.delete(oldestEventId)
  }
}

const forgetEphemeralTelemetryTokens = (records: { event: CallTelemetryEvent }[]) => {
  for (const { event } of records) {
    ephemeralTelemetryTokens.delete(event.eventId)
  }
}

const withEphemeralTelemetryToken = (event: CallTelemetryEvent): CallTelemetryEvent => {
  const telemetryToken = ephemeralTelemetryTokens.get(event.eventId)
  return telemetryToken ? { ...event, telemetryToken } : event
}

const enqueue = (event: CallTelemetryEvent) => {
  const { telemetryToken: _telemetryToken, ...persistedEvent } = event
  rememberEphemeralTelemetryToken(event)

  queueWrite = queueWrite
    .then(async () => {
      const count = await getCallTelemetryOutboxCount()
      if (count >= MAX_OUTBOX_EVENTS) {
        const requiredSlots = count - MAX_OUTBOX_EVENTS + 1
        const dropped = await dropOldestCallTelemetryQualitySamples(requiredSlots)

        if (dropped < requiredSlots) {
          ephemeralTelemetryTokens.delete(event.eventId)
          return
        }
      }

      await insertCallTelemetryOutboxItems([
        {
          eventId: event.eventId,
          // Telemetry authorization is intentionally memory-only. A process
          // restart can still upload the sanitized event, but must never read
          // a bearer-like call token from the local database.
          payloadJson: JSON.stringify(persistedEvent),
          createdAt: Date.now(),
          retryCount: 0,
          lastAttemptedAt: null,
        },
      ])
    })
    .catch(() => {
      ephemeralTelemetryTokens.delete(event.eventId)
    })

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
      const parsedRecords: {
        record: CallTelemetryOutboxItemModel
        event: CallTelemetryEvent
      }[] = []
      const malformedRecords: CallTelemetryOutboxItemModel[] = []

      for (const record of records) {
        try {
          parsedRecords.push({
            record,
            event: JSON.parse(record.payloadJson) as CallTelemetryEvent,
          })
        } catch {
          malformedRecords.push(record)
        }
      }

      if (malformedRecords.length > 0) {
        await deleteCallTelemetryOutboxItems(malformedRecords)
      }

      if (parsedRecords.length === 0) {
        records = await getCallTelemetryOutboxItems(BATCH_SIZE)
      } else {
        try {
          await callTelemetryApi.track(
            parsedRecords.map(({ event }) => withEphemeralTelemetryToken(event)),
          )
          await deleteCallTelemetryOutboxItems(parsedRecords.map(({ record }) => record))
          forgetEphemeralTelemetryTokens(parsedRecords)
        } catch (error) {
          if (!isPermanentTelemetryError(error)) {
            await markCallTelemetryOutboxItemsAttempted(
              parsedRecords.map(({ record }) => record),
              Date.now(),
            )
            return false
          }

          for (const { record, event } of parsedRecords) {
            try {
              await callTelemetryApi.track([withEphemeralTelemetryToken(event)])
              await deleteCallTelemetryOutboxItems([record])
              forgetEphemeralTelemetryTokens([{ event }])
            } catch (singleEventError) {
              if (isPermanentTelemetryError(singleEventError)) {
                await deleteCallTelemetryOutboxItems([record])
                forgetEphemeralTelemetryTokens([{ event }])
                continue
              }

              await markCallTelemetryOutboxItemsAttempted([record], Date.now())
              return false
            }
          }
        }

        records = await getCallTelemetryOutboxItems(BATCH_SIZE)
      }
    }

    return true
  } finally {
    flushing = false
  }
}

export class CallTelemetrySession {
  readonly attemptId = createUuid()
  private readonly startedAt = nowMonotonic()
  private lifecycleState: CallLifecycleState = 'ringing'
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

  recordLifecycle(next: CallLifecycleState, options: StageOptions = {}) {
    this.lifecycleState = reduceCallLifecycle(this.lifecycleState, next)
    return this.record(callLifecycleTelemetryStage(this.lifecycleState), options)
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
