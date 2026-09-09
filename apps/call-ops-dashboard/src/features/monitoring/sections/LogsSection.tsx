import type { FormEvent } from 'react'

import { useLogsView, type LogsRangeMinutes } from '../hooks/useLogsView'
import type { MonitoringLogEntry, MonitoringLogLevel } from '../logsApi'

const SERVICE_OPTIONS = [
  'all',
  'api-gateway',
  'monitoring-service',
  'conversation-service',
  'call-service',
  'auth-service',
  'user-service',
  'friend-service',
  'notification-service',
  'content-service',
  'media-service',
  'media-processing-service',
  'media-processing-long-service',
  'reel-indexing-service',
  'reel-indexing-long-service',
  'payment-service',
  'mail-service',
  'ai-service',
  'nginx',
  'rabbitmq',
  'prometheus',
  'grafana',
  'loki',
  'alloy',
] as const

const LEVEL_OPTIONS: readonly MonitoringLogLevel[] = ['all', 'error', 'warn', 'info', 'debug']

const RANGE_OPTIONS: ReadonlyArray<{ value: LogsRangeMinutes; label: string }> = [
  { value: 15, label: '15 minutes' },
  { value: 60, label: '1 hour' },
  { value: 360, label: '6 hours' },
  { value: 1440, label: '24 hours' },
]

const formatTimestamp = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(date)
}

const levelLabel = (level: MonitoringLogEntry['level']) =>
  level === 'warn' ? 'WARN' : level.toUpperCase()

export function LogsSection() {
  const {
    draftFilters,
    appliedFilters,
    updateDraft,
    applyFilters,
    response,
    entries,
    error,
    initialLoading,
    refreshing,
    live,
    setLive,
    refreshNow,
  } = useLogsView()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    applyFilters()
  }

  return (
    <section className="logs-observability dashboard-view" aria-labelledby="logs-title" aria-busy={initialLoading}>
      <div className="logs-heading">
        <div>
          <span className="logs-eyebrow">Loki · Docker stdout/stderr</span>
          <h2 id="logs-title">Service logs</h2>
          <p>Search recent backend logs without exposing Loki or arbitrary LogQL to the browser.</p>
        </div>
        <div className="logs-live-controls">
          <span className={live ? 'logs-live-state active' : 'logs-live-state'}><i />{live ? 'Live · 10s' : 'Paused'}</span>
          <button className="ghost-button" type="button" onClick={() => setLive(!live)}>{live ? 'Pause' : 'Resume'}</button>
          <button className="secondary-button" type="button" disabled={refreshing} onClick={() => void refreshNow()}>{refreshing ? 'Refreshing…' : 'Refresh now'}</button>
        </div>
      </div>

      <form className="filter-panel logs-filter-panel" onSubmit={submit}>
        <div className="filter-grid logs-filter-grid">
          <label>
            Service
            <select value={draftFilters.service} onChange={(event) => updateDraft('service', event.target.value)}>
              {SERVICE_OPTIONS.map((service) => <option key={service} value={service}>{service === 'all' ? 'All services' : service}</option>)}
            </select>
          </label>
          <label>
            Level
            <select value={draftFilters.level} onChange={(event) => updateDraft('level', event.target.value as MonitoringLogLevel)}>
              {LEVEL_OPTIONS.map((level) => <option key={level} value={level}>{level === 'all' ? 'All levels' : level.toUpperCase()}</option>)}
            </select>
          </label>
          <label>
            Time range
            <select value={draftFilters.rangeMinutes} onChange={(event) => updateDraft('rangeMinutes', Number(event.target.value) as LogsRangeMinutes)}>
              {RANGE_OPTIONS.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
            </select>
          </label>
          <label className="logs-search-label">
            Contains text
            <input value={draftFilters.search} maxLength={200} onChange={(event) => updateDraft('search', event.target.value)} placeholder="callId, exception, timeout…" />
          </label>
        </div>
        <button className="primary-button filter-refresh" type="submit">Apply filters</button>
      </form>

      {error && (
        <div className="logs-error" role="alert">
          <strong>Logs are temporarily unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="logs-meta-row">
        <div>
          <strong>{entries.length}</strong> log lines
          <span> · {appliedFilters.service === 'all' ? 'all services' : appliedFilters.service} · {appliedFilters.level === 'all' ? 'all levels' : appliedFilters.level}</span>
        </div>
        <span>{response?.generatedAt ? `Updated ${formatTimestamp(response.generatedAt)}` : 'Waiting for Loki'}</span>
      </div>

      <div className="dashboard-panel logs-panel">
        {initialLoading && entries.length === 0 ? (
          <div className="empty-state logs-loading"><i>…</i><strong>Loading recent logs</strong><p>Querying the bounded Loki window through monitoring-service.</p></div>
        ) : entries.length === 0 ? (
          <div className="empty-state"><i>0</i><strong>No matching logs</strong><p>Try a wider time range, another service, or clear the text and level filters.</p></div>
        ) : (
          <div className="logs-list" role="log" aria-live="off">
            {entries.map((entry) => (
              <article className={`log-row level-${entry.level}`} key={`${entry.timestampNs}-${entry.service}-${entry.message}`}>
                <time dateTime={entry.timestamp} title={new Date(entry.timestamp).toLocaleString()}>{formatTimestamp(entry.timestamp)}</time>
                <span className={`log-level level-${entry.level}`}>{levelLabel(entry.level)}</span>
                <span className="log-service" title={entry.container ?? entry.service}>{entry.service}</span>
                <pre>{entry.message}</pre>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="logs-footnote">
        <span>{response?.mayHaveMore ? 'Showing the newest 200 matching lines; narrow the filters to inspect more precisely.' : 'Showing all matching lines returned for this bounded query.'}</span>
        <span>Levels are inferred from current plaintext Nest/Docker logs; service identity comes from Docker Compose labels.</span>
      </div>
    </section>
  )
}
