import {
  formatBytes,
  formatCount,
  formatCpu,
  formatPercent,
  formatRate,
  formatSeconds,
  toneForThreshold,
  type Tone,
} from './monitoring-formatters'
import {
  HealthSummary,
  MetricCardGrid,
  MonitoringCharts,
  MonitoringError,
  MonitoringToolbar,
  useMonitoringView,
  type MetricCardDefinition,
  type MonitoringSeriesDefinition,
} from './monitoring-view'

const SERIES: readonly MonitoringSeriesDefinition[] = [
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
    errorMessage: 'Unable to load conversation-service metrics',
  })

  const conversation = overview?.conversation
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
      : toneForThreshold((rejectRate ?? 0) + (errorRate ?? 0), 0.01, 0.05)

  const cards: readonly MetricCardDefinition[] = [
    {
      label: 'Service status',
      value: serviceUp === true ? 'Online' : serviceUp === false ? 'Offline' : '—',
      helper: 'Can Prometheus scrape conversation-service?',
      badge: serviceUp === true ? 'Reachable' : serviceUp === false ? 'Unreachable' : 'Waiting',
      tone: serviceUp === true ? 'good' : serviceUp === false ? 'bad' : 'neutral',
    },
    {
      label: 'Active sockets',
      value: formatCount(conversation?.socketConnections ?? Number.NaN),
      helper: 'Realtime Socket.IO clients currently connected.',
      badge: hasData ? 'Live' : 'Waiting',
      tone: 'neutral',
    },
    {
      label: 'New messages',
      value: formatRate(conversation?.messagesPerSecond ?? Number.NaN),
      helper: 'Persisted user messages, excluding idempotent retries.',
      badge: !hasData ? 'Waiting' : hasTraffic ? 'Active' : 'Idle',
      tone: 'neutral',
    },
    {
      label: 'Send requests',
      value: formatRate(sendRequestsPerSecond ?? Number.NaN),
      helper: 'All incoming send_message attempts.',
      badge: !hasData ? 'Waiting' : hasTraffic ? 'Active' : 'Idle',
      tone: 'neutral',
    },
    {
      label: 'Successful sends',
      value: hasTraffic ? formatPercent(successRate ?? Number.NaN) : hasData ? 'No traffic' : '—',
      helper: 'Share of send_message requests handled successfully.',
      badge: !hasData ? 'Waiting' : !hasTraffic ? 'Idle' : (successRate ?? 0) >= 0.99 ? 'Healthy' : 'Watch',
      tone: !hasTraffic ? 'neutral' : (successRate ?? 0) >= 0.99 ? 'good' : 'warn',
    },
    {
      label: 'Rejected sends',
      value: hasTraffic ? formatPercent(rejectRate ?? Number.NaN) : hasData ? 'No traffic' : '—',
      helper: 'Invalid/auth/member checks rejected before message creation.',
      badge: !hasData ? 'Waiting' : !hasTraffic ? 'Idle' : (rejectRate ?? 0) < 0.01 ? 'Low' : 'Watch',
      tone: !hasTraffic ? 'neutral' : toneForThreshold(rejectRate, 0.01, 0.05),
    },
    {
      label: 'Send errors',
      value: hasTraffic ? formatPercent(errorRate ?? Number.NaN) : hasData ? 'No traffic' : '—',
      helper: 'Unexpected send_message failures after validation.',
      badge: !hasData ? 'Waiting' : !hasTraffic ? 'Idle' : (errorRate ?? 0) < 0.01 ? 'Low' : 'Watch',
      tone: !hasTraffic ? 'neutral' : toneForThreshold(errorRate, 0.01, 0.05),
    },
    {
      label: 'p95 send latency',
      value: hasTraffic ? formatSeconds(p95Latency ?? Number.NaN) : hasData ? 'No traffic' : '—',
      helper: 'Synchronous handling time for successful send_message requests.',
      badge: !hasData ? 'Waiting' : !hasTraffic ? 'Idle' : (p95Latency ?? 0) < 0.25 ? 'Fast' : 'Watch',
      tone: !hasTraffic ? 'neutral' : toneForThreshold(p95Latency, 0.25, 0.75),
    },
  ]

  const healthTitle = serviceUp === false
    ? 'Conversation service is offline'
    : serviceUp === null
      ? 'Conversation-service status is unavailable'
      : !hasTraffic
        ? 'Conversation service is online and idle'
        : reliabilityTone === 'good'
          ? 'Chat traffic is healthy'
          : 'Chat traffic needs attention'

  const healthDetail = serviceUp === true
    ? 'Use message rate and p95 latency together when comparing one, two, and three replicas during load tests.'
    : 'Prometheus must be able to scrape conversation-service before throughput and latency can be trusted.'

  return (
    <section
      className="system-observability"
      aria-labelledby="conversation-observability-title"
      aria-busy={initialLoading}
    >
      <MonitoringToolbar
        eyebrow="Conversation service · realtime"
        title="Chat service performance"
        titleId="conversation-observability-title"
        description="Message throughput, send reliability, latency, socket connections, and runtime health from conversation-service."
        rangeLabel="Conversation history range"
        rangeHours={rangeHours}
        onRangeChange={setRangeHours}
        refreshing={refreshing}
        onRefresh={() => void refreshNow()}
      />

      <MonitoringError
        error={error}
        title="Conversation metrics are temporarily unavailable."
        hasData={hasData}
      />

      <HealthSummary
        tone={reliabilityTone}
        label="Quick read"
        title={healthTitle}
        detail={healthDetail}
        generatedAt={overview?.generatedAt}
        refreshing={refreshing}
      />

      <MetricCardGrid cards={cards} refreshing={refreshing} />
      <MonitoringCharts series={SERIES} history={history} initialLoading={initialLoading} />

      <details className="technical-details">
        <summary>Conversation-service runtime details</summary>
        <div>
          <span>Process memory</span>
          <strong>{formatBytes(conversation?.residentMemoryBytes ?? Number.NaN)}</strong>
        </div>
        <div>
          <span>Process CPU</span>
          <strong>{formatCpu(conversation?.cpuSecondsPerSecond ?? Number.NaN)}</strong>
        </div>
        <div>
          <span>Event-loop p99</span>
          <strong>{formatSeconds(conversation?.eventLoopP99Seconds ?? Number.NaN)}</strong>
        </div>
        <p>
          These runtime values are aggregated across the currently scraped conversation-service instances. They become especially useful once k3s starts scaling replicas.
        </p>
      </details>
    </section>
  )
}
