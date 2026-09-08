import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MonitoringChart } from './MonitoringChart'
import {
  fetchMonitoringOverview,
  fetchMonitoringTimeseries,
  type MonitoringMetric,
  type MonitoringOverview,
  type MonitoringPoint,
} from './monitoring'
import type { Tone } from './monitoring-formatters'

const OVERVIEW_REFRESH_INTERVAL_MS = 15_000
const HISTORY_REFRESH_INTERVAL_MS = 60_000

export const RANGE_OPTIONS = [
  { label: '1h', accessibleLabel: 'Last hour', hours: 1, stepSeconds: 60 },
  { label: '6h', accessibleLabel: 'Last 6 hours', hours: 6, stepSeconds: 180 },
  { label: '24h', accessibleLabel: 'Last 24 hours', hours: 24, stepSeconds: 300 },
] as const

export type RangeHours = (typeof RANGE_OPTIONS)[number]['hours']

export type MonitoringSeriesDefinition = {
  metric: MonitoringMetric
  title: string
  question: string
  description: string
  formatter: (value: number) => string
  axisFormatter: (value: number) => string
  accent: string
  fill: string
  emptyTitle: string
  emptyDescription: string
}

export type MetricCardDefinition = {
  label: string
  value: string
  helper: string
  badge: string
  tone: Tone
}

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

  const refresh = useCallback(async (mode: RefreshMode = 'all') => {
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
  }, [errorMessage, selectedRange, series])

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

type MonitoringToolbarProps = {
  eyebrow: string
  title: string
  titleId: string
  description: string
  rangeLabel: string
  rangeHours: RangeHours
  onRangeChange: (hours: RangeHours) => void
  refreshing: boolean
  onRefresh: () => void
}

export function MonitoringToolbar({
  eyebrow,
  title,
  titleId,
  description,
  rangeLabel,
  rangeHours,
  onRangeChange,
  refreshing,
  onRefresh,
}: MonitoringToolbarProps) {
  return (
    <div className="system-toolbar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
        <p className="section-description">{description}</p>
      </div>
      <div className="monitoring-actions">
        <div className="range-switcher" aria-label={rangeLabel}>
          {RANGE_OPTIONS.map((option) => (
            <button
              className={option.hours === rangeHours ? 'range-button active' : 'range-button'}
              key={option.label}
              type="button"
              aria-label={option.accessibleLabel}
              title={option.accessibleLabel}
              onClick={() => onRangeChange(option.hours)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={refreshing}
          aria-busy={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
    </div>
  )
}

type MonitoringErrorProps = {
  error: string | null
  title: string
  hasData: boolean
}

export function MonitoringError({ error, title, hasData }: MonitoringErrorProps) {
  if (!error) return null

  return (
    <div className="monitoring-warning" role="status">
      <strong>{title}</strong>
      <span>
        {hasData
          ? `${error} Showing the last successful metrics while the dashboard retries.`
          : error}
      </span>
    </div>
  )
}

type HealthSummaryProps = {
  tone: Tone
  label: string
  title: string
  detail: string
  generatedAt?: string
  refreshing?: boolean
}

export function HealthSummary({
  tone,
  label,
  title,
  detail,
  generatedAt,
  refreshing = false,
}: HealthSummaryProps) {
  const icon = tone === 'good' ? '✓' : tone === 'warn' || tone === 'bad' ? '!' : '…'

  return (
    <div className={`health-summary ${tone}`}>
      <div className="health-summary-icon" aria-hidden="true">{icon}</div>
      <div className="health-summary-copy">
        <span>{label}</span>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <div className="health-summary-time">
        <span>{refreshing ? 'Refreshing' : 'Last checked'}</span>
        <strong>
          {refreshing
            ? 'Updating…'
            : generatedAt
              ? new Date(generatedAt).toLocaleTimeString()
              : 'Waiting'}
        </strong>
      </div>
    </div>
  )
}

type MetricCardGridProps = {
  cards: readonly MetricCardDefinition[]
  className?: string
  refreshing?: boolean
}

export function MetricCardGrid({ cards, className = '', refreshing = false }: MetricCardGridProps) {
  return (
    <div className={`friendly-metric-grid ${className}`.trim()} aria-busy={refreshing}>
      {cards.map((card) => (
        <article className="friendly-metric-card" key={card.label}>
          <div className="friendly-metric-topline">
            <span>{card.label}</span>
            <i className={`metric-badge ${card.tone}`}>{card.badge}</i>
          </div>
          <strong>{card.value}</strong>
          <p>{card.helper}</p>
        </article>
      ))}
    </div>
  )
}

type MonitoringChartsProps = {
  series: readonly MonitoringSeriesDefinition[]
  history: Partial<Record<MonitoringMetric, MonitoringPoint[]>>
  className?: string
  initialLoading?: boolean
}

export function MonitoringCharts({
  series,
  history,
  className = '',
  initialLoading = false,
}: MonitoringChartsProps) {
  return (
    <div className={`monitoring-grid ${className}`.trim()}>
      {series.map((item) => (
        <MonitoringChart
          key={item.metric}
          points={history[item.metric] ?? []}
          title={item.title}
          question={item.question}
          description={item.description}
          valueFormatter={item.formatter}
          axisFormatter={item.axisFormatter}
          accent={item.accent}
          fill={item.fill}
          emptyTitle={item.emptyTitle}
          emptyDescription={item.emptyDescription}
          loading={initialLoading}
        />
      ))}
    </div>
  )
}
