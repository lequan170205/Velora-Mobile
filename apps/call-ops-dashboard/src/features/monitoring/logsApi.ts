import { fetchApi } from '../../shared/api/client'

export type MonitoringLogLevel = 'all' | 'error' | 'warn' | 'info' | 'debug'

export type MonitoringLogEntry = {
  timestamp: string
  timestampNs: string
  message: string
  service: string
  container: string | null
  stream: string | null
  level: Exclude<MonitoringLogLevel, 'all'>
  labels: Record<string, string>
}

export type MonitoringLogsResponse = {
  generatedAt: string
  source: 'loki'
  query: {
    service: string
    level: MonitoringLogLevel
    search: string
    from: string
    to: string
    limit: number
  }
  entries: MonitoringLogEntry[]
  mayHaveMore: boolean
}

export type MonitoringLogsQuery = {
  service: string
  level: MonitoringLogLevel
  search: string
  from: string
  to: string
  limit?: number
}

export const fetchMonitoringLogs = async (query: MonitoringLogsQuery) => {
  const params = new URLSearchParams({
    service: query.service,
    level: query.level,
    search: query.search,
    from: query.from,
    to: query.to,
    limit: String(query.limit ?? 200),
  })

  const response = await fetchApi(`/monitoring/logs?${params.toString()}`)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Monitoring logs request failed (${response.status})`)
  }

  return response.json() as Promise<MonitoringLogsResponse>
}
