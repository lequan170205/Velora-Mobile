import { fetchApi } from './api'

type NullableMetric = number | null

export type MonitoringOverview = {
  generatedAt: string
  source: 'prometheus'
  host: {
    up: boolean | null
    cpuUsageRatio: NullableMetric
    memoryTotalBytes: NullableMetric
    memoryAvailableBytes: NullableMetric
    memoryUsedBytes: NullableMetric
    memoryUsageRatio: NullableMetric
    swapTotalBytes: NullableMetric
    swapFreeBytes: NullableMetric
    swapUsedBytes: NullableMetric
    swapUsageRatio: NullableMetric
    diskTotalBytes: NullableMetric
    diskAvailableBytes: NullableMetric
    diskUsedBytes: NullableMetric
    diskUsageRatio: NullableMetric
    load1: NullableMetric
    uptimeSeconds: NullableMetric
  }
  service: {
    up: boolean | null
  }
  process: {
    residentMemoryBytes: NullableMetric
    heapUsedBytes: NullableMetric
    cpuSecondsPerSecond: NullableMetric
    eventLoopP99Seconds: NullableMetric
  }
  rpc: {
    requestsPerSecond: NullableMetric
    errorRate: NullableMetric
    p95LatencySeconds: NullableMetric
  }
}

export type MonitoringMetric =
  | 'memory'
  | 'heap'
  | 'cpu'
  | 'rpc_rate'
  | 'error_rate'
  | 'p95_rpc_latency'
  | 'event_loop_p99'
  | 'host_cpu'
  | 'host_memory'
  | 'host_swap'
  | 'host_disk'
  | 'host_load1'

export type MonitoringPoint = {
  timestamp: number
  value: number
}

export type MonitoringTimeseries = {
  metric: MonitoringMetric
  from: string
  to: string
  stepSeconds: number
  points: MonitoringPoint[]
}

export const fetchMonitoringOverview = async () => {
  const response = await fetchApi('/monitoring/overview')
  if (!response.ok) {
    throw new Error(`Unable to load system monitoring (${response.status})`)
  }

  return (await response.json()) as MonitoringOverview
}

export const fetchMonitoringTimeseries = async ({
  metric,
  from,
  to,
  stepSeconds = 60,
}: {
  metric: MonitoringMetric
  from: string
  to: string
  stepSeconds?: number
}) => {
  const search = new URLSearchParams({
    metric,
    from,
    to,
    stepSeconds: String(stepSeconds),
  })
  const response = await fetchApi(`/monitoring/timeseries?${search}`)
  if (!response.ok) {
    throw new Error(`Unable to load ${metric} history (${response.status})`)
  }

  return (await response.json()) as MonitoringTimeseries
}
