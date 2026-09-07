import { useCallback, useEffect, useMemo, useState } from 'react'

import type { FormEvent } from 'react'

import { MonitoringSection } from './MonitoringSection'
import { fetchApi } from './api'

type Summary = {
  attempts: number
  controlPlaneSuccessRate: number | null
  mediaReadySuccessRate: number | null
  timeToControlPlaneActiveMs: { p50: number | null; p95: number | null }
  timeToFirstRemoteAudioMs: { p50: number | null; p95: number | null }
  failures: Record<string, number>
  quality: {
    samples: number
    packetLossRate: number | null
    jitterMs: number | null
    roundTripTimeMs: number | null
    concealmentRate: number | null
    jitterBufferDelayMs: number | null
    badSampleRate: number | null
  }
}

type TimelineEvent = {
  eventId: string
  role: string | null
  eventType: string
  stage: string
  outcome: string | null
  elapsedMs: number
  occurredAt: string
  platform: string
  appVersion: string
  errorCode: string | null
  metricsJson: Record<string, unknown> | null
}

type RecentCallLeg = {
  callId: string
  attemptId: string
  role: string | null
  platform: string
  appVersion: string
  direction: string | null
  startedAt: string
  lastOccurredAt: string
  controlPlaneActive: boolean
  mediaReady: boolean
  failure: { stage: string; errorCode: string | null } | null
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10)
const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
const milliseconds = (value: number | null) => (value === null ? '—' : `${Math.round(value)} ms`)
const telemetrySearch = ({
  from,
  to,
  platform,
  osVersion,
  appVersion,
  direction,
}: {
  from: string
  to: string
  platform: string
  osVersion: string
  appVersion: string
  direction: string
}) =>
  new URLSearchParams({
    from: `${from}T00:00:00.000Z`,
    to: `${to}T23:59:59.999Z`,
    ...(platform ? { platform } : {}),
    ...(osVersion ? { osVersion } : {}),
    ...(appVersion ? { appVersion } : {}),
    ...(direction ? { direction } : {}),
  })

const metrics = (value: Record<string, unknown> | null) => {
  if (!value) return '—'

  const entries = Object.entries(value).filter(([, metric]) => metric !== null)
  if (entries.length === 0) return '—'

  return entries
    .map(([name, metric]) => {
      if (typeof metric === 'number') return `${name}: ${metric.toFixed(3)}`
      return `${name}: ${JSON.stringify(metric)}`
    })
    .join(' · ')
}

const navItems = [
  ['overview', 'Overview'],
  ['call-quality', 'Call quality'],
  ['recent-calls', 'Recent calls'],
  ['timeline', 'Call timeline'],
] as const

export function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 24 * 60 * 60 * 1000)))
  const [to, setTo] = useState(isoDate(new Date()))
  const [platform, setPlatform] = useState('')
  const [osVersion, setOsVersion] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [direction, setDirection] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [recentCallLegs, setRecentCallLegs] = useState<RecentCallLeg[]>([])
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [callId, setCallId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loadSummary = useCallback(async () => {
    const search = telemetrySearch({ from, to, platform, osVersion, appVersion, direction })
    const response = await fetchApi(`/calls/telemetry/summary?${search}`)
    if (!response.ok) throw new Error('Unable to load call telemetry')
    setSummary((await response.json()) as Summary)
  }, [appVersion, direction, from, osVersion, platform, to])

  const loadRecentCallLegs = useCallback(async () => {
    const search = telemetrySearch({ from, to, platform, osVersion, appVersion, direction })
    const response = await fetchApi(`/calls/telemetry/calls?${search}`)
    if (!response.ok) throw new Error('Unable to load recent call legs')
    setRecentCallLegs((await response.json()) as RecentCallLeg[])
  }, [appVersion, direction, from, osVersion, platform, to])

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetchApi('/auth/me')
        if (!response.ok) return
        const user = (await response.json()) as { roles?: string[] }
        setAuthenticated(user.roles?.includes('ADMIN') === true)
      } finally {
        setCheckingSession(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!authenticated) return

    void Promise.all([loadSummary(), loadRecentCallLegs()]).catch((nextError: Error) =>
      setError(nextError.message),
    )
  }, [authenticated, loadRecentCallLegs, loadSummary])

  const callCards = useMemo(
    () => [
      {
        label: 'Call attempts',
        value: summary?.attempts.toString() ?? '—',
        helper: 'Call legs observed in this filter range.',
      },
      {
        label: 'Call setup success',
        value: percent(summary?.controlPlaneSuccessRate ?? null),
        helper: 'Calls that reached an active control-plane state.',
      },
      {
        label: 'Media ready',
        value: percent(summary?.mediaReadySuccessRate ?? null),
        helper: 'Calls that successfully reached media-ready.',
      },
      {
        label: 'Setup time p95',
        value: milliseconds(summary?.timeToControlPlaneActiveMs.p95 ?? null),
        helper: `Median ${milliseconds(summary?.timeToControlPlaneActiveMs.p50 ?? null)} · lower is better.`,
      },
      {
        label: 'First audio p95',
        value: milliseconds(summary?.timeToFirstRemoteAudioMs.p95 ?? null),
        helper: `Median ${milliseconds(summary?.timeToFirstRemoteAudioMs.p50 ?? null)} · lower is better.`,
      },
      {
        label: 'Poor audio samples',
        value: percent(summary?.quality.badSampleRate ?? null),
        helper: 'Share of quality samples classified as poor.',
      },
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

  const loadCallTimeline = async (nextCallId: string) => {
    if (!nextCallId.trim()) return
    setError(null)
    const response = await fetchApi(
      `/calls/telemetry/calls/${encodeURIComponent(nextCallId.trim())}`,
    )
    if (!response.ok) {
      setError('Call telemetry was not found')
      return
    }
    setTimeline((await response.json()) as TimelineEvent[])
  }

  const lookupCall = async (event: FormEvent) => {
    event.preventDefault()
    await loadCallTimeline(callId)
  }

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    const response = await fetchApi('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) {
      setError('Sign-in failed')
      return
    }

    const profile = await fetchApi('/auth/me')
    if (!profile.ok) {
      setError('Unable to verify the dashboard session')
      return
    }

    const user = (await profile.json()) as { roles?: string[] }
    if (!user.roles?.includes('ADMIN')) {
      setError('This account is not an administrator')
      return
    }

    setAuthenticated(true)
  }

  const logout = async () => {
    try {
      await fetchApi('/auth/logout', { method: 'POST' })
    } finally {
      setAuthenticated(false)
      setSummary(null)
      setRecentCallLegs([])
      setTimeline([])
      setPassword('')
    }
  }

  if (checkingSession) {
    return (
      <main className="session-loader">
        <div className="brand-mark">V</div>
        <span>Checking admin session…</span>
      </main>
    )
  }

  if (!authenticated) {
    return (
      <main className="login-shell">
        <section className="login-brand-panel" aria-hidden="true">
          <div className="brand-lockup">
            <div className="brand-mark">V</div>
            <div>
              <strong>Velora</strong>
              <span>Operations Console</span>
            </div>
          </div>
          <div className="login-brand-copy">
            <span className="status-chip"><i /> Internal operations</span>
            <h1>Monitor service health and call quality from one place.</h1>
            <p>Live observability, call QoE, failures, and per-call timelines for Velora administrators.</p>
          </div>
          <p className="login-footnote">Restricted access · Administrator accounts only</p>
        </section>

        <section className="login-form-panel">
          <form className="login-card" onSubmit={login}>
            <div className="login-heading">
              <span>Admin sign in</span>
              <h2>Welcome back</h2>
              <p>Use your Velora administrator account to continue.</p>
            </div>
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@velora.app"
                autoComplete="email"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </label>
            <button className="primary-button login-button" type="submit">Sign in to dashboard</button>
            {error && <p className="error login-error">{error}</p>}
          </form>
        </section>
      </main>
    )
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand-lockup sidebar-brand">
          <div className="brand-mark">V</div>
          <div>
            <strong>Velora</strong>
            <span>Operations</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Dashboard navigation">
          <span className="nav-label">Workspace</span>
          {navItems.map(([id, label], index) => (
            <a className={index === 0 ? 'active' : ''} href={`#${id}`} key={id}>
              <i aria-hidden="true" />
              {label}
            </a>
          ))}
        </nav>

        <div className="sidebar-status">
          <div className="sidebar-status-line">
            <span><i /> Production</span>
            <strong>Live</strong>
          </div>
          <p>Metrics refresh automatically. Authentication refreshes in the background.</p>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="topbar-kicker">Operations / Dashboard</span>
            <h1>System overview</h1>
          </div>
          <div className="topbar-actions">
            <span className="live-indicator"><i /> Live data</span>
            <div className="admin-user">
              <span>AD</span>
              <div>
                <strong>Administrator</strong>
                <small>Admin session</small>
              </div>
            </div>
            <button className="ghost-button" type="button" onClick={() => void logout()}>Sign out</button>
          </div>
        </header>

        <main className="dashboard-content">
          <MonitoringSection />

          <section className="dashboard-section" id="call-quality">
            <div className="section-header-row">
              <div>
                <p className="eyebrow">Application telemetry</p>
                <h2>Call quality</h2>
                <p className="section-description">Setup reliability, media readiness, and network quality reported by Velora clients.</p>
              </div>
              <span className="section-meta">{summary?.quality.samples ?? 0} quality samples</span>
            </div>

            <div className="filter-panel">
              <div className="filter-grid">
                <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
                <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
                <label>
                  Platform
                  <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                    <option value="">All platforms</option>
                    <option value="ios">iOS</option>
                    <option value="android">Android</option>
                    <option value="web">Web</option>
                  </select>
                </label>
                <label>OS version<input value={osVersion} onChange={(event) => setOsVersion(event.target.value)} placeholder="All versions" /></label>
                <label>App version<input value={appVersion} onChange={(event) => setAppVersion(event.target.value)} placeholder="All versions" /></label>
                <label>
                  Direction
                  <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                    <option value="">All directions</option>
                    <option value="incoming">Incoming</option>
                    <option value="outgoing">Outgoing</option>
                  </select>
                </label>
              </div>
              <button
                className="primary-button filter-refresh"
                type="button"
                onClick={() =>
                  void Promise.all([loadSummary(), loadRecentCallLegs()]).catch((nextError: Error) =>
                    setError(nextError.message),
                  )
                }
              >
                Apply filters
              </button>
            </div>

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

            <div className="two-column-grid">
              <section className="dashboard-panel">
                <div className="panel-heading">
                  <div><span>Network health</span><h3>Average quality sample</h3></div>
                  <span className="panel-tag">Client reported</span>
                </div>
                <div className="quality-grid">
                  {qualityCards.map(([label, value, helper]) => (
                    <div className="quality-item" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <small>{helper}</small>
                    </div>
                  ))}
                </div>
              </section>

              <section className="dashboard-panel failures-panel">
                <div className="panel-heading">
                  <div><span>Reliability</span><h3>Failures</h3></div>
                  <span className={failureCount > 0 ? 'panel-tag warning' : 'panel-tag success'}>{failureCount} total</span>
                </div>
                {Object.keys(summary?.failures ?? {}).length === 0 ? (
                  <div className="empty-state compact"><i>✓</i><strong>No failures in this range</strong><p>All observed call attempts are clear of recorded failures.</p></div>
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

          <section className="dashboard-section" id="recent-calls">
            <div className="section-header-row">
              <div>
                <p className="eyebrow">Call inspection</p>
                <h2>Recent calls</h2>
                <p className="section-description">Inspect recent call legs and open a call timeline for deeper debugging.</p>
              </div>
              <span className="section-meta">{recentCallLegs.length} results</span>
            </div>

            <section className="dashboard-panel table-panel">
              {recentCallLegs.length === 0 ? (
                <div className="empty-state"><i>—</i><strong>No calls in this range</strong><p>Adjust the filters above or wait for new call telemetry.</p></div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Started</th><th>Call</th><th>Client</th><th>Direction</th><th>Control plane</th><th>Media</th><th>Failure</th><th /></tr></thead>
                    <tbody>
                      {recentCallLegs.map((leg) => (
                        <tr key={`${leg.callId}:${leg.attemptId}`}>
                          <td><span className="table-primary">{new Date(leg.startedAt).toLocaleString()}</span></td>
                          <td><code>{leg.callId}</code></td>
                          <td><span className="table-primary">{leg.platform}</span><small>{leg.appVersion}</small></td>
                          <td>{`${leg.role ?? '—'} · ${leg.direction ?? '—'}`}</td>
                          <td><span className={leg.controlPlaneActive ? 'state-pill success' : 'state-pill muted'}>{leg.controlPlaneActive ? 'Ready' : 'Pending'}</span></td>
                          <td><span className={leg.mediaReady ? 'state-pill success' : 'state-pill muted'}>{leg.mediaReady ? 'Ready' : 'Pending'}</span></td>
                          <td>{leg.failure ? <span className="state-pill danger">{leg.failure.errorCode ?? leg.failure.stage}</span> : <span className="muted-text">None</span>}</td>
                          <td><button className="table-action" type="button" onClick={() => { setCallId(leg.callId); void loadCallTimeline(leg.callId) }}>Inspect</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>

          <section className="dashboard-section" id="timeline">
            <div className="section-header-row">
              <div>
                <p className="eyebrow">Deep inspection</p>
                <h2>Call timeline</h2>
                <p className="section-description">Trace one call from setup through media events and failures.</p>
              </div>
            </div>

            <section className="dashboard-panel table-panel">
              <form className="timeline-search" onSubmit={lookupCall}>
                <label><span>Call ID</span><input value={callId} onChange={(event) => setCallId(event.target.value)} placeholder="Paste a call ID" /></label>
                <button className="primary-button" type="submit">Load timeline</button>
              </form>

              {timeline.length === 0 ? (
                <div className="empty-state timeline-empty"><i>↳</i><strong>Select a recent call or enter a call ID</strong><p>The full event timeline will appear here.</p></div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Time</th><th>Role</th><th>Stage</th><th>Outcome</th><th>Elapsed</th><th>Error</th><th>Metrics</th></tr></thead>
                    <tbody>
                      {timeline.map((item) => (
                        <tr key={item.eventId}>
                          <td>{new Date(item.occurredAt).toLocaleString()}</td>
                          <td>{item.role ?? 'pre-call'}</td>
                          <td><span className="table-primary">{item.stage}</span></td>
                          <td>{item.outcome ?? '—'}</td>
                          <td>{milliseconds(item.elapsedMs)}</td>
                          <td>{item.errorCode ? <span className="state-pill danger">{item.errorCode}</span> : <span className="muted-text">None</span>}</td>
                          <td className="metrics-cell">{metrics(item.metricsJson)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        </main>
      </div>
    </div>
  )
}
