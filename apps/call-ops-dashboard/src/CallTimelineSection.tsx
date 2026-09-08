import type { FormEvent } from 'react'

import { formatTimelineMetrics, milliseconds, type CallTimelineEvent } from './call-telemetry'

type Props = {
  callId: string
  timeline: CallTimelineEvent[]
  error: string | null
  onCallIdChange: (callId: string) => void
  onLoadTimeline: (callId: string) => void
}

export function CallTimelineSection({
  callId,
  timeline,
  error,
  onCallIdChange,
  onLoadTimeline,
}: Props) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onLoadTimeline(callId)
  }

  return (
    <section className="dashboard-view">
      <div className="section-header-row view-heading">
        <div>
          <p className="eyebrow">Deep inspection</p>
          <h2>Call timeline</h2>
          <p className="section-description">Trace one call from setup through media readiness, failures, and client-reported metrics.</p>
        </div>
      </div>

      <section className="panel timeline-panel">
        <form className="timeline-search" onSubmit={submit}>
          <div>
            <span className="timeline-search-label">Call ID</span>
            <input value={callId} onChange={(event) => onCallIdChange(event.target.value)} placeholder="Paste a call ID" />
          </div>
          <button className="primary-button" type="submit">Load timeline</button>
        </form>

        {error && <div className="dashboard-alert"><strong>Unable to load timeline.</strong><span>{error}</span></div>}

        {timeline.length === 0 ? (
          <div className="empty-panel-state large"><span>⌕</span><strong>Select a call to inspect</strong><p>Open a recent call or paste a call ID above.</p></div>
        ) : (
          <div className="table-shell timeline-table-shell">
            <table>
              <thead><tr><th>Time</th><th>Role</th><th>Stage</th><th>Outcome</th><th>Elapsed</th><th>Error</th><th>Metrics</th></tr></thead>
              <tbody>
                {timeline.map((item) => (
                  <tr key={item.eventId}>
                    <td>{new Date(item.occurredAt).toLocaleString()}</td>
                    <td>{item.role ?? 'pre-call'}</td>
                    <td>{item.stage}</td>
                    <td><span className={item.outcome === 'success' ? 'state-pill good' : item.outcome ? 'state-pill bad' : 'state-pill muted'}>{item.outcome ?? '—'}</span></td>
                    <td>{milliseconds(item.elapsedMs)}</td>
                    <td>{item.errorCode ? <span className="state-pill bad">{item.errorCode}</span> : '—'}</td>
                    <td className="metrics-cell">{formatTimelineMetrics(item.metricsJson)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
