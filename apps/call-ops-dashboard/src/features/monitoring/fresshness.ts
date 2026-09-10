export type MonitoringConnectionState = 'live' | 'refreshing' | 'stale' | 'disconnected'

export const getMonitoringConnectionState = ({
  now,
  lastSuccessfulAt,
  refreshing,
  hasError,
}: {
  now: number
  lastSuccessfulAt: number | null
  refreshing: boolean
  hasError: boolean
}): MonitoringConnectionState => {
  if (lastSuccessfulAt === null) {
    return hasError ? 'disconnected' : 'refreshing'
  }

  const ageMs = now - lastSuccessfulAt

  if (hasError && ageMs > 90_000) {
    return 'disconnected'
  }

  if (ageMs > 30_000) {
    return 'stale'
  }

  if (refreshing) {
    return 'refreshing'
  }

  return 'live'
}
