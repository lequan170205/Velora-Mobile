type MonitoringErrorProps = {
  error: string | null
  title: string
  hasData: boolean
}

export function MonitoringError({ error, title, hasData }: MonitoringErrorProps) {
  if (!error) return null

  return (
    <div className="monitoring-warning" role="status">
      <strong>{title}</strong>
      <span>{hasData ? `${error} Showing the last successful metrics while the dashboard retries.` : error}</span>
    </div>
  )
}
