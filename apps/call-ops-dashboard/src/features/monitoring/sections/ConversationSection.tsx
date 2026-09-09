import {
  formatBytes,
  formatCount,
  formatCpu,
  formatPercent,
  formatRate,
  formatSeconds,
  toneForThreshold,
  type Tone,
} from '../formatters'
import {
  HealthSummary,
  MetricCardGrid,
  MonitoringCharts,
  MonitoringError,
  MonitoringToolbar,
} from '../components'
import { useMonitoringView } from '../hooks/useMonitoringView'
import type { MetricCardDefinition, MonitoringSeriesDefinition } from '../model'

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
    title: 'Validated send attempts per second',
    question: 'How many validated sends are reaching message persistence?',
    description: 'Send attempts that reached SendMessageUseCase after gateway validation. Gateway-level rejects are not included yet.',
    formatter: formatRate,
    axisFormatter: formatRate,
    accent: '#7f8dff',
    fill: 'rgba(127, 141, 255, .12)',
    emptyTitle: 'No validated send traffic yet',
    emptyDescription: 'This chart appears after validated sends reach the persistence use case.',
  },
  {
    metric: 'conversation_p95_send_latency',
    title: 'Message persistence p95 latency',
    question: 'How quickly are validated messages persisted?',
    description: '95% of measured SendMessageUseCase persistence attempts complete within this duration.',
    formatter: formatSeconds,
    axisFormatter: formatSeconds,
    accent: '#f59a62',
    fill: 'rgba(245, 154, 98, .10)',
    emptyTitle: 'No persistence latency samples yet',
    emptyDescription: 'Latency history requires validated send traffic.',
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
  const { overview, history, rangeHours, setRangeHours, error, initialLoading, refreshing, hasData, refreshNow } = useMonitoringView({
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
  const measuredFailureRate = errorRate === null
    ? null
    : errorRate + (rejectRate ?? 0)

  const reliabilityTone: Tone = serviceUp !== true
    ? serviceUp === false ? 'bad' : 'neutral'
    : !hasTraffic || measuredFailureRate === null
      ? 'neutral'
      : toneForThreshold(measuredFailureRate, 0.01, 0.05)

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
      label: 'Validated sends',
      value: formatRate(sendRequestsPerSecond ?? Number.NaN),
      helper: 'Persistence attempts that reached SendMessageUseCase after gateway validation.',
      badge: !hasData ? 'Waiting' : hasTraffic ? 'Active' : 'Idle',
      tone: 'neutral',
    },
    {
      label: 'Successful persistence',
      value: !hasTraffic
        ? hasData ? 'No traffic' : '—'
        : successRate === null
          ? 'Unavailable'
          : formatPercent(successRate),
      helper: 'Share of measured persistence attempts that completed successfully.',
      badge: !hasData
        ? 'Waiting'
        : !hasTraffic
          ? 'Idle'
          : successRate === null
            ? 'Unavailable'
            : successRate >= 0.99
              ? 'Healthy'
              : 'Watch',
      tone: !hasTraffic || successRate === null
        ? 'neutral'
        : successRate >= 0.99
          ? 'good'
          : 'warn',
    },
    {
      label: 'Rejected sends',
      value: rejectRate === null
        ? 'Unavailable'
        : !hasTraffic
          ? hasData ? 'No traffic' : '—'
          : formatPercent(rejectRate),
      helper: 'Gateway-level validation/auth/member rejects are not instrumented yet.',
      badge: rejectRate === null
        ? 'Not measured'
        : !hasData
          ? 'Waiting'
          : !hasTraffic
            ? 'Idle'
            : rejectRate < 0.01
              ? 'Low'
              : 'Watch',
      tone: rejectRate === null || !hasTraffic
        ? 'neutral'
        : toneForThreshold(rejectRate, 0.01, 0.05),
    },
    {
      label: 'Persistence errors',
      value: !hasTraffic
        ? hasData ? 'No traffic' : '—'
        : errorRate === null
          ? 'Unavailable'
          : formatPercent(errorRate),
      helper: 'Failures raised while persisting a validated message.',
      badge: !hasData
        ? 'Waiting'
        : !hasTraffic
          ? 'Idle'
          : errorRate === null
            ? 'Unavailable'
            : errorRate < 0.01
              ? 'Low'
              : 'Watch',
      tone: !hasTraffic || errorRate === null
        ? 'neutral'
        : toneForThreshold(errorRate, 0.01, 0.05),
    },
    {
      label: 'p95 persistence latency',
      value: !hasTraffic
        ? hasData ? 'No traffic' : '—'
        : p95Latency === null
          ? 'Unavailable'
          : formatSeconds(p95Latency),
      helper: 'Time spent in the measured SendMessageUseCase persistence path.',
      badge: !hasData
        ? 'Waiting'
        : !hasTraffic
          ? 'Idle'
          : p95Latency === null
            ? 'Unavailable'
            : p95Latency < 0.25
              ? 'Fast'
              : 'Watch',
      tone: !hasTraffic || p95Latency === null
        ? 'neutral'
        : toneForThreshold(p95Latency, 0.25, 0.75),
    },
  ]

  const healthTitle = serviceUp === false
    ? 'Conversation service is offline'
    : serviceUp === null
      ? 'Conversation-service status is unavailable'
      : !hasTraffic
        ? 'Conversation service is online and idle'
        : reliabilityTone === 'good'
          ? 'Measured message persistence is healthy'
          : reliabilityTone === 'warn' || reliabilityTone === 'bad'
            ? 'Measured message persistence needs attention'
            : 'Conversation service is online'

  const healthDetail = serviceUp === true
    ? rejectRate === null
      ? 'Persistence throughput, failures, and latency are measured. Gateway-level rejection rate remains unavailable until that boundary is instrumented.'
      : 'Use throughput, rejection/error rate, and p95 latency together when comparing replica counts during load tests.'
    : 'Prometheus must be able to scrape conversation-service before throughput and latency can be trusted.'

  return (
    <section className="system-observability" aria-labelledby="conversation-observability-title" aria-busy={initialLoading}>
      <MonitoringToolbar
        eyebrow="Conversation service · realtime"
        title="Chat service performance"
        titleId="conversation-observability-title"
        description="Validated message persistence throughput, measured reliability, latency, socket connections, and runtime health from conversation-service."
        rangeLabel="Conversation history range"
        rangeHours={rangeHours}
        onRangeChange={setRangeHours}
        refreshing={refreshing}
        onRefresh={() => void refreshNow()}
      />

      <MonitoringError error={error} title="Conversation metrics are temporarily unavailable." hasData={hasData} />
      <HealthSummary tone={reliabilityTone} label="Quick read" title={healthTitle} detail={healthDetail} generatedAt={overview?.generatedAt} refreshing={refreshing} />
      <MetricCardGrid cards={cards} refreshing={refreshing} />
      <MonitoringCharts series={SERIES} history={history} initialLoading={initialLoading} />

      <details className="technical-details">
        <summary>Conversation-service runtime details</summary>
        <div><span>Process memory</span><strong>{formatBytes(conversation?.residentMemoryBytes ?? Number.NaN)}</strong></div>
        <div><span>Process CPU</span><strong>{formatCpu(conversation?.cpuSecondsPerSecond ?? Number.NaN)}</strong></div>
        <div><span>Event-loop p99</span><strong>{formatSeconds(conversation?.eventLoopP99Seconds ?? Number.NaN)}</strong></div>
        <p>These runtime values are aggregated across the currently scraped conversation-service instances. They become especially useful once k3s starts scaling replicas.</p>
      </details>
    </section>
  )
}
