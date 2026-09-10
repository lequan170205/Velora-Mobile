import { useCallback, useEffect, useState } from 'react'
import { fetchMonitoringOverview } from '../api'

export function useMonitoringHeartbeat(enabled: boolean) {
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) return

    setRefreshing(true)

    try {
      await fetchMonitoringOverview()
      setLastSuccessfulAt(Date.now())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to reach monitoring API')
    } finally {
      setRefreshing(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    void refresh()

    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void refresh()
      }
    }, 15_000)

    return () => window.clearInterval(timer)
  }, [enabled, refresh])

  return {
    lastSuccessfulAt,
    refreshing,
    error,
  }
}
