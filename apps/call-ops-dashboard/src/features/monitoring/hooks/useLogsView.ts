import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchMonitoringLogs,
  type MonitoringLogLevel,
  type MonitoringLogsResponse,
} from '../logsApi'

export type LogsRangeMinutes = 15 | 60 | 360 | 1440

export type LogsFilters = {
  service: string
  level: MonitoringLogLevel
  search: string
  rangeMinutes: LogsRangeMinutes
}

const DEFAULT_FILTERS: LogsFilters = {
  service: 'all',
  level: 'all',
  search: '',
  rangeMinutes: 60,
}

const AUTO_REFRESH_INTERVAL_MS = 10_000

export function useLogsView() {
  const [draftFilters, setDraftFilters] = useState<LogsFilters>(DEFAULT_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<LogsFilters>(DEFAULT_FILTERS)
  const [response, setResponse] = useState<MonitoringLogsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [live, setLive] = useState(true)
  const requestIdRef = useRef(0)

  const load = useCallback(async (filters: LogsFilters, background = false) => {
    const requestId = ++requestIdRef.current
    if (background) setRefreshing(true)
    else setInitialLoading(true)

    const to = new Date()
    const from = new Date(to.getTime() - filters.rangeMinutes * 60_000)

    try {
      const next = await fetchMonitoringLogs({
        service: filters.service,
        level: filters.level,
        search: filters.search.trim(),
        from: from.toISOString(),
        to: to.toISOString(),
        limit: 200,
      })

      if (requestId !== requestIdRef.current) return
      setResponse(next)
      setError(null)
    } catch (cause) {
      if (requestId !== requestIdRef.current) return
      setError(cause instanceof Error ? cause.message : 'Unable to load service logs')
    } finally {
      if (requestId !== requestIdRef.current) return
      setInitialLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(appliedFilters)
  }, [appliedFilters, load])

  useEffect(() => {
    if (!live) return

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load(appliedFilters, true)
      }
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [appliedFilters, live, load])

  useEffect(() => {
    const handleVisibility = () => {
      if (live && document.visibilityState === 'visible') {
        void load(appliedFilters, true)
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [appliedFilters, live, load])

  const updateDraft = <K extends keyof LogsFilters>(key: K, value: LogsFilters[K]) => {
    setDraftFilters((current) => ({ ...current, [key]: value }))
  }

  const applyFilters = () => {
    setAppliedFilters({ ...draftFilters, search: draftFilters.search.trim() })
  }

  const refreshNow = () => load(appliedFilters, true)

  return {
    draftFilters,
    appliedFilters,
    updateDraft,
    applyFilters,
    response,
    entries: response?.entries ?? [],
    error,
    initialLoading,
    refreshing,
    live,
    setLive,
    refreshNow,
  }
}
