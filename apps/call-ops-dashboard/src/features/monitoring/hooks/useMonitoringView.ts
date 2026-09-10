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

const messageFromError = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

export function useMonitoringView({ series, errorMessage }: UseMonitoringViewInput) {
  const [overview, setOverview] = useState<MonitoringOverview | null>(null)
  const [history, setHistory] = useState<Partial<Record<MonitoringMetric, MonitoringPoint[]>>>({})
  const [rangeHours, setRangeHours] = useState<RangeHours>(1)
  const [pending, setPending] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
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
          try {
            const nextOverview = await fetchMonitoringOverview()
            if (requestId !== requestIdRef.current) return
            setOverview(nextOverview)
            setOverviewError(null)
          } catch (nextError) {
            if (requestId !== requestIdRef.current) return
            setOverviewError(messageFromError(nextError, errorMessage))
          }
          return
        }

        const to = new Date()
        const from = new Date(to.getTime() - selectedRange.hours * 60 * 60 * 1000)
        const [overviewResult, ...seriesResults] = await Promise.allSettled([
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

        if (overviewResult.status === 'fulfilled') {
          setOverview(overviewResult.value)
          setOverviewError(null)
        } else {
          setOverviewError(messageFromError(overviewResult.reason, errorMessage))
        }

        const historyUpdates: Partial<Record<MonitoringMetric, MonitoringPoint[]>> = {}
        const failedMetrics: MonitoringMetric[] = []

        seriesResults.forEach((result, index) => {
          const metric = series[index]?.metric
          if (!metric) return

          if (result.status === 'fulfilled') {
            historyUpdates[metric] = result.value.points
          } else {
            failedMetrics.push(metric)
          }
        })

        setHistory((current) => ({ ...current, ...historyUpdates }))
        setHistoryError(
          failedMetrics.length > 0
            ? `Unable to refresh history for ${failedMetrics.join(', ')}.`
            : null,
        )
        lastHistoryRefreshRef.current = Date.now()
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

  const error = overviewError ?? historyError

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
