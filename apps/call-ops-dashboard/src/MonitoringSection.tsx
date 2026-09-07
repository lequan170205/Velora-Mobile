import { useCallback, useEffect, useMemo, useState } from 'react'

import { MonitoringChart } from './MonitoringChart'
import {
  fetchMonitoringOverview,
  fetchMonitoringTimeseries,
  type MonitoringMetric,
  type MonitoringOverview,
  type MonitoringPoint,
} from './monitoring'

const REFRESH_INTERVAL_MS = 15_000

const RANGE_OPTIONS = [
  { label: '1h', accessibleLabel: 'Last hour', hours: 1, stepSeconds: 60 },
  { label: '6h', accessibleLabel: 'Last 6 hours', hours: 6, stepSeconds: 180 },
  { label: '24h', accessibleLabel: 'Last 24 hours', hours: 24, stepSeconds: 300 },
] as const

type Tone = 'good' | 'warn' | 'bad' | 'neutral'

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
      title: 'Waiting for the first system check',
      detail: 'Prometheus is collecting the information needed for a simple health summary.',
    }
  }

  if (!overview.service.up) {
    return {
      tone: 'bad' as Tone,
      title: 'Monitoring service is offline',
      detail: 'Prometheus cannot reach the monitoring service right now.',
    }
  }

  const eventLoopMs = overview.process.eventLoopP99Seconds * 1000
  const latencyMs = overview.rpc.p95LatencySeconds * 1000
  const hasTraffic = overview.rpc.requestsPerSecond > 0.001

  if (
    overview.rpc.errorRate >= 0.05 ||
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
    overview.rpc.errorRate >= 0.01 ||
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
      ? 'The service is online, requests are succeeding, and the runtime is responsive.'
      : 'The service is online and responsive. There is no internal monitoring traffic right now.',
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
    title: 'Memory use',
    question: 'Is memory growing over time?',
    description: 'Total RAM used by the monitoring service. A steady climb is more important than a single spike.',
    formatter: formatBytes,
    axisFormatter: formatBytesAxis,
    accent: '#7c3aed',
    fill: '#ede9fe',
    emptyTitle: 'No memory history yet',
    emptyDescription: 'Prometheus will fill this chart after it has collected a few samples.',
  },
  {
    metric: 'cpu',
    title: 'CPU load',
    question: 'How busy is the monitoring service?',
    description: 'Shows how much processor time the monitoring process is using. Lower means more spare capacity.',
    formatter: formatCpu,
    axisFormatter: formatCpu,
    accent: '#2563eb',
    fill: '#dbeafe',
    emptyTitle: 'No CPU history yet',
    emptyDescription: 'CPU samples will appear after Prometheus has observed the service for a short time.',
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

  const loadMonitoring = useCallback(async () => {
    setError(null)
    try {
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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load system monitoring')
    } finally {
      setLoading(false)
    }
  }, [selectedRange])

  useEffect(() => {
    setLoading(true)
    void loadMonitoring()
    const interval = window.setInterval(() => void loadMonitoring(), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [loadMonitoring])

  const health = getHealthSummary(overview)
  const cpuState = cpuBadge(overview?.process.cpuSecondsPerSecond ?? Number.NaN)
  const successState = successBadge(overview?.rpc.errorRate ?? Number.NaN)
  const responsivenessState = responsivenessBadge(
    overview?.process.eventLoopP99Seconds ?? Number.NaN,
  )

  const cards = [
    {
      label: 'Service status',
      value: overview ? (overview.service.up ? 'Online' : 'Offline') : '—',
      helper: 'Can Prometheus reach the monitoring service?',
      badge: overview ? (overview.service.up ? 'Reachable' : 'Unreachable') : 'Waiting',
      tone: overview ? (overview.service.up ? 'good' : 'bad') : 'neutral',
    },
    {
      label: 'Memory used',
      value: formatBytes(overview?.process.residentMemoryBytes ?? Number.NaN),
      helper: 'Total RAM used by the monitoring process right now.',
      badge: 'Current',
      tone: 'neutral',
    },
    {
      label: 'CPU load',
      value: formatCpu(overview?.process.cpuSecondsPerSecond ?? Number.NaN),
      helper: 'How busy the monitoring process is.',
      badge: cpuState.label,
      tone: cpuState.tone,
    },
    {
      label: 'Internal traffic',
      value: formatRate(overview?.rpc.requestsPerSecond ?? Number.NaN),
      helper: 'Monitoring requests handled each second.',
      badge: overview && overview.rpc.requestsPerSecond <= 0.001 ? 'Idle' : 'Active',
      tone: 'neutral',
    },
    {
      label: 'Successful requests',
      value: formatSuccessRate(overview?.rpc.errorRate ?? Number.NaN),
      helper: `Request success rate. Errors: ${formatPercent(overview?.rpc.errorRate ?? Number.NaN)}.`,
      badge: successState.label,
      tone: successState.tone,
    },
    {
      label: 'App responsiveness',
      value: formatSeconds(overview?.process.eventLoopP99Seconds ?? Number.NaN),
      helper: 'Delay before Node.js can react to incoming work. Lower is better.',
      badge: responsivenessState.label,
      tone: responsivenessState.tone,
    },
  ] as const

  return (
    <section className="system-observability" aria-labelledby="system-observability-title">
      <div className="system-toolbar">
        <div>
          <p className="eyebrow">Live system health</p>
          <h2 id="system-observability-title">Is Velora monitoring healthy?</h2>
          <p className="section-description">
            A plain-language view of the monitoring service. Updates automatically every 15 seconds.
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
          <button className="secondary-button" type="button" onClick={() => void loadMonitoring()}>
            Refresh now
          </button>
        </div>
      </div>

      {error && (
        <div className="monitoring-warning" role="status">
          <strong>System data is temporarily unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className={`health-summary ${health.tone}`}>
        <div className="health-summary-icon" aria-hidden="true">
          {health.tone === 'good' ? '✓' : health.tone === 'bad' ? '!' : health.tone === 'warn' ? '!' : '…'}
        </div>
        <div className="health-summary-copy">
          <span>Quick read</span>
          <strong>{health.title}</strong>
          <p>{health.detail}</p>
        </div>
        <div className="health-summary-time">
          <span>Last checked</span>
          <strong>{overview ? new Date(overview.generatedAt).toLocaleTimeString() : 'Waiting'}</strong>
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

      <div className="monitoring-explainer">
        <strong>How to read these charts</strong>
        <p>
          Look for sudden jumps or a trend that keeps rising. Hover over a line to see the exact value and time.
          Empty traffic charts are normal when no monitoring requests are being made.
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
        <summary>Technical details</summary>
        <div>
          <span>JavaScript heap</span>
          <strong>{formatBytes(overview?.process.heapUsedBytes ?? Number.NaN)}</strong>
        </div>
        <div>
          <span>RPC p95 latency</span>
          <strong>
            {overview && overview.rpc.requestsPerSecond <= 0.001
              ? 'No traffic'
              : formatSeconds(overview?.rpc.p95LatencySeconds ?? Number.NaN)}
          </strong>
        </div>
        <div>
          <span>RPC error rate</span>
          <strong>{formatPercent(overview?.rpc.errorRate ?? Number.NaN)}</strong>
        </div>
        <p>
          The quick health summary uses service availability, request errors, response time, and runtime responsiveness.
        </p>
      </details>
    </section>
  )
}
