import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
const SEARCH_DEBOUNCE_MS = 400

export function useLogsView() {
  const [filters, setFilters] = useState<LogsFilters>(DEFAULT_FILTERS)
  const [debouncedSearch, setDebouncedSearch] = useState(DEFAULT_FILTERS.search)
  const [response, setResponse] = useState<MonitoringLogsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [live, setLive] = useState(true)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const hasLoadedRef = useRef(false)

  const effectiveFilters = useMemo<LogsFilters>(
    () => ({
      service: filters.service,
      level: filters.level,
      search: debouncedSearch,
      rangeMinutes: filters.rangeMinutes,
    }),
    [debouncedSearch, filters.level, filters.rangeMinutes, filters.service],
  )

  const load = useCallback(async (nextFilters: LogsFilters, background = false) => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    const requestId = ++requestIdRef.current
    if (background) setRefreshing(true)
    else setInitialLoading(true)

    const to = new Date()
    const from = new Date(to.getTime() - nextFilters.rangeMinutes * 60_000)

    try {
      const next = await fetchMonitoringLogs({
        service: nextFilters.service,
        level: nextFilters.level,
        search: nextFilters.search.trim(),
        from: from.toISOString(),
        to: to.toISOString(),
        limit: 200,
        signal: controller.signal,
      })

      if (requestId !== requestIdRef.current) return
      setResponse(next)
      setError(null)
    } catch (cause) {
      if (requestId !== requestIdRef.current) return
      if (cause instanceof Error && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : 'Unable to load service logs')
    } finally {
      if (requestId !== requestIdRef.current) return
      hasLoadedRef.current = true
      setInitialLoading(false)
      setRefreshing(false)
      if (abortControllerRef.current === controller) abortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(filters.search.trim())
    }, SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [filters.search])

  useEffect(() => {
    void load(effectiveFilters, hasLoadedRef.current)
  }, [effectiveFilters, load])

  useEffect(() => {
    if (!live) return

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load(effectiveFilters, true)
      }
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [effectiveFilters, live, load])

  useEffect(() => {
    const handleVisibility = () => {
      if (live && document.visibilityState === 'visible') {
        void load(effectiveFilters, true)
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [effectiveFilters, live, load])

  useEffect(() => () => {
    requestIdRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  const updateFilter = <K extends keyof LogsFilters>(key: K, value: LogsFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const refreshNow = () => load(effectiveFilters, true)

  return {
    filters,
    appliedFilters: effectiveFilters,
    updateFilter,
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
