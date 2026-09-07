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

const formatBytes = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  const gib = value / (1024 ** 3)
  if (gib >= 1) return `${gib.toFixed(gib >= 10 ? 1 : 2)} GB`
  return `${(value / (1024 ** 2)).toFixed(0)} MB`
}

const formatPercent = (value: number) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'

const formatLoad = (value: number) =>
  Number.isFinite(value) ? value.toFixed(2) : '—'

const formatUptime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const toneForRatio = (value: number, warn: number, bad: number) => {
  if (!Number.isFinite(value)) return 'neutral'
  if (value >= bad) return 'bad'
  if (value >= warn) return 'warn'
  return 'good'
}

const badgeForRatio = (value: number, warn: number, bad: number) => {
  const tone = toneForRatio(value, warn, bad)
  if (tone === 'bad') return 'High'
  if (tone === 'warn') return 'Watch'
  if (tone === 'good') return 'Healthy'
  return 'Waiting'
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
    metric: 'host_cpu',
    title: 'Server CPU usage',
    question: 'How busy is the server?',
    description: 'CPU usage across the Ubuntu host. Sustained high usage can slow every Velora service.',
    formatter: formatPercent,
    axisFormatter: formatPercent,
    accent: '#7f8dff',
    fill: 'rgba(127, 141, 255, .12)',
    emptyTitle: 'No CPU history yet',
    emptyDescription: 'Node exporter will fill this chart after Prometheus collects a few host samples.',
  },
  {
    metric: 'host_memory',
    title: 'Server RAM usage',
    question: 'Is the host running out of memory?',
    description: 'Real Ubuntu memory pressure based on MemAvailable, matching the useful view behind free -h.',
    formatter: formatPercent,
    axisFormatter: formatPercent,
    accent: '#42d392',
    fill: 'rgba(66, 211, 146, .10)',
    emptyTitle: 'No RAM history yet',
    emptyDescription: 'RAM history appears once node exporter has been scraped for a short time.',
  },
  {
    metric: 'host_disk',
    title: 'Root disk usage',
    question: 'How full is the server disk?',
    description: 'Usage of the Ubuntu root filesystem. Disk pressure can break deployments, logs, and databases.',
    formatter: formatPercent,
    axisFormatter: formatPercent,
    accent: '#f5b84b',
    fill: 'rgba(245, 184, 75, .10)',
    emptyTitle: 'No disk history yet',
    emptyDescription: 'Root filesystem samples will appear after node exporter is available.',
  },
  {
    metric: 'host_load1',
    title: '1-minute load average',
    question: 'How much work is waiting for CPU?',
    description: 'Linux 1-minute load average. Read it together with CPU usage rather than as a percentage.',
    formatter: formatLoad,
    axisFormatter: formatLoad,
    accent: '#64c7ff',
    fill: 'rgba(100, 199, 255, .10)',
    emptyTitle: 'No load history yet',
    emptyDescription: 'Load history will appear after Prometheus starts scraping the host.',
  },
]

type RefreshMode = 'overview' | 'all'

export function ServerSection() {
  const [overview, setOverview] = useState<MonitoringOverview | null>(null)
  const [history, setHistory] = useState<Partial<Record<MonitoringMetric, MonitoringPoint[]>>>({})
  const [rangeHours, setRangeHours] = useState<(typeof RANGE_OPTIONS)[number]['hours']>(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const selectedRange = useMemo(
    () => RANGE_OPTIONS.find((option) => option.hours === rangeHours) ?? RANGE_OPTIONS[0],
    [rangeHours],
  )

  const refreshServer = useCallback(async (mode: RefreshMode, showLoading = false) => {
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
      setError(nextError instanceof Error ? nextError.message : 'Unable to load server metrics')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [selectedRange])

  useEffect(() => {
    void refreshServer('all', true)

    const overviewInterval = window.setInterval(() => {
      if (!document.hidden) void refreshServer('overview')
    }, OVERVIEW_REFRESH_INTERVAL_MS)

    const historyInterval = window.setInterval(() => {
      if (!document.hidden) void refreshServer('all')
    }, HISTORY_REFRESH_INTERVAL_MS)

    const handleVisibilityChange = () => {
      if (!document.hidden) void refreshServer('all')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(overviewInterval)
      window.clearInterval(historyInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshServer])

  const host = overview?.host
  const serverHealthy = host?.up === true
  const memoryTone = toneForRatio(host?.memoryUsageRatio ?? Number.NaN, 0.75, 0.9)
  const diskTone = toneForRatio(host?.diskUsageRatio ?? Number.NaN, 0.8, 0.92)
  const cpuTone = toneForRatio(host?.cpuUsageRatio ?? Number.NaN, 0.7, 0.9)
  const swapTone = toneForRatio(host?.swapUsageRatio ?? Number.NaN, 0.25, 0.5)

  const cards = [
    {
      label: 'CPU usage',
      value: formatPercent(host?.cpuUsageRatio ?? Number.NaN),
      helper: 'Real CPU usage across the Ubuntu host.',
      badge: badgeForRatio(host?.cpuUsageRatio ?? Number.NaN, 0.7, 0.9),
      tone: cpuTone,
    },
    {
      label: 'RAM used',
      value: `${formatBytes(host?.memoryUsedBytes ?? Number.NaN)} / ${formatBytes(host?.memoryTotalBytes ?? Number.NaN)}`,
      helper: `${formatBytes(host?.memoryAvailableBytes ?? Number.NaN)} available · comparable to free -h.`,
      badge: badgeForRatio(host?.memoryUsageRatio ?? Number.NaN, 0.75, 0.9),
      tone: memoryTone,
    },
    {
      label: 'Swap used',
      value: `${formatBytes(host?.swapUsedBytes ?? Number.NaN)} / ${formatBytes(host?.swapTotalBytes ?? Number.NaN)}`,
      helper: `${formatBytes(host?.swapFreeBytes ?? Number.NaN)} swap still free.`,
      badge: badgeForRatio(host?.swapUsageRatio ?? Number.NaN, 0.25, 0.5),
      tone: swapTone,
    },
    {
      label: 'Root disk',
      value: `${formatBytes(host?.diskUsedBytes ?? Number.NaN)} / ${formatBytes(host?.diskTotalBytes ?? Number.NaN)}`,
      helper: `${formatBytes(host?.diskAvailableBytes ?? Number.NaN)} available on /.`,
      badge: badgeForRatio(host?.diskUsageRatio ?? Number.NaN, 0.8, 0.92),
      tone: diskTone,
    },
    {
      label: 'Load average',
      value: formatLoad(host?.load1 ?? Number.NaN),
      helper: 'Linux load over the last minute.',
      badge: '1 minute',
      tone: 'neutral',
    },
    {
      label: 'Server uptime',
      value: formatUptime(host?.uptimeSeconds ?? Number.NaN),
      helper: 'Time since the Ubuntu host last booted.',
      badge: serverHealthy ? 'Online' : 'Unavailable',
      tone: serverHealthy ? 'good' : 'bad',
    },
  ] as const

  return (
    <section className="server-observability" aria-labelledby="server-observability-title">
      <div className="system-toolbar">
        <div>
          <p className="eyebrow">Ubuntu host · live</p>
          <h2 id="server-observability-title">Server resources</h2>
          <p className="section-description">
            Real CPU, RAM, swap, disk, load, and uptime from the homelab host via Prometheus node exporter.
          </p>
        </div>
        <div className="monitoring-actions">
          <div className="range-switcher" aria-label="Server history range">
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
          <button className="secondary-button" type="button" onClick={() => void refreshServer('all', true)}>
            Refresh now
          </button>
        </div>
      </div>

      {error && (
        <div className="monitoring-warning" role="status">
          <strong>Server metrics are temporarily unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className={`health-summary ${serverHealthy ? 'good' : 'bad'}`}>
        <div className="health-summary-icon" aria-hidden="true">{serverHealthy ? '✓' : '!'}</div>
        <div className="health-summary-copy">
          <span>Host status</span>
          <strong>{serverHealthy ? 'Homelab server is reporting normally' : 'Host metrics are unavailable'}</strong>
          <p>
            {serverHealthy
              ? 'These values describe the whole Ubuntu machine, not a single container or Node.js process.'
              : 'Prometheus cannot currently read node-exporter. Check the exporter target and deployment.'}
          </p>
        </div>
        <div className="health-summary-time">
          <span>Last checked</span>
          <strong>{overview ? new Date(overview.generatedAt).toLocaleTimeString() : 'Waiting'}</strong>
        </div>
      </div>

      <div className="friendly-metric-grid server-metric-grid" aria-busy={loading}>
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

      <div className="monitoring-grid server-chart-grid">
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
    </section>
  )
}
