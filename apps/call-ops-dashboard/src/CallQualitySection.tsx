import { useMemo } from 'react'

import { CallFilterPanel } from './CallFilterPanel'
import { milliseconds, percent, type CallSummary, type CallTelemetryFilters } from './call-telemetry'

type Props = {
  summary: CallSummary | null
  filters: CallTelemetryFilters
  error: string | null
  onFilterChange: <Key extends keyof CallTelemetryFilters>(
    key: Key,
    value: CallTelemetryFilters[Key],
  ) => void
  onApplyFilters: () => void
}

export function CallQualitySection({
  summary,
  filters,
  error,
  onFilterChange,
  onApplyFilters,
}: Props) {
  const callCards = useMemo(
    () => [
      { label: 'Call attempts', value: summary?.attempts.toString() ?? '—', helper: 'Call legs observed in this filter range.' },
      { label: 'Call setup success', value: percent(summary?.controlPlaneSuccessRate ?? null), helper: 'Calls that reached an active control-plane state.' },
      { label: 'Media ready', value: percent(summary?.mediaReadySuccessRate ?? null), helper: 'Calls that successfully reached media-ready.' },
      { label: 'Setup time p95', value: milliseconds(summary?.timeToControlPlaneActiveMs.p95 ?? null), helper: `Median ${milliseconds(summary?.timeToControlPlaneActiveMs.p50 ?? null)} · lower is better.` },
      { label: 'First audio p95', value: milliseconds(summary?.timeToFirstRemoteAudioMs.p95 ?? null), helper: `Median ${milliseconds(summary?.timeToFirstRemoteAudioMs.p50 ?? null)} · lower is better.` },
      { label: 'Poor audio samples', value: percent(summary?.quality.badSampleRate ?? null), helper: 'Share of quality samples classified as poor.' },
    ],
    [summary],
  )

  const qualityCards = useMemo(
    () => [
      ['Packet loss', percent(summary?.quality.packetLossRate ?? null), 'Audio packets that never arrived.'],
      ['Jitter', milliseconds(summary?.quality.jitterMs ?? null), 'Variation in packet arrival time.'],
      ['Round-trip time', milliseconds(summary?.quality.roundTripTimeMs ?? null), 'Network response delay.'],
      ['Concealment', percent(summary?.quality.concealmentRate ?? null), 'Audio reconstructed to hide missing packets.'],
      ['Jitter buffer', milliseconds(summary?.quality.jitterBufferDelayMs ?? null), 'Extra buffering used to smooth playback.'],
      ['Samples', summary?.quality.samples.toString() ?? '—', 'Quality samples included in this view.'],
    ],
    [summary],
  )

  const failureCount = useMemo(
    () => Object.values(summary?.failures ?? {}).reduce((total, count) => total + count, 0),
    [summary],
  )

  return (
    <section className="dashboard-view">
      <div className="section-header-row view-heading">
        <div>
          <p className="eyebrow">Application telemetry</p>
          <h2>Call quality</h2>
          <p className="section-description">Setup reliability, media readiness, and network quality reported by Velora clients.</p>
        </div>
        <span className="section-meta">{summary?.quality.samples ?? 0} quality samples</span>
      </div>

      <CallFilterPanel filters={filters} onChange={onFilterChange} onApply={onApplyFilters} />
      {error && <div className="dashboard-alert"><strong>Something needs attention.</strong><span>{error}</span></div>}

      <div className="metric-grid call-kpi-grid">
        {callCards.map((card) => (
          <article className="metric-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.helper}</p>
          </article>
        ))}
      </div>

      <div className="two-column-panels">
        <section className="panel quality-panel">
          <div className="panel-heading"><div><p className="eyebrow">Network experience</p><h2>Average quality</h2></div><span className="section-meta">Client reported</span></div>
          <div className="quality-grid">
            {qualityCards.map(([label, value, helper]) => (
              <div className="quality-item" key={label}><span>{label}</span><strong>{value}</strong><small>{helper}</small></div>
            ))}
          </div>
        </section>

        <section className="panel failures-panel">
          <div className="panel-heading"><div><p className="eyebrow">Reliability</p><h2>Failures</h2></div><span className={failureCount > 0 ? 'count-badge bad' : 'count-badge good'}>{failureCount}</span></div>
          {Object.keys(summary?.failures ?? {}).length === 0 ? (
            <div className="empty-panel-state"><span>✓</span><strong>No failures in this range</strong><p>Nothing needs attention for the selected filters.</p></div>
          ) : (
            <ul className="failure-list">
              {Object.entries(summary?.failures ?? {}).map(([reason, count]) => (
                <li key={reason}><span>{reason}</span><strong>{count}</strong></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  )
}
