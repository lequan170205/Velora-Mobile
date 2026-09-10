import { useEffect, useState } from 'react'

import type { FormEvent } from 'react'

import {
  CallQualitySection,
  CallTimelineSection,
  RecentCallsSection,
  useCallTelemetry,
} from '../features/calls'
import {
  AlertsSection,
  CallServiceSection,
  ConversationSection,
  LogsSection,
  MonitoringSection,
  ServerSection,
} from '../features/monitoring'
import { fetchApi } from '../shared/api/client'
import {
  DashboardShell,
  LoginScreen,
  SessionLoader,
  viewFromHash,
  type ViewId,
} from './DashboardShell'
import { useMonitoringHeartbeat } from '../features/monitoring/hooks/useMonitoringHeartbeat'
import { getMonitoringConnectionState } from '../features/monitoring/fresshness'

export function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [activeView, setActiveView] = useState<ViewId>(viewFromHash)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const calls = useCallTelemetry(authenticated)
  const [now, setNow] = useState(Date.now())
  const heartbeat = useMonitoringHeartbeat(authenticated)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 5_000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onHashChange = () => setActiveView(viewFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

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

  const connectionState = getMonitoringConnectionState({
    now,
    lastSuccessfulAt: heartbeat.lastSuccessfulAt,
    refreshing: heartbeat.refreshing,
    hasError: heartbeat.error !== null,
  })

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setLoginError(null)

    const response = await fetchApi('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) {
      setLoginError('Sign-in failed')
      return
    }

    const profile = await fetchApi('/auth/me')
    if (!profile.ok) {
      setLoginError('Unable to verify the dashboard session')
      return
    }

    const user = (await profile.json()) as { roles?: string[] }
    if (!user.roles?.includes('ADMIN')) {
      setLoginError('This account is not an administrator')
      return
    }

    setAuthenticated(true)
  }

  const logout = async () => {
    try {
      await fetchApi('/auth/logout', { method: 'POST' })
    } finally {
      setAuthenticated(false)
      setPassword('')
      setLoginError(null)
      calls.reset()
    }
  }

  const navigate = (view: ViewId) => {
    if (window.location.hash !== `#${view}`) window.location.hash = view
    setActiveView(view)
  }

  const inspectCall = (callId: string) => {
    calls.inspectCall(callId)
    navigate('timeline')
  }

  if (checkingSession) return <SessionLoader />

  if (!authenticated) {
    return (
      <LoginScreen
        email={email}
        password={password}
        error={loginError}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={login}
      />
    )
  }

  return (
    <DashboardShell
      activeView={activeView}
      onNavigate={navigate}
      onLogout={() => void logout()}
      connectionState={connectionState}
    >
      {activeView === 'server' && <ServerSection />}
      {activeView === 'service' && <MonitoringSection />}
      {activeView === 'conversation' && <ConversationSection />}
      {activeView === 'call-service' && <CallServiceSection />}
      {activeView === 'alerts' && <AlertsSection />}
      {activeView === 'logs' && <LogsSection />}
      {activeView === 'call-quality' && (
        <CallQualitySection
          summary={calls.summary}
          filters={calls.filters}
          error={calls.error}
          onFilterChange={calls.updateFilter}
          onApplyFilters={calls.applyFilters}
        />
      )}
      {activeView === 'recent-calls' && (
        <RecentCallsSection
          recentCallLegs={calls.recentCallLegs}
          filters={calls.filters}
          error={calls.error}
          onFilterChange={calls.updateFilter}
          onApplyFilters={calls.applyFilters}
          onInspect={inspectCall}
        />
      )}
      {activeView === 'timeline' && (
        <CallTimelineSection
          callId={calls.callId}
          timeline={calls.timeline}
          error={calls.error}
          onCallIdChange={calls.setCallId}
          onLoadTimeline={(callId) => void calls.loadTimeline(callId)}
        />
      )}
    </DashboardShell>
  )
}
