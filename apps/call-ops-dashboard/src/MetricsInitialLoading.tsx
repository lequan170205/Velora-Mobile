type Props = {
  eyebrow: string
  title: string
  description: string
}

export function MetricsInitialLoading({ eyebrow, title, description }: Props) {
  return (
    <section className="metrics-initial-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="metrics-loading-card">
        <div className="metrics-loading-spinner" aria-hidden="true" />
        <div className="metrics-loading-copy">
          <span>{eyebrow}</span>
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
      </div>

      <div className="metrics-loading-skeleton" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="metrics-loading-skeleton-card" key={index}>
            <i />
            <b />
            <em />
          </div>
        ))}
      </div>
    </section>
  )
}
