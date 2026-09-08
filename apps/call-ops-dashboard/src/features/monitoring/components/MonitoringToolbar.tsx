import { RANGE_OPTIONS, type RangeHours } from '../model'

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
