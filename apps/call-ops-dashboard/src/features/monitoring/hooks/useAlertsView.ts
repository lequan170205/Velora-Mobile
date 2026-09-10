import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchMonitoringAlerts,
  type MonitoringAlertsResponse,
} from '../alertsApi'

const AUTO_REFRESH_INTERVAL_MS = 15_000

export function useAlertsView() {
  const [response, setResponse] = useState<MonitoringAlertsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async (background = false) => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    const requestId = ++requestIdRef.current
    if (background) setRefreshing(true)
    else setInitialLoading(true)

    try {
      const next = await fetchMonitoringAlerts(controller.signal)
      if (requestId !== requestIdRef.current) return
      setResponse(next)
      setError(null)
    } catch (cause) {
      if (requestId !== requestIdRef.current) return
      if (cause instanceof Error && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : 'Unable to load active alerts')
    } finally {
      if (requestId !== requestIdRef.current) return
      setInitialLoading(false)
      setRefreshing(false)
      if (abortControllerRef.current === controller) abortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load(true)
      }
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load(true)
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [load])

  useEffect(() => () => {
    requestIdRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  return {
    response,
    alerts: response?.alerts ?? [],
    counts: response?.counts ?? null,
    error,
    initialLoading,
    refreshing,
    refreshNow: () => load(true),
  }
}
