import {
  badgeForThreshold,
  formatBytes,
  formatLoad,
  formatPercent,
  formatUptime,
  toneForThreshold,
  type Tone,
} from '../formatters'
import {
  HealthSummary,
  MetricCardGrid,
  MonitoringCharts,
  MonitoringError,
  MonitoringToolbar,
  useMonitoringView,
  type MetricCardDefinition,
  type MonitoringSeriesDefinition,
} from '../components/MonitoringView'

const SERIES: readonly MonitoringSeriesDefinition[] = [
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

export function ServerSection() {
  const {
    overview,
    history,
    rangeHours,
    setRangeHours,
    error,
    initialLoading,
    refreshing,
    hasData,
    refreshNow,
  } = useMonitoringView({
    series: SERIES,
    errorMessage: 'Unable to load server metrics',
  })

  const host = overview?.host
  const hostUp = host?.up ?? null
  const serverHealthy = hostUp === true
  const hostTone: Tone = hostUp === null ? 'neutral' : serverHealthy ? 'good' : 'bad'

  const cards: readonly MetricCardDefinition[] = [
    {
      label: 'CPU usage',
      value: formatPercent(host?.cpuUsageRatio ?? Number.NaN),
      helper: 'Real CPU usage across the Ubuntu host.',
      badge: badgeForThreshold(host?.cpuUsageRatio ?? null, 0.7, 0.9),
      tone: toneForThreshold(host?.cpuUsageRatio ?? null, 0.7, 0.9),
    },
    {
      label: 'RAM used',
      value: `${formatBytes(host?.memoryUsedBytes ?? Number.NaN)} / ${formatBytes(host?.memoryTotalBytes ?? Number.NaN)}`,
      helper: `${formatBytes(host?.memoryAvailableBytes ?? Number.NaN)} available · comparable to free -h.`,
      badge: badgeForThreshold(host?.memoryUsageRatio ?? null, 0.75, 0.9),
      tone: toneForThreshold(host?.memoryUsageRatio ?? null, 0.75, 0.9),
    },
    {
      label: 'Swap used',
      value: `${formatBytes(host?.swapUsedBytes ?? Number.NaN)} / ${formatBytes(host?.swapTotalBytes ?? Number.NaN)}`,
      helper: `${formatBytes(host?.swapFreeBytes ?? Number.NaN)} swap still free.`,
      badge: badgeForThreshold(host?.swapUsageRatio ?? null, 0.25, 0.5),
      tone: toneForThreshold(host?.swapUsageRatio ?? null, 0.25, 0.5),
    },
    {
      label: 'Root disk',
      value: `${formatBytes(host?.diskUsedBytes ?? Number.NaN)} / ${formatBytes(host?.diskTotalBytes ?? Number.NaN)}`,
      helper: `${formatBytes(host?.diskAvailableBytes ?? Number.NaN)} available on /.`,
      badge: badgeForThreshold(host?.diskUsageRatio ?? null, 0.8, 0.92),
      tone: toneForThreshold(host?.diskUsageRatio ?? null, 0.8, 0.92),
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
      badge: hostUp === null ? 'Waiting' : serverHealthy ? 'Online' : 'Unavailable',
      tone: hostUp === null ? 'neutral' : serverHealthy ? 'good' : 'bad',
    },
  ]

  const healthTitle = hostUp === null
    ? 'Host status is unavailable'
    : serverHealthy
      ? 'Homelab server is reporting normally'
      : 'Host metrics are unavailable'

  const healthDetail = hostUp === null
    ? 'Prometheus returned no host status sample, so the dashboard will not guess that the server is offline.'
    : serverHealthy
      ? 'These values describe the whole Ubuntu machine, not a single container or Node.js process.'
      : 'Prometheus can see node-exporter but cannot currently scrape it. Check the exporter target and deployment.'

  return (
    <section className="server-observability" aria-labelledby="server-observability-title" aria-busy={initialLoading}>
      <MonitoringToolbar
        eyebrow="Ubuntu host · live"
        title="Server resources"
        titleId="server-observability-title"
        description="Real CPU, RAM, swap, disk, load, and uptime from the homelab host via Prometheus node exporter."
        rangeLabel="Server history range"
        rangeHours={rangeHours}
        onRangeChange={setRangeHours}
        refreshing={refreshing}
        onRefresh={() => void refreshNow()}
      />

      <MonitoringError error={error} title="Server metrics are temporarily unavailable." hasData={hasData} />
      <HealthSummary
        tone={hostTone}
        label="Host status"
        title={healthTitle}
        detail={healthDetail}
        generatedAt={overview?.generatedAt}
        refreshing={refreshing}
      />
      <MetricCardGrid cards={cards} className="server-metric-grid" refreshing={refreshing} />
      <MonitoringCharts series={SERIES} history={history} className="server-chart-grid" initialLoading={initialLoading} />
    </section>
  )
}
