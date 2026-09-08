import type { FormEvent, ReactNode } from 'react'

export type ViewId = 'server' | 'service' | 'conversation' | 'call-quality' | 'recent-calls' | 'timeline'

export const VIEWS: Array<{
  id: ViewId
  group: 'Infrastructure' | 'Calls'
  label: string
  title: string
  kicker: string
}> = [
  { id: 'server', group: 'Infrastructure', label: 'Server', title: 'Server resources', kicker: 'Infrastructure / Host' },
  { id: 'service', group: 'Infrastructure', label: 'Monitoring service', title: 'Monitoring service', kicker: 'Infrastructure / Service' },
  { id: 'conversation', group: 'Infrastructure', label: 'Conversation service', title: 'Conversation service', kicker: 'Infrastructure / Realtime chat' },
  { id: 'call-quality', group: 'Calls', label: 'Call quality', title: 'Call quality', kicker: 'Calls / Quality' },
  { id: 'recent-calls', group: 'Calls', label: 'Recent calls', title: 'Recent calls', kicker: 'Calls / Explorer' },
  { id: 'timeline', group: 'Calls', label: 'Call timeline', title: 'Call timeline', kicker: 'Calls / Timeline' },
]

export const viewFromHash = (): ViewId => {
  const hash = window.location.hash.replace(/^#/, '') as ViewId
  return VIEWS.some((view) => view.id === hash) ? hash : 'server'
}

export function SessionLoader() {
  return (
    <main className="session-loader">
      <div className="brand-mark">V</div>
      <span>Checking admin session…</span>
    </main>
  )
}

type LoginProps = {
  email: string
  password: string
  error: string | null
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
}

export function LoginScreen({
  email,
  password,
  error,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: LoginProps) {
  return (
    <main className="login-shell">
      <section className="login-brand-panel" aria-hidden="true">
        <div className="brand-lockup">
          <div className="brand-mark">V</div>
          <div><strong>Velora</strong><span>Operations Console</span></div>
        </div>
        <div className="login-brand-copy">
          <span className="status-chip"><i /> Internal operations</span>
          <h1>Observe infrastructure and call quality from one focused console.</h1>
          <p>Host resources, service health, call QoE, failures, and per-call timelines for Velora administrators.</p>
        </div>
        <p className="login-footnote">Restricted access · Administrator accounts only</p>
      </section>

      <section className="login-form-panel">
        <form className="login-card" onSubmit={onSubmit}>
          <div className="login-heading">
            <span>Admin sign in</span>
            <h2>Welcome back</h2>
            <p>Use your Velora administrator account to continue.</p>
          </div>
          <label>
            Email address
            <input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="admin@velora.app" autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
          </label>
          <button className="primary-button login-button" type="submit">Sign in to dashboard</button>
          {error && <p className="error login-error">{error}</p>}
        </form>
      </section>
    </main>
  )
}

type DashboardShellProps = {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  onLogout: () => void
  children: ReactNode
}

export function DashboardShell({ activeView, onNavigate, onLogout, children }: DashboardShellProps) {
  const currentView = VIEWS.find((view) => view.id === activeView) ?? VIEWS[0]

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand-lockup sidebar-brand">
          <div className="brand-mark">V</div>
          <div><strong>Velora</strong><span>Operations</span></div>
        </div>

        <nav className="sidebar-nav" aria-label="Dashboard navigation">
          {(['Infrastructure', 'Calls'] as const).map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-label">{group}</span>
              {VIEWS.filter((view) => view.group === group).map((view) => (
                <button
                  className={activeView === view.id ? 'nav-tab-button active' : 'nav-tab-button'}
                  type="button"
                  key={view.id}
                  onClick={() => onNavigate(view.id)}
                >
                  <i aria-hidden="true" />
                  <span>{view.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-status">
          <div className="sidebar-status-line"><span><i /> Production</span><strong>Live</strong></div>
          <p>Prometheus metrics refresh automatically. Admin authentication refreshes in the background.</p>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="topbar-kicker">{currentView.kicker}</span>
            <h1>{currentView.title}</h1>
          </div>
          <div className="topbar-actions">
            <span className="live-indicator"><i /> Live data</span>
            <div className="admin-user"><span>AD</span><div><strong>Administrator</strong><small>Admin session</small></div></div>
            <button className="ghost-button" type="button" onClick={onLogout}>Sign out</button>
          </div>
        </header>

        <main className="dashboard-content tabbed-dashboard-content">{children}</main>
      </div>
    </div>
  )
}
