import { useCallback, useEffect, useMemo, useState } from 'react'

import type { FormEvent } from 'react'

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

const apiBaseUrl = import.meta.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? ''
const fetchApi = (path: string, options?: RequestInit) =>
  fetch(`${apiBaseUrl}${path}`, { credentials: 'include', ...options })

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
      if (typeof metric === 'number') {
        return `${name}: ${metric.toFixed(3)}`
      }

      return `${name}: ${JSON.stringify(metric)}`
    })
    .join(' · ')
}

export function App() {
  const [authenticated, setAuthenticated] = useState(false)
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
      const response = await fetchApi('/auth/me')
      if (!response.ok) {
        return
      }

      const user = (await response.json()) as { roles?: string[] }
      setAuthenticated(user.roles?.includes('ADMIN') === true)
    })()
  }, [])

  useEffect(() => {
    if (!authenticated) {
      return
    }

    void Promise.all([loadSummary(), loadRecentCallLegs()]).catch((nextError: Error) =>
      setError(nextError.message),
    )
  }, [authenticated, loadRecentCallLegs, loadSummary])

  const cards = useMemo(
    () => [
      ['Attempts', summary?.attempts.toString() ?? '—'],
      ['Control-plane success', percent(summary?.controlPlaneSuccessRate ?? null)],
      ['Media-ready success', percent(summary?.mediaReadySuccessRate ?? null)],
      [
        'Setup p50 / p95',
        `${milliseconds(summary?.timeToControlPlaneActiveMs.p50 ?? null)} / ${milliseconds(summary?.timeToControlPlaneActiveMs.p95 ?? null)}`,
      ],
      [
        'First remote audio p50 / p95',
        `${milliseconds(summary?.timeToFirstRemoteAudioMs.p50 ?? null)} / ${milliseconds(summary?.timeToFirstRemoteAudioMs.p95 ?? null)}`,
      ],
      ['Bad audio samples', percent(summary?.quality.badSampleRate ?? null)],
    ],
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

  if (!authenticated) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={login}>
          <p className="eyebrow">Velora internal</p>
          <h1>Call operations</h1>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit">Sign in</button>
          {error && <p className="error">{error}</p>}
        </form>
      </main>
    )
  }

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Velora internal</p>
          <h1>Call quality</h1>
        </div>
      </header>
      <section className="filters">
        <label>
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          Platform
          <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
            <option value="">All</option>
            <option value="ios">iOS</option>
            <option value="android">Android</option>
            <option value="web">Web</option>
          </select>
        </label>
        <label>
          OS version
          <input
            value={osVersion}
            onChange={(event) => setOsVersion(event.target.value)}
            placeholder="All"
          />
        </label>
        <label>
          App version
          <input
            value={appVersion}
            onChange={(event) => setAppVersion(event.target.value)}
            placeholder="All"
          />
        </label>
        <label>
          Direction
          <select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="">All</option>
            <option value="incoming">Incoming</option>
            <option value="outgoing">Outgoing</option>
          </select>
        </label>
        <button
          onClick={() =>
            void Promise.all([loadSummary(), loadRecentCallLegs()]).catch((nextError: Error) =>
              setError(nextError.message),
            )
          }
        >
          Refresh
        </button>
      </section>
      {error && <p className="error">{error}</p>}
      <section className="cards">
        {cards.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Average quality sample</h2>
        <dl>
          <div>
            <dt>Packet loss</dt>
            <dd>{percent(summary?.quality.packetLossRate ?? null)}</dd>
          </div>
          <div>
            <dt>Jitter</dt>
            <dd>{milliseconds(summary?.quality.jitterMs ?? null)}</dd>
          </div>
          <div>
            <dt>RTT</dt>
            <dd>{milliseconds(summary?.quality.roundTripTimeMs ?? null)}</dd>
          </div>
          <div>
            <dt>Concealment</dt>
            <dd>{percent(summary?.quality.concealmentRate ?? null)}</dd>
          </div>
          <div>
            <dt>Jitter buffer</dt>
            <dd>{milliseconds(summary?.quality.jitterBufferDelayMs ?? null)}</dd>
          </div>
        </dl>
      </section>
      <section className="panel">
        <h2>Failures</h2>
        {Object.keys(summary?.failures ?? {}).length === 0 ? (
          <p>No failures in this range.</p>
        ) : (
          <ul>
            {Object.entries(summary?.failures ?? {}).map(([reason, count]) => (
              <li key={reason}>
                <span>{reason}</span>
                <strong>{count}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <h2>Recent call legs</h2>
        {recentCallLegs.length === 0 ? (
          <p>No call legs in this range.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Call ID</th>
                <th>Platform</th>
                <th>Role / direction</th>
                <th>Control-plane</th>
                <th>Media-ready</th>
                <th>Failure</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recentCallLegs.map((leg) => (
                <tr key={`${leg.callId}:${leg.attemptId}`}>
                  <td>{new Date(leg.startedAt).toLocaleString()}</td>
                  <td>{leg.callId}</td>
                  <td>{`${leg.platform} ${leg.appVersion}`}</td>
                  <td>{`${leg.role ?? '—'} / ${leg.direction ?? '—'}`}</td>
                  <td>{leg.controlPlaneActive ? 'Ready' : '—'}</td>
                  <td>{leg.mediaReady ? 'Ready' : '—'}</td>
                  <td>
                    {leg.failure
                      ? `${leg.failure.stage}:${leg.failure.errorCode ?? 'unknown'}`
                      : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        setCallId(leg.callId)
                        void loadCallTimeline(leg.callId)
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <h2>Call timeline</h2>
        <form className="lookup" onSubmit={lookupCall}>
          <input
            value={callId}
            onChange={(event) => setCallId(event.target.value)}
            placeholder="Call ID"
          />
          <button type="submit">Lookup</button>
        </form>
        {timeline.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Role</th>
                <th>Stage</th>
                <th>Outcome</th>
                <th>Elapsed</th>
                <th>Error</th>
                <th>Metrics</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((item) => (
                <tr key={item.eventId}>
                  <td>{new Date(item.occurredAt).toLocaleString()}</td>
                  <td>{item.role ?? 'pre-call'}</td>
                  <td>{item.stage}</td>
                  <td>{item.outcome ?? '—'}</td>
                  <td>{milliseconds(item.elapsedMs)}</td>
                  <td>{item.errorCode ?? '—'}</td>
                  <td>{metrics(item.metricsJson)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
