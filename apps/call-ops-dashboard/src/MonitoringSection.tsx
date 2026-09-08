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

const formatBytes = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  const mib = value / (1024 * 1024)
  if (mib < 1024) return `${mib.toFixed(mib >= 100 ? 0 : 1)} MB`
  return `${(mib / 1024).toFixed(2)} GB`
}

const formatBytesAxis = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  const mib = value / (1024 * 1024)
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GB` : `${mib.toFixed(0)} MB`
}

const formatCpu = (value: number) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'

const formatRate = (value: number) =>
  Number.isFinite(value) ? `${value.toFixed(value >= 10 ? 1 : 2)}/s` : '—'

const formatSeconds = (value: number) =>
  Number.isFinite(value)
    ? `${(value * 1000).toFixed(value >= 1 ? 0 : 1)} ms`
    : '—'

const formatPercent = (value: number) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—'

const formatSuccessRate = (errorRate: number) =>
  Number.isFinite(errorRate) ? `${((1 - errorRate) * 100).toFixed(2)}%` : '—'

const cpuBadge = (value: number) => {
  if (!Number.isFinite(value)) return { label: 'Waiting', tone: 'neutral' as Tone }
  if (value < 0.25) return { label: 'Light load', tone: 'good' as Tone }
  if (value < 0.75) return { label: 'Moderate', tone: 'neutral' as Tone }
  return { label: 'Busy', tone: 'warn' as Tone }
}

const responsivenessBadge = (seconds: number) => {
  const ms = seconds * 1000
  if (!Number.isFinite(ms)) return { label: 'Waiting', tone: 'neutral' as Tone }
  if (ms < 100) return { label: 'Responsive', tone: 'good' as Tone }
  if (ms < 250) return { label: 'Some delay', tone: 'warn' as Tone }
  return { label: 'Delayed', tone: 'bad' as Tone }
}

const successBadge = (errorRate: number) => {
  if (!Number.isFinite(errorRate)) return { label: 'Waiting', tone: 'neutral' as Tone }
  if (errorRate < 0.01) return { label: 'Healthy', tone: 'good' as Tone }
  if (errorRate < 0.05) return { label: 'Watch', tone: 'warn' as Tone }
  return { label: 'Needs attention', tone: 'bad' as Tone }
}

const getHealthSummary = (overview: MonitoringOverview | null) => {
  if (!overview) {
    return {
      tone: 'neutral' as Tone,
      title: 'Waiting for the first service check',
      detail: 'Prometheus is collecting the information needed for a simple health summary.',
    }
  }

  if (overview.service.up === null) {
    return {
      tone: 'neutral' as Tone,
      title: 'Service status is unavailable',
      detail: 'Prometheus returned no monitoring-service target sample, so the dashboard will not guess a healthy value.',
    }
  }

  if (!overview.service.up) {
    return {
      tone: 'bad' as Tone,
      title: 'Monitoring service is offline',
      detail: 'Prometheus can see the target, but cannot currently scrape monitoring-service.',
    }
  }

  const eventLoopMs =
    overview.process.eventLoopP99Seconds === null
      ? Number.NaN
      : overview.process.eventLoopP99Seconds * 1000
  const latencyMs =
    overview.rpc.p95LatencySeconds === null
      ? Number.NaN
      : overview.rpc.p95LatencySeconds * 1000
  const requestRate = overview.rpc.requestsPerSecond
  const errorRate = overview.rpc.errorRate ?? Number.NaN
  const hasTraffic = requestRate !== null && requestRate > 0.001

  if (
    errorRate >= 0.05 ||
    eventLoopMs >= 250 ||
    (hasTraffic && latencyMs >= 1000)
  ) {
    return {
      tone: 'bad' as Tone,
      title: 'The service needs attention',
      detail: 'The service is online, but errors or delays are high enough to investigate.',
    }
  }

  if (
    errorRate >= 0.01 ||
    eventLoopMs >= 100 ||
    (hasTraffic && latencyMs >= 500)
  ) {
    return {
      tone: 'warn' as Tone,
      title: 'The service is online, but worth watching',
      detail: 'No outage is detected, but response delay or request errors are elevated.',
    }
  }

  return {
    tone: 'good' as Tone,
    title: 'Everything looks healthy',
    detail: hasTraffic
      ? 'The monitoring service is online, requests are succeeding, and its runtime is responsive.'
      : 'The monitoring service is online and responsive. There is no internal monitoring traffic right now.',
  }
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
    metric: 'memory',
    title: 'Monitoring service memory',
    question: 'Is this service using more memory over time?',
    description: 'RAM used by the monitoring-service process only, not the whole Ubuntu server. A steady climb matters more than a single spike.',
    formatter: formatBytes,
    axisFormatter: formatBytesAxis,
    accent: '#7c3aed',
    fill: '#ede9fe',
    emptyTitle: 'No memory history yet',
    emptyDescription: 'Prometheus will fill this chart after it has collected a few samples from monitoring-service.',
  },
  {
    metric: 'cpu',
    title: 'Monitoring service CPU',
    question: 'How busy is this service?',
    description: 'Processor time used by the monitoring-service process only. This is not the total CPU usage of the Ubuntu server.',
    formatter: formatCpu,
    axisFormatter: formatCpu,
    accent: '#2563eb',
    fill: '#dbeafe',
    emptyTitle: 'No CPU history yet',
    emptyDescription: 'CPU samples will appear after Prometheus has observed monitoring-service for a short time.',
  },
  {
    metric: 'rpc_rate',
    title: 'Internal monitoring traffic',
    question: 'How many monitoring requests are arriving?',
    description: 'Internal monitoring requests handled each second. Zero is normal when nobody is using monitoring APIs.',
    formatter: formatRate,
    axisFormatter: formatRate,
    accent: '#0f766e',
    fill: '#ccfbf1',
    emptyTitle: 'No monitoring traffic yet',
    emptyDescription: 'This chart starts filling when the dashboard or another service calls the monitoring APIs.',
  },
  {
    metric: 'p95_rpc_latency',
    title: 'Monitoring response time',
    question: 'Are monitoring requests slowing down?',
    description: '95% of internal monitoring requests finish within this time. Lower is better.',
    formatter: formatSeconds,
    axisFormatter: formatSeconds,
    accent: '#c2410c',
    fill: '#ffedd5',
    emptyTitle: 'No response-time samples yet',
    emptyDescription: 'There is no request history to measure yet. This is expected when traffic is zero.',
  },
]

export function MonitoringSection() {
  const [overview, setOverview] = useState<MonitoringOverview | null>(null)
  const [history, setHistory] = useState<Partial<Record<MonitoringMetric, MonitoringPoint[]>>>({})
  const [rangeHours, setRangeHours] = useState<(typeof RANGE_OPTIONS)[number]['hours']>(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const selectedRange = useMemo(
    () => RANGE_OPTIONS.find((option) => option.hours === rangeHours) ?? RANGE_OPTIONS[0],
    [rangeHours],
  )

  const refreshMonitoring = useCallback(async (mode: RefreshMode, showLoading = false) => {
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
      setError(nextError instanceof Error ? nextError.message : 'Unable to load monitoring-service data')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [selectedRange])

  useEffect(() => {
    void refreshMonitoring('all', true)

    const overviewInterval = window.setInterval(() => {
      if (!document.hidden) void refreshMonitoring('overview')
    }, OVERVIEW_REFRESH_INTERVAL_MS)

    const historyInterval = window.setInterval(() => {
      if (!document.hidden) void refreshMonitoring('all')
    }, HISTORY_REFRESH_INTERVAL_MS)

    const handleVisibilityChange = () => {
      if (!document.hidden) void refreshMonitoring('all')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(overviewInterval)
      window.clearInterval(historyInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshMonitoring])

  const initialLoading = loading && overview === null && error === null
  const health = getHealthSummary(overview)
  const cpuState = cpuBadge(overview?.process.cpuSecondsPerSecond ?? Number.NaN)
  const successState = successBadge(overview?.rpc.errorRate ?? Number.NaN)
  const responsivenessState = responsivenessBadge(
    overview?.process.eventLoopP99Seconds ?? Number.NaN,
  )
  const serviceUp = overview?.service.up ?? null
  const requestRate = overview?.rpc.requestsPerSecond ?? null

  const cards = [
    {
      label: 'Service status',
      value: initialLoading ? 'Loading…' : serviceUp === true ? 'Online' : serviceUp === false ? 'Offline' : '—',
      helper: 'Can Prometheus reach monitoring-service?',
      badge: initialLoading ? 'Waiting' : serviceUp === true ? 'Reachable' : serviceUp === false ? 'Unreachable' : 'Waiting',
      tone: serviceUp === true ? 'good' : serviceUp === false ? 'bad' : 'neutral',
    },
    {
      label: 'Monitoring service memory',
      value: initialLoading ? 'Loading…' : formatBytes(overview?.process.residentMemoryBytes ?? Number.NaN),
      helper: 'RAM used by this service process only — not total server memory.',
      badge: initialLoading ? 'Waiting' : 'Service only',
      tone: 'neutral',
    },
    {
      label: 'Monitoring service CPU',
      value: initialLoading ? 'Loading…' : formatCpu(overview?.process.cpuSecondsPerSecond ?? Number.NaN),
      helper: 'CPU used by this service process only — not the whole server.',
      badge: initialLoading ? 'Waiting' : cpuState.label,
      tone: initialLoading ? 'neutral' : cpuState.tone,
    },
    {
      label: 'Internal traffic',
      value: initialLoading ? 'Loading…' : formatRate(overview?.rpc.requestsPerSecond ?? Number.NaN),
      helper: 'Monitoring requests handled each second.',
      badge: initialLoading ? 'Waiting' : requestRate === null ? 'Waiting' : requestRate <= 0.001 ? 'Idle' : 'Active',
      tone: 'neutral',
    },
    {
      label: 'Successful requests',
      value: initialLoading ? 'Loading…' : formatSuccessRate(overview?.rpc.errorRate ?? Number.NaN),
      helper: `Request success rate. Errors: ${initialLoading ? 'loading' : formatPercent(overview?.rpc.errorRate ?? Number.NaN)}.`,
      badge: initialLoading ? 'Waiting' : successState.label,
      tone: initialLoading ? 'neutral' : successState.tone,
    },
    {
      label: 'Service responsiveness',
      value: initialLoading ? 'Loading…' : formatSeconds(overview?.process.eventLoopP99Seconds ?? Number.NaN),
      helper: 'Delay before this Node.js service can react to incoming work. Lower is better.',
      badge: initialLoading ? 'Waiting' : responsivenessState.label,
      tone: initialLoading ? 'neutral' : responsivenessState.tone,
    },
  ] as const

  return (
    <section
      className="system-observability"
      aria-labelledby="system-observability-title"
      aria-busy={initialLoading}
    >
      <div className="system-toolbar">
        <div>
          <p className="eyebrow">Monitoring service · live</p>
          <h2 id="system-observability-title">How is Velora monitoring doing?</h2>
          <p className="section-description">
            These numbers describe the monitoring-service process only. Use the Server view for total Ubuntu host resources.
          </p>
        </div>
        <div className="monitoring-actions">
          <div className="range-switcher" aria-label="Monitoring history range">
            {RANGE_OPTIONS.map((option) => (
              <button
                className={option.hours === rangeHours ? 'range-button active' : 'range-button'}
                key={option.label}
                type="button"
                aria-label={option.accessibleLabel}
                title={option.accessibleLabel}
                onClick={() => setRangeHours(option.hours)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="secondary-button" type="button" onClick={() => void refreshMonitoring('all', true)}>
            Refresh now
          </button>
        </div>
      </div>

      {error && (
        <div className="monitoring-warning" role="status">
          <strong>Monitoring-service data is temporarily unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className={`health-summary ${initialLoading ? 'neutral' : health.tone}`}>
        <div className="health-summary-icon" aria-hidden="true">
          {initialLoading ? '…' : health.tone === 'good' ? '✓' : health.tone === 'bad' ? '!' : health.tone === 'warn' ? '!' : '…'}
        </div>
        <div className="health-summary-copy">
          <span>Quick read</span>
          <strong>{initialLoading ? 'Loading monitoring-service metrics…' : health.title}</strong>
          <p>{initialLoading ? 'Fetching the latest Prometheus overview and chart history. This normally takes only a moment.' : health.detail}</p>
        </div>
        <div className="health-summary-time">
          <span>Last checked</span>
          <strong>{overview ? new Date(overview.generatedAt).toLocaleTimeString() : initialLoading ? 'Loading…' : 'Waiting'}</strong>
        </div>
      </div>

      <div className="monitoring-scope-note" role="note">
        <div className="monitoring-scope-mark" aria-hidden="true">1</div>
        <div>
          <strong>You are looking at one Velora service, not the whole server.</strong>
          <p>
            Memory and CPU below belong to <b>monitoring-service</b> only. If memory says 109 MB, that means this service is using about 109 MB — your Ubuntu machine can still be using several GB overall.
          </p>
        </div>
        <span className="monitoring-scope-badge">See Server view for host totals</span>
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

      <div className="monitoring-explainer">
        <strong>How to read these charts</strong>
        <p>
          Every chart here is scoped to monitoring-service. Look for sudden jumps or a trend that keeps rising.
          Hover over a line to see the exact value and time. Empty traffic charts are normal when no monitoring requests are being made.
        </p>
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
        <summary>Technical details for monitoring-service</summary>
        <div>
          <span>JavaScript heap</span>
          <strong>{initialLoading ? 'Loading…' : formatBytes(overview?.process.heapUsedBytes ?? Number.NaN)}</strong>
        </div>
        <div>
          <span>RPC p95 latency</span>
          <strong>
            {initialLoading
              ? 'Loading…'
              : requestRate === null
                ? '—'
                : requestRate <= 0.001
                  ? 'No traffic'
                  : formatSeconds(overview?.rpc.p95LatencySeconds ?? Number.NaN)}
          </strong>
        </div>
        <div>
          <span>RPC error rate</span>
          <strong>{initialLoading ? 'Loading…' : formatPercent(overview?.rpc.errorRate ?? Number.NaN)}</strong>
        </div>
        <p>
          These technical values belong to monitoring-service. Whole-server CPU, RAM, swap, and disk are available in the separate Server view.
        </p>
      </details>
    </section>
  )
}
