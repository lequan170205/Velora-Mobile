export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

export const formatBytes = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  const mib = value / (1024 * 1024)
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GB`
  return `${mib.toFixed(mib >= 100 ? 0 : 1)} MB`
}

export const formatBytesAxis = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  const mib = value / (1024 * 1024)
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GB` : `${mib.toFixed(0)} MB`
}

export const formatPercent = (value: number, digits = 1) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—'

export const formatRate = (value: number) =>
  Number.isFinite(value) ? `${value.toFixed(value >= 10 ? 1 : 2)}/s` : '—'

export const formatSeconds = (value: number) =>
  Number.isFinite(value) ? `${(value * 1000).toFixed(value >= 1 ? 0 : 1)} ms` : '—'

export const formatCpu = (value: number) => formatPercent(value)

export const formatCount = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString() : '—'

export const formatLoad = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '—'

export const formatUptime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export const toneForThreshold = (value: number | null, warn: number, bad: number): Tone => {
  if (value === null || !Number.isFinite(value)) return 'neutral'
  if (value >= bad) return 'bad'
  if (value >= warn) return 'warn'
  return 'good'
}

export const badgeForThreshold = (value: number | null, warn: number, bad: number) => {
  const tone = toneForThreshold(value, warn, bad)
  if (tone === 'bad') return 'High'
  if (tone === 'warn') return 'Watch'
  if (tone === 'good') return 'Healthy'
  return 'Waiting'
}
