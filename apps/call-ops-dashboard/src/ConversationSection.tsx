import { useCallback, useEffect, useMemo, useState } from 'react'

import { MonitoringChart } from './MonitoringChart'
import {
  fetchMonitoringOverview,
  fetchMonitoringTimeseries,
  type MonitoringMetric,
  type MonitoringOverview,
  type MonitoringPoint,
} from './monitoring'

const OVERVIEW_REFRESH_INTERVAL_MS = 15_000
const HISTORY_REFRESH_INTERVAL_MS = 60_000

const RANGE_OPTIONS = [
  { label: '1h', accessibleLabel: 'Last hour', hours: 1, stepSeconds: 60 },
  { label: '6h', accessibleLabel: 'Last 6 hours', hours: 6, stepSeconds: 180 },
  { label: '24h', accessibleLabel: 'Last 24 hours', hours: 24, stepSeconds: 300 },
] as const

type Tone = 'good' | 'warn' | 'bad' | 'neutral'
type RefreshMode = 'overview' | 'all'

const formatRate = (value: number) =>
  Number.isFinite(value) ? `${value.toFixed(value >= 10 ? 1 : 2)}/s` : '—'

const formatPercent = (value: number) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'

const formatSeconds = (value: number) =>
  Number.isFinite(value)
    ? `${(value * 1000).toFixed(value >= 1 ? 0 : 1)} ms`
    : '—'

const formatCpu = (value: number) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'

const formatBytes = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  const mib = value / (1024 * 1024)
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GB`
  return `${mib.toFixed(mib >= 100 ? 0 : 1)} MB`
}

const formatCount = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString() : '—'

const statusTone = (value: number | null, warn: number, bad: number): Tone => {
  if (value === null || !Number.isFinite(value)) return 'neutral'
  if (value >= bad) return 'bad'
  if (value >= warn) return 'warn'
  return 'good'
}

const SERIES: Array<{
  metric: MonitoringMetric
  title: string
  question: string
  description: string
  formatter: (value: number) => string
  axisFormatter: (value: number) => string
  accent: string
  fill: string
  emptyTitle: string
  emptyDescription: string
}> = [
  {
    metric: 'conversation_message_rate',
    title: 'New messages per second',
    question: 'How much real chat throughput is being created?',
    description: 'New user messages persisted per second. Idempotent retries are excluded.',
    formatter: formatRate,
    axisFormatter: formatRate,
    accent: '#45c9b8',
    fill: 'rgba(69, 201, 184, .10)',
    emptyTitle: 'No message throughput yet',
    emptyDescription: 'Send a few messages and Prometheus will begin building this history.',
  },
  {
    metric: 'conversation_send_rate',
    title: 'send_message requests per second',
    question: 'How many chat send operations are hitting the service?',
    description: 'All send_message attempts, including successful, rejected, and failed requests.',
    formatter: formatRate,
    axisFormatter: formatRate,
    accent: '#7f8dff',
    fill: 'rgba(127, 141, 255, .12)',
    emptyTitle: 'No send_message traffic yet',
    emptyDescription: 'This chart appears after the service receives chat send operations.',
  },
  {
    metric: 'conversation_p95_send_latency',
    title: 'send_message p95 latency',
    question: 'How quickly does chat accept and fan out messages?',
    description: '95% of successful synchronous send_message handling completes within this duration.',
    formatter: formatSeconds,
    axisFormatter: formatSeconds,
    accent: '#f59a62',
    fill: 'rgba(245, 154, 98, .10)',
    emptyTitle: 'No latency samples yet',
    emptyDescription: 'Latency history requires successful send_message traffic.',
  },
  {
    metric: 'conversation_sockets',
    title: 'Active Socket.IO connections',
    question: 'How many realtime clients are connected?',
    description: 'Current Socket.IO clients across the scraped conversation-service instances.',
    formatter: formatCount,
    axisFormatter: formatCount,
    accent: '#64c7ff',
    fill: 'rgba(100, 199, 255, .10)',
    emptyTitle: 'No socket samples yet',
    emptyDescription: 'Prometheus will populate this chart after collecting conversation-service samples.',
  },
]

export function ConversationSection() {
  const [overview, setOverview] = useState<MonitoringOverview | null>(null)
  const [history, setHistory] = useState<Partial<Record<MonitoringMetric, MonitoringPoint[]>>>({})
  const [rangeHours, setRangeHours] = useState<(typeof RANGE_OPTIONS)[number]['hours']>(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const selectedRange = useMemo(
    () => RANGE_OPTIONS.find((option) => option.hours === rangeHours) ?? RANGE_OPTIONS[0],
    [rangeHours],
  )

  const refreshConversation = useCallback(async (mode: RefreshMode, showLoading = false) => {
    if (showLoading) setLoading(true)

    try {
      if (mode === 'overview') {
        setOverview(await fetchMonitoringOverview())
      } else {
        const to = new Date()
        const from = new Date(to.getTime() - selectedRange.hours * 60 * 60 * 1000)
        const [nextOverview, ...series] = await Promise.all([
          fetchMonitoringOverview(),
          ...SERIES.map(({ metric }) =>
            fetchMonitoringTimeseries({
              metric,
              from: from.toISOString(),
              to: to.toISOString(),
              stepSeconds: selectedRange.stepSeconds,
            }),
          ),
        ])

        const nextHistory: Partial<Record<MonitoringMetric, MonitoringPoint[]>> = {}
        for (const item of series) nextHistory[item.metric] = item.points
        setOverview(nextOverview)
        setHistory(nextHistory)
      }

      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load conversation-service metrics')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [selectedRange])

  useEffect(() => {
    void refreshConversation('all', true)

    const overviewInterval = window.setInterval(() => {
      if (!document.hidden) void refreshConversation('overview')
    }, OVERVIEW_REFRESH_INTERVAL_MS)

    const historyInterval = window.setInterval(() => {
      if (!document.hidden) void refreshConversation('all')
    }, HISTORY_REFRESH_INTERVAL_MS)

    const handleVisibilityChange = () => {
      if (!document.hidden) void refreshConversation('all')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(overviewInterval)
      window.clearInterval(historyInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshConversation])

  const conversation = overview?.conversation
  const initialLoading = loading && overview === null && error === null
  const serviceUp = conversation?.up ?? null
  const successRate = conversation?.successRate ?? null
  const rejectRate = conversation?.rejectRate ?? null
  const errorRate = conversation?.errorRate ?? null
  const p95Latency = conversation?.p95SendLatencySeconds ?? null
  const sendRequestsPerSecond = conversation?.sendRequestsPerSecond ?? null
  const hasTraffic = sendRequestsPerSecond !== null && sendRequestsPerSecond > 0.001

  const reliabilityTone: Tone = serviceUp !== true
    ? serviceUp === false ? 'bad' : 'neutral'
    : !hasTraffic
      ? 'neutral'
      : statusTone((rejectRate ?? 0) + (errorRate ?? 0), 0.01, 0.05)

  const cards = [
    {
      label: 'Service status',
      value: initialLoading ? 'Loading…' : serviceUp === true ? 'Online' : serviceUp === false ? 'Offline' : '—',
      helper: 'Can Prometheus scrape conversation-service?',
      badge: initialLoading ? 'Waiting' : serviceUp === true ? 'Reachable' : serviceUp === false ? 'Unreachable' : 'Waiting',
      tone: serviceUp === true ? 'good' : serviceUp === false ? 'bad' : 'neutral',
    },
    {
      label: 'Active sockets',
      value: initialLoading ? 'Loading…' : formatCount(conversation?.socketConnections ?? Number.NaN),
      helper: 'Realtime Socket.IO clients currently connected.',
      badge: initialLoading ? 'Waiting' : 'Live',
      tone: 'neutral',
    },
    {
      label: 'New messages',
      value: initialLoading ? 'Loading…' : formatRate(conversation?.messagesPerSecond ?? Number.NaN),
      helper: 'Persisted user messages, excluding idempotent retries.',
      badge: initialLoading ? 'Waiting' : hasTraffic ? 'Active' : 'Idle',
      tone: 'neutral',
    },
    {
      label: 'Send requests',
      value: initialLoading ? 'Loading…' : formatRate(sendRequestsPerSecond ?? Number.NaN),
      helper: 'All incoming send_message attempts.',
      badge: initialLoading ? 'Waiting' : hasTraffic ? 'Active' : 'Idle',
      tone: 'neutral',
    },
    {
      label: 'Successful sends',
      value: initialLoading ? 'Loading…' : hasTraffic ? formatPercent(successRate ?? Number.NaN) : 'No traffic',
      helper: 'Share of send_message requests handled successfully.',
      badge: initialLoading ? 'Waiting' : !hasTraffic ? 'Idle' : (successRate ?? 0) >= 0.99 ? 'Healthy' : 'Watch',
      tone: initialLoading || !hasTraffic ? 'neutral' : (successRate ?? 0) >= 0.99 ? 'good' : 'warn',
    },
    {
      label: 'Rejected sends',
      value: initialLoading ? 'Loading…' : hasTraffic ? formatPercent(rejectRate ?? Number.NaN) : 'No traffic',
      helper: 'Invalid/auth/member checks rejected before message creation.',
      badge: initialLoading ? 'Waiting' : !hasTraffic ? 'Idle' : (rejectRate ?? 0) < 0.01 ? 'Low' : 'Watch',
      tone: initialLoading || !hasTraffic ? 'neutral' : statusTone(rejectRate, 0.01, 0.05),
    },
    {
      label: 'Send errors',
      value: initialLoading ? 'Loading…' : hasTraffic ? formatPercent(errorRate ?? Number.NaN) : 'No traffic',
      helper: 'Unexpected send_message failures after validation.',
      badge: initialLoading ? 'Waiting' : !hasTraffic ? 'Idle' : (errorRate ?? 0) < 0.01 ? 'Low' : 'Watch',
      tone: initialLoading || !hasTraffic ? 'neutral' : statusTone(errorRate, 0.01, 0.05),
    },
    {
      label: 'p95 send latency',
      value: initialLoading ? 'Loading…' : hasTraffic ? formatSeconds(p95Latency ?? Number.NaN) : 'No traffic',
      helper: 'Synchronous handling time for successful send_message requests.',
      badge: initialLoading ? 'Waiting' : !hasTraffic ? 'Idle' : (p95Latency ?? 0) < 0.25 ? 'Fast' : 'Watch',
      tone: initialLoading || !hasTraffic ? 'neutral' : statusTone(p95Latency, 0.25, 0.75),
    },
  ] as const

  return (
    <section
      className="system-observability"
      aria-labelledby="conversation-observability-title"
      aria-busy={initialLoading}
    >
      <div className="system-toolbar">
        <div>
          <p className="eyebrow">Conversation service · realtime</p>
          <h2 id="conversation-observability-title">Chat service performance</h2>
          <p className="section-description">
            Message throughput, send reliability, latency, socket connections, and runtime health from conversation-service.
          </p>
        </div>
        <div className="monitoring-actions">
          <div className="range-switcher" aria-label="Conversation history range">
            {RANGE_OPTIONS.map((option) => (
              <button
                className={option.hours === rangeHours ? 'range-button active' : 'range-button'}
                key={option.label}
                type="button"
                aria-label={option.accessibleLabel}
                onClick={() => setRangeHours(option.hours)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="secondary-button" type="button" onClick={() => void refreshConversation('all', true)}>
            Refresh now
          </button>
        </div>
      </div>

      {error && (
        <div className="monitoring-warning" role="status">
          <strong>Conversation metrics are temporarily unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className={`health-summary ${reliabilityTone}`}>
        <div className="health-summary-icon" aria-hidden="true">
          {serviceUp === null ? '…' : reliabilityTone === 'good' ? '✓' : reliabilityTone === 'neutral' ? '…' : '!'}
        </div>
        <div className="health-summary-copy">
          <span>Quick read</span>
          <strong>
            {initialLoading
              ? 'Loading conversation-service metrics…'
              : serviceUp === false
                ? 'Conversation service is offline'
                : serviceUp === null
                  ? 'Conversation-service status is unavailable'
                  : !hasTraffic
                    ? 'Conversation service is online and idle'
                    : reliabilityTone === 'good'
                      ? 'Chat traffic is healthy'
                      : 'Chat traffic needs attention'}
          </strong>
          <p>
            {initialLoading
              ? 'Fetching the latest Prometheus overview and chart history. This normally takes only a moment.'
              : serviceUp === true
                ? 'Use message rate and p95 latency together when comparing one, two, and three replicas during load tests.'
                : 'Prometheus must be able to scrape conversation-service before throughput and latency can be trusted.'}
          </p>
        </div>
        <div className="health-summary-time">
          <span>Last checked</span>
          <strong>{overview ? new Date(overview.generatedAt).toLocaleTimeString() : initialLoading ? 'Loading…' : 'Waiting'}</strong>
        </div>
      </div>

      <div className="friendly-metric-grid" aria-busy={loading}>
        {cards.map((card) => (
          <article className="friendly-metric-card" key={card.label}>
            <div className="friendly-metric-topline">
              <span>{card.label}</span>
              <i className={`metric-badge ${card.tone}`}>{card.badge}</i>
            </div>
            <strong>{card.value}</strong>
            <p>{card.helper}</p>
          </article>
        ))}
      </div>

      <div className="monitoring-grid">
        {SERIES.map((series) => (
          <MonitoringChart
            key={series.metric}
            points={history[series.metric] ?? []}
            title={series.title}
            question={series.question}
            description={series.description}
            valueFormatter={series.formatter}
            axisFormatter={series.axisFormatter}
            accent={series.accent}
            fill={series.fill}
            emptyTitle={series.emptyTitle}
            emptyDescription={series.emptyDescription}
            loading={loading}
          />
        ))}
      </div>

      <details className="technical-details">
        <summary>Conversation-service runtime details</summary>
        <div>
          <span>Process memory</span>
          <strong>{initialLoading ? 'Loading…' : formatBytes(conversation?.residentMemoryBytes ?? Number.NaN)}</strong>
        </div>
        <div>
          <span>Process CPU</span>
          <strong>{initialLoading ? 'Loading…' : formatCpu(conversation?.cpuSecondsPerSecond ?? Number.NaN)}</strong>
        </div>
        <div>
          <span>Event-loop p99</span>
          <strong>{initialLoading ? 'Loading…' : formatSeconds(conversation?.eventLoopP99Seconds ?? Number.NaN)}</strong>
        </div>
        <p>
          These runtime values are aggregated across the currently scraped conversation-service instances. They become especially useful once k3s starts scaling replicas.
        </p>
      </details>
    </section>
  )
}
