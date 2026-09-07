import type { MonitoringPoint } from './monitoring'

type Props = {
  points: MonitoringPoint[]
  valueFormatter: (value: number) => string
  emptyLabel?: string
}

const WIDTH = 640
const HEIGHT = 180
const PADDING_X = 10
const PADDING_Y = 16

export function MetricSparkline({
  points,
  valueFormatter,
  emptyLabel = 'No samples yet',
}: Props) {
  if (points.length === 0) {
    return <div className="sparkline-empty">{emptyLabel}</div>
  }

  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const spread = max - min
  const innerWidth = WIDTH - PADDING_X * 2
  const innerHeight = HEIGHT - PADDING_Y * 2

  const polyline = points
    .map((point, index) => {
      const x =
        points.length === 1
          ? WIDTH / 2
          : PADDING_X + (index / (points.length - 1)) * innerWidth
      const normalized = spread === 0 ? 0.5 : (point.value - min) / spread
      const y = PADDING_Y + innerHeight - normalized * innerHeight
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const last = points.at(-1)

  return (
    <div className="sparkline-wrap">
      <svg
        className="sparkline"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-label={`Minimum ${valueFormatter(min)}, maximum ${valueFormatter(max)}`}
      >
        <line x1="0" x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} className="sparkline-grid" />
        <polyline points={polyline} className="sparkline-line" />
      </svg>
      <div className="sparkline-meta">
        <span>min {valueFormatter(min)}</span>
        <strong>{last ? valueFormatter(last.value) : '—'}</strong>
        <span>max {valueFormatter(max)}</span>
      </div>
    </div>
  )
}
