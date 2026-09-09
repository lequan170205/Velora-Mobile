import { useAlertsView } from '../hooks/useAlertsView'
import type { MonitoringAlert } from '../alertsApi'

const formatTimestamp = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

const formatActiveFor = (value: string | null) => {
  if (!value) return 'Start time unavailable'
  const startedAt = Date.parse(value)
  if (!Number.isFinite(startedAt)) return 'Start time unavailable'

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (elapsedSeconds < 60) return `Active for ${elapsedSeconds}s`
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `Active for ${elapsedMinutes}m`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `Active for ${elapsedHours}h ${elapsedMinutes % 60}m`
  return `Active for ${Math.floor(elapsedHours / 24)}d ${elapsedHours % 24}h`
}

const alertKey = (alert: MonitoringAlert) => {
  const labelKey = Object.entries(alert.labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('|')
  return `${alert.name}:${alert.activeAt ?? 'unknown'}:${labelKey}`
}

export function AlertsSection() {
  const {
    response,
    alerts,
    counts,
    error,
    initialLoading,
    refreshing,
    refreshNow,
  } = useAlertsView()

  return (
    <section className="alerts-observability dashboard-view" aria-labelledby="alerts-title" aria-busy={initialLoading}>
      <div className="alerts-heading">
        <div>
          <span className="alerts-eyebrow">Prometheus · active rule state</span>
          <h2 id="alerts-title">Active alerts</h2>
          <p>Pending and firing conditions from host, Conversation, Call, and monitoring-service rules. Resolved alerts disappear from this live view.</p>
        </div>
        <button className="secondary-button" type="button" disabled={refreshing} onClick={() => void refreshNow()}>
          {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      {error && (
        <div className="alerts-error" role="alert">
          <strong>Alert state is temporarily unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="alert-summary-grid" aria-label="Active alert counts">
        <article><span>Total active</span><strong>{counts?.total ?? '—'}</strong><small>Pending + firing</small></article>
        <article className={counts?.critical ? 'has-critical' : ''}><span>Critical</span><strong>{counts?.critical ?? '—'}</strong><small>Critical severity</small></article>
        <article className={counts?.firing ? 'has-firing' : ''}><span>Firing</span><strong>{counts?.firing ?? '—'}</strong><small>Threshold duration met</small></article>
        <article><span>Pending</span><strong>{counts?.pending ?? '—'}</strong><small>Waiting for rule duration</small></article>
      </div>

      <div className="alerts-meta-row">
        <span>Auto-refresh · 15s</span>
        <span>{response?.generatedAt ? `Updated ${formatTimestamp(response.generatedAt)}` : 'Waiting for Prometheus'}</span>
      </div>

      <div className="dashboard-panel alerts-panel">
        {initialLoading && alerts.length === 0 ? (
          <div className="empty-state alerts-loading"><i>…</i><strong>Loading active alerts</strong><p>Reading evaluated Prometheus rule state through monitoring-service.</p></div>
        ) : alerts.length === 0 ? (
          <div className="empty-state alerts-clear"><i>✓</i><strong>No active alerts</strong><p>No rule is currently pending or firing. This view is live state, not alert history.</p></div>
        ) : (
          <div className="alerts-list">
            {alerts.map((alert) => (
              <article className={`alert-row severity-${alert.severity} state-${alert.state}`} key={alertKey(alert)}>
                <div className="alert-row-topline">
                  <div className="alert-badges">
                    <span className={`alert-severity severity-${alert.severity}`}>{alert.severity}</span>
                    <span className={`alert-state state-${alert.state}`}>{alert.state}</span>
                    <span className="alert-service">{alert.service}</span>
                  </div>
                  <time dateTime={alert.activeAt ?? undefined} title={alert.activeAt ? formatTimestamp(alert.activeAt) : undefined}>{formatActiveFor(alert.activeAt)}</time>
                </div>
                <h3>{alert.summary}</h3>
                {alert.description && <p>{alert.description}</p>}
                <details>
                  <summary>Rule details</summary>
                  <div className="alert-technical-grid">
                    <span><b>Rule</b>{alert.name}</span>
                    <span><b>Current value</b>{alert.value === null ? 'Unavailable' : alert.value.toPrecision(4)}</span>
                  </div>
                </details>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="alerts-footnote">
        <span>Prometheus handles rule evaluation only in this lightweight profile.</span>
        <span>No Alertmanager is running yet, so this page does not provide silences, grouping, or external notifications.</span>
      </div>
    </section>
  )
}
