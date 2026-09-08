import type { CallTelemetryFilters } from './call-telemetry'

type Props = {
  filters: CallTelemetryFilters
  onChange: <Key extends keyof CallTelemetryFilters>(
    key: Key,
    value: CallTelemetryFilters[Key],
  ) => void
  onApply: () => void
}

export function CallFilterPanel({ filters, onChange, onApply }: Props) {
  return (
    <div className="filter-panel compact-filter-panel">
      <div className="filter-grid">
        <label>
          From
          <input type="date" value={filters.from} onChange={(event) => onChange('from', event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={filters.to} onChange={(event) => onChange('to', event.target.value)} />
        </label>
        <label>
          Platform
          <select value={filters.platform} onChange={(event) => onChange('platform', event.target.value)}>
            <option value="">All platforms</option>
            <option value="ios">iOS</option>
            <option value="android">Android</option>
            <option value="web">Web</option>
          </select>
        </label>
        <label>
          OS version
          <input value={filters.osVersion} onChange={(event) => onChange('osVersion', event.target.value)} placeholder="All versions" />
        </label>
        <label>
          App version
          <input value={filters.appVersion} onChange={(event) => onChange('appVersion', event.target.value)} placeholder="All versions" />
        </label>
        <label>
          Direction
          <select value={filters.direction} onChange={(event) => onChange('direction', event.target.value)}>
            <option value="">All directions</option>
            <option value="incoming">Incoming</option>
            <option value="outgoing">Outgoing</option>
          </select>
        </label>
      </div>
      <button className="primary-button filter-refresh" type="button" onClick={onApply}>
        Apply filters
      </button>
    </div>
  )
}
