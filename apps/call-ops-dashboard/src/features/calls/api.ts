import { fetchApi } from '../../shared/api/client'

export type CallSummary = {
  attempts: number
  controlPlaneSuccessRate: number | null
  mediaReadySuccessRate: number | null
  timeToControlPlaneActiveMs: { p50: number | null; p95: number | null }
  timeToFirstRemoteAudioMs: { p50: number | null; p95: number | null }
  failures: Record<string, number>
  quality: {
    samples: number
    packetLossRate: number | null
    jitterMs: number | null
    roundTripTimeMs: number | null
    concealmentRate: number | null
    jitterBufferDelayMs: number | null
    badSampleRate: number | null
  }
}

export type CallTimelineEvent = {
  eventId: string
  role: string | null
  eventType: string
  stage: string
  outcome: string | null
  elapsedMs: number
  occurredAt: string
  platform: string
  appVersion: string
  errorCode: string | null
  metricsJson: Record<string, unknown> | null
}

export type RecentCallLeg = {
  callId: string
  attemptId: string
  role: string | null
  platform: string
  appVersion: string
  direction: string | null
  startedAt: string
  lastOccurredAt: string
  controlPlaneActive: boolean
  mediaReady: boolean
  failure: { stage: string; errorCode: string | null } | null
}

export type CallTelemetryFilters = {
  from: string
  to: string
  platform: string
  osVersion: string
  appVersion: string
  direction: string
}

export const isoDate = (date: Date) => date.toISOString().slice(0, 10)

export const defaultCallTelemetryFilters = (): CallTelemetryFilters => ({
  from: isoDate(new Date(Date.now() - 24 * 60 * 60 * 1000)),
  to: isoDate(new Date()),
  platform: '',
  osVersion: '',
  appVersion: '',
  direction: '',
})

const telemetrySearch = (filters: CallTelemetryFilters) =>
  new URLSearchParams({
    from: `${filters.from}T00:00:00.000Z`,
    to: `${filters.to}T23:59:59.999Z`,
    ...(filters.platform ? { platform: filters.platform } : {}),
    ...(filters.osVersion ? { osVersion: filters.osVersion } : {}),
    ...(filters.appVersion ? { appVersion: filters.appVersion } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
  })

export const fetchCallSummary = async (filters: CallTelemetryFilters) => {
  const response = await fetchApi(`/calls/telemetry/summary?${telemetrySearch(filters)}`)
  if (!response.ok) throw new Error('Unable to load call telemetry')
  return (await response.json()) as CallSummary
}

export const fetchRecentCallLegs = async (filters: CallTelemetryFilters) => {
  const response = await fetchApi(`/calls/telemetry/calls?${telemetrySearch(filters)}`)
  if (!response.ok) throw new Error('Unable to load recent call legs')
  return (await response.json()) as RecentCallLeg[]
}

export const fetchCallTimeline = async (callId: string) => {
  const response = await fetchApi(`/calls/telemetry/calls/${encodeURIComponent(callId.trim())}`)
  if (!response.ok) throw new Error('Call telemetry was not found')
  return (await response.json()) as CallTimelineEvent[]
}

export const percent = (value: number | null) =>
  value === null ? '—' : `${(value * 100).toFixed(1)}%`

export const milliseconds = (value: number | null) =>
  value === null ? '—' : `${Math.round(value)} ms`

export const formatTimelineMetrics = (value: Record<string, unknown> | null) => {
  if (!value) return '—'
  const entries = Object.entries(value).filter(([, metric]) => metric !== null)
  if (entries.length === 0) return '—'

  return entries
    .map(([name, metric]) => {
      if (typeof metric === 'number') return `${name}: ${metric.toFixed(3)}`
      return `${name}: ${JSON.stringify(metric)}`
    })
    .join(' · ')
}
