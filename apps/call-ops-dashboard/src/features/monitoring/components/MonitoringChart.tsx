import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { MonitoringPoint } from '../api'

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

const darkAccent = (accent: string) =>
  ({
    '#7c3aed': '#9b8cff',
    '#2563eb': '#6f91ff',
    '#0f766e': '#45c9b8',
    '#c2410c': '#f59a62',
  })[accent] ?? accent

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
  const chartAccent = darkAccent(accent)
  const areaFill = fill === 'transparent' ? fill : `${chartAccent}24`

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
            <span>Current</span>
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
                <CartesianGrid stroke="#202a38" strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  scale="time"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                  tick={{ fill: '#738197', fontSize: 11 }}
                  tickFormatter={(value) => formatTime(Number(value))}
                />
                <YAxis
                  width={70}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#738197', fontSize: 11 }}
                  tickFormatter={(value) => axisFormatter(Number(value))}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ stroke: '#526176', strokeDasharray: '4 4' }}
                  contentStyle={{
                    border: '1px solid #2a3545',
                    borderRadius: 10,
                    background: '#111823',
                    color: '#f4f7fb',
                    boxShadow: '0 14px 34px rgba(0, 0, 0, 0.32)',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#8d9aaf', marginBottom: 4 }}
                  itemStyle={{ color: '#f4f7fb' }}
                  labelFormatter={(label) => new Date(Number(label)).toLocaleString()}
                  formatter={(value) => [valueFormatter(Number(value)), title]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={chartAccent}
                  fill={areaFill}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: chartAccent }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-range-summary" aria-label={`${title} range summary`}>
            <span><small>Low</small>{min === undefined ? '—' : valueFormatter(min)}</span>
            <span><small>Current</small>{current === undefined ? '—' : valueFormatter(current)}</span>
            <span><small>High</small>{max === undefined ? '—' : valueFormatter(max)}</span>
          </div>
        </>
      )}
    </article>
  )
}
