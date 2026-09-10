import type { MonitoringMetric, MonitoringPoint } from '../api'
import type { MonitoringSeriesDefinition } from '../model'
import { MonitoringChart } from './MonitoringChart'

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
          yAxis={item.yAxis}
          loading={initialLoading}
        />
      ))}
    </div>
  )
}
