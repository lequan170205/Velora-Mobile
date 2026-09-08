import type { Tone } from '../formatters'

type HealthSummaryProps = {
  tone: Tone
  label: string
  title: string
  detail: string
  generatedAt?: string
  refreshing?: boolean
}

export function HealthSummary({
  tone,
  label,
  title,
  detail,
  generatedAt,
  refreshing = false,
}: HealthSummaryProps) {
  const icon = tone === 'good' ? '✓' : tone === 'warn' || tone === 'bad' ? '!' : '…'

  return (
    <div className={`health-summary ${tone}`}>
      <div className="health-summary-icon" aria-hidden="true">{icon}</div>
      <div className="health-summary-copy">
        <span>{label}</span>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <div className="health-summary-time">
        <span>{refreshing ? 'Refreshing' : 'Last checked'}</span>
        <strong>{refreshing ? 'Updating…' : generatedAt ? new Date(generatedAt).toLocaleTimeString() : 'Waiting'}</strong>
      </div>
    </div>
  )
}
