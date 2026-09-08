import type { MonitoringMetric } from './api'
import type { Tone } from './formatters'

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
