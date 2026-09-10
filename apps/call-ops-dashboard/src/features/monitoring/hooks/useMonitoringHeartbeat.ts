import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMonitoringOverview } from '../api'

export function useMonitoringHeartbeat(enabled: boolean) {
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) return

    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    setRefreshing(true)

    try {
      await fetchMonitoringOverview(controller.signal)
      if (abortControllerRef.current !== controller) return
      setLastSuccessfulAt(Date.now())
      setError(null)
    } catch (cause) {
      if (abortControllerRef.current !== controller) return
      if (cause instanceof Error && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : 'Unable to reach monitoring API')
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
        setRefreshing(false)
      }
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      setRefreshing(false)
      return
    }

    void refresh()

    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void refresh()
      }
    }, 15_000)

    return () => {
      window.clearInterval(timer)
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [enabled, refresh])

  return {
    lastSuccessfulAt,
    refreshing,
    error,
  }
}
