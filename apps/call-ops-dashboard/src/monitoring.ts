import { fetchApi } from './api'

export type MonitoringOverview = {
  generatedAt: string
  source: 'prometheus'
  service: {
    up: boolean
  }
  process: {
    residentMemoryBytes: number
    heapUsedBytes: number
    cpuSecondsPerSecond: number
    eventLoopP99Seconds: number
  }
  rpc: {
    requestsPerSecond: number
    errorRate: number
    p95LatencySeconds: number
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
