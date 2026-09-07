import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { MonitoringPoint } from './monitoring'

type Props = {
  points: MonitoringPoint[]
  title: string
  question: string
  description: string
  valueFormatter: (value: number) => string
  axisFormatter: (value: number) => string
  accent: string
  fill: string
  emptyTitle: string
  emptyDescription: string
  loading?: boolean
}

const normalizeTimestamp = (timestamp: number) =>
  timestamp > 10_000_000_000 ? timestamp : timestamp * 1000

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function MonitoringChart({
  points,
  title,
  question,
  description,
  valueFormatter,
  axisFormatter,
  accent,
  fill,
  emptyTitle,
  emptyDescription,
  loading = false,
}: Props) {
  const data = points.map((point) => ({
    timestamp: normalizeTimestamp(point.timestamp),
    value: point.value,
  }))

  const values = data.map((point) => point.value)
  const current = values.at(-1)
  const min = values.length ? Math.min(...values) : undefined
  const max = values.length ? Math.max(...values) : undefined

  return (
    <article className="monitoring-chart-card">
      <div className="monitoring-chart-heading">
        <div>
          <span className="chart-question">{question}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {current !== undefined && (
          <div className="chart-current-value">
            <span>Now</span>
            <strong>{valueFormatter(current)}</strong>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <div className="chart-empty-state">
          <div className="chart-empty-mark" aria-hidden="true">—</div>
          <strong>{loading ? 'Loading history…' : emptyTitle}</strong>
          <p>{loading ? 'Waiting for Prometheus samples.' : emptyDescription}</p>
        </div>
      ) : (
        <>
          <div className="metric-chart-canvas" role="img" aria-label={`${title} history`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e7edf5" strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  scale="time"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                  tick={{ fill: '#7b8aa3', fontSize: 12 }}
                  tickFormatter={(value) => formatTime(Number(value))}
                />
                <YAxis
                  width={70}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#7b8aa3', fontSize: 12 }}
                  tickFormatter={(value) => axisFormatter(Number(value))}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ stroke: '#94a3b8', strokeDasharray: '4 4' }}
                  contentStyle={{
                    border: '1px solid #dbe4ef',
                    borderRadius: 12,
                    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
                  }}
                  labelFormatter={(label) => new Date(Number(label)).toLocaleString()}
                  formatter={(value) => [valueFormatter(Number(value)), title]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={accent}
                  fill={fill}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-range-summary" aria-label={`${title} range summary`}>
            <span><small>Lowest</small>{min === undefined ? '—' : valueFormatter(min)}</span>
            <span><small>Current</small>{current === undefined ? '—' : valueFormatter(current)}</span>
            <span><small>Highest</small>{max === undefined ? '—' : valueFormatter(max)}</span>
          </div>
        </>
      )}
    </article>
  )
}
