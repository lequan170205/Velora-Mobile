import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchMonitoringOverview,
  fetchMonitoringTimeseries,
  type MonitoringMetric,
  type MonitoringOverview,
  type MonitoringPoint,
} from '../api'
import { RANGE_OPTIONS, type MonitoringSeriesDefinition, type RangeHours } from '../model'

const OVERVIEW_REFRESH_INTERVAL_MS = 15_000
const HISTORY_REFRESH_INTERVAL_MS = 60_000

type RefreshMode = 'overview' | 'all'

type UseMonitoringViewInput = {
  series: readonly MonitoringSeriesDefinition[]
  errorMessage: string
}

export function useMonitoringView({ series, errorMessage }: UseMonitoringViewInput) {
  const [overview, setOverview] = useState<MonitoringOverview | null>(null)
  const [history, setHistory] = useState<Partial<Record<MonitoringMetric, MonitoringPoint[]>>>({})
  const [rangeHours, setRangeHours] = useState<RangeHours>(1)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const lastHistoryRefreshRef = useRef(0)

  const selectedRange = useMemo(
    () => RANGE_OPTIONS.find((option) => option.hours === rangeHours) ?? RANGE_OPTIONS[0],
    [rangeHours],
  )

  const refresh = useCallback(
    async (mode: RefreshMode = 'all') => {
      const requestId = ++requestIdRef.current
      setPending(true)

      try {
        if (mode === 'overview') {
          const nextOverview = await fetchMonitoringOverview()
          if (requestId !== requestIdRef.current) return
          setOverview(nextOverview)
        } else {
          const to = new Date()
          const from = new Date(to.getTime() - selectedRange.hours * 60 * 60 * 1000)
          const [nextOverview, ...seriesResults] = await Promise.all([
            fetchMonitoringOverview(),
            ...series.map(({ metric }) =>
              fetchMonitoringTimeseries({
                metric,
                from: from.toISOString(),
                to: to.toISOString(),
                stepSeconds: selectedRange.stepSeconds,
              }),
            ),
          ])

          if (requestId !== requestIdRef.current) return

          const nextHistory: Partial<Record<MonitoringMetric, MonitoringPoint[]>> = {}
          for (const item of seriesResults) nextHistory[item.metric] = item.points
          setOverview(nextOverview)
          setHistory(nextHistory)
          lastHistoryRefreshRef.current = Date.now()
        }

        setError(null)
      } catch (nextError) {
        if (requestId !== requestIdRef.current) return
        setError(nextError instanceof Error ? nextError.message : errorMessage)
      } finally {
        if (requestId === requestIdRef.current) setPending(false)
      }
    },
    [errorMessage, selectedRange, series],
  )

  useEffect(() => {
    void refresh('all')

    const interval = window.setInterval(() => {
      if (document.hidden) return
      const historyDue = Date.now() - lastHistoryRefreshRef.current >= HISTORY_REFRESH_INTERVAL_MS
      void refresh(historyDue ? 'all' : 'overview')
    }, OVERVIEW_REFRESH_INTERVAL_MS)

    const handleVisibilityChange = () => {
      if (!document.hidden) void refresh('all')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      requestIdRef.current += 1
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refresh])

  return {
    overview,
    history,
    rangeHours,
    setRangeHours,
    error,
    initialLoading: pending && overview === null,
    refreshing: pending && overview !== null,
    hasData: overview !== null,
    refreshNow: () => refresh('all'),
  }
}
