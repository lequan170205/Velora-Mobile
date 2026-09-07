import { useCallback, useEffect, useMemo, useState } from 'react'

import { MetricSparkline } from './MetricSparkline'
import {
  fetchMonitoringOverview,
  fetchMonitoringTimeseries,
  type MonitoringMetric,
  type MonitoringOverview,
  type MonitoringPoint,
} from './monitoring'

const REFRESH_INTERVAL_MS = 15_000

const RANGE_OPTIONS = [
  { label: '1h', hours: 1, stepSeconds: 60 },
  { label: '6h', hours: 6, stepSeconds: 180 },
  { label: '24h', hours: 24, stepSeconds: 300 },
] as const

const SERIES: Array<{
  metric: MonitoringMetric
  label: string
  formatter: (value: number) => string
}> = [
  { metric: 'memory', label: 'Resident memory', formatter: formatBytes },
  { metric: 'cpu', label: 'Process CPU', formatter: formatCpu },
  { metric: 'rpc_rate', label: 'RPC throughput', formatter: formatRate },
  { metric: 'p95_rpc_latency', label: 'RPC p95 latency', formatter: formatSeconds },
]

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return '—'
  const mib = value / (1024 * 1024)
  if (mib < 1024) return `${mib.toFixed(mib >= 100 ? 0 : 1)} MiB`
  return `${(mib / 1024).toFixed(2)} GiB`
}

function formatCpu(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function formatRate(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(value >= 10 ? 1 : 2)}/s`
}

function formatSeconds(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 1000).toFixed(value >= 1 ? 0 : 1)} ms`
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

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
      for (const item of series) {
        nextHistory[item.metric] = item.points
      }

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

  const systemCards = [
    {
      label: 'Monitoring service',
      value: overview ? (overview.service.up ? 'UP' : 'DOWN') : '—',
      state: overview?.service.up ? 'healthy' : overview ? 'unhealthy' : 'neutral',
    },
    { label: 'Resident memory', value: formatBytes(overview?.process.residentMemoryBytes ?? Number.NaN) },
    { label: 'Heap used', value: formatBytes(overview?.process.heapUsedBytes ?? Number.NaN) },
    { label: 'Process CPU', value: formatCpu(overview?.process.cpuSecondsPerSecond ?? Number.NaN) },
    { label: 'RPC / second', value: formatRate(overview?.rpc.requestsPerSecond ?? Number.NaN) },
    { label: 'RPC error rate', value: formatPercent(overview?.rpc.errorRate ?? Number.NaN) },
    { label: 'RPC p95', value: formatSeconds(overview?.rpc.p95LatencySeconds ?? Number.NaN) },
    { label: 'Event-loop p99', value: formatSeconds(overview?.process.eventLoopP99Seconds ?? Number.NaN) },
  ]

  return (
    <section className="system-observability" aria-labelledby="system-observability-title">
      <div className="section-heading system-toolbar">
        <div>
          <p className="eyebrow">Prometheus</p>
          <h2 id="system-observability-title">System observability</h2>
          <p className="section-description">
            Runtime health for the Velora monitoring service. Auto-refreshes every 15 seconds.
          </p>
        </div>
        <div className="monitoring-actions">
          <div className="range-switcher" aria-label="Monitoring history range">
            {RANGE_OPTIONS.map((option) => (
              <button
                className={option.hours === rangeHours ? 'range-button active' : 'range-button'}
                key={option.label}
                type="button"
                onClick={() => setRangeHours(option.hours)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="secondary-button" type="button" onClick={() => void loadMonitoring()}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="monitoring-warning" role="status">
          <strong>Prometheus data unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="cards system-cards" aria-busy={loading}>
        {systemCards.map((card) => (
          <article key={card.label}>
            <span>{card.label}</span>
            <strong className={card.state ? `metric-state ${card.state}` : undefined}>
              {card.state && <i className="status-dot" aria-hidden="true" />}
              {card.value}
            </strong>
          </article>
        ))}
      </div>

      <div className="monitoring-grid">
        {SERIES.map((series) => (
          <article className="metric-chart" key={series.metric}>
            <div className="metric-chart-heading">
              <h3>{series.label}</h3>
              <span>{selectedRange.label} history</span>
            </div>
            <MetricSparkline
              points={history[series.metric] ?? []}
              valueFormatter={series.formatter}
              emptyLabel={loading ? 'Loading samples…' : 'No samples in this range'}
            />
          </article>
        ))}
      </div>

      <p className="monitoring-footnote">
        {overview
          ? `Prometheus snapshot ${new Date(overview.generatedAt).toLocaleString()}`
          : 'Waiting for the first Prometheus snapshot.'}
      </p>
    </section>
  )
}
