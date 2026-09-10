import { fetchApi } from '../../shared/api/client'

export type MonitoringAlertState = 'pending' | 'firing'
export type MonitoringAlertSeverity = 'critical' | 'warning' | 'info'

export type MonitoringAlert = {
  name: string
  state: MonitoringAlertState
  severity: MonitoringAlertSeverity
  service: string
  activeAt: string | null
  value: number | null
  summary: string
  description: string
  labels: Record<string, string>
  annotations: Record<string, string>
}

export type MonitoringAlertsResponse = {
  generatedAt: string
  source: 'prometheus'
  counts: {
    total: number
    firing: number
    pending: number
    critical: number
    warning: number
  }
  alerts: MonitoringAlert[]
}

export const fetchMonitoringAlerts = async (signal?: AbortSignal) => {
  const response = await fetchApi('/monitoring/alerts', { signal })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Monitoring alerts request failed (${response.status})`)
  }

  return response.json() as Promise<MonitoringAlertsResponse>
}
