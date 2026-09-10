const apiBaseUrl = import.meta.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? ''

const fetchWithCredentials = (path: string, options?: RequestInit) =>
  fetch(`${apiBaseUrl}${path}`, {
    credentials: 'include',
    ...options,
  })

type RefreshSessionResult = 'refreshed' | 'expired' | 'unavailable'
type SessionExpiredListener = () => void

const sessionExpiredListeners = new Set<SessionExpiredListener>()
let refreshPromise: Promise<RefreshSessionResult> | null = null

const notifySessionExpired = () => {
  for (const listener of sessionExpiredListeners) {
    try {
      listener()
    } catch {
      // One listener must not prevent other session-expiry consumers from running.
    }
  }
}

export const subscribeToSessionExpired = (listener: SessionExpiredListener) => {
  sessionExpiredListeners.add(listener)
  return () => {
    sessionExpiredListeners.delete(listener)
  }
}

const refreshSession = () => {
  if (!refreshPromise) {
    refreshPromise = fetchWithCredentials('/auth/refresh', {
      method: 'POST',
    })
      .then((response): RefreshSessionResult => {
        if (response.ok) return 'refreshed'

        if (response.status === 401) {
          notifySessionExpired()
          return 'expired'
        }

        return 'unavailable'
      })
      .catch((): RefreshSessionResult => 'unavailable')
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

const shouldSkipRefresh = (path: string) =>
  path === '/auth/login' || path === '/auth/refresh' || path === '/auth/logout'

export const fetchApi = async (path: string, options?: RequestInit) => {
  const response = await fetchWithCredentials(path, options)

  if (response.status !== 401 || shouldSkipRefresh(path)) {
    return response
  }

  const refreshResult = await refreshSession()
  if (refreshResult !== 'refreshed') {
    return response
  }

  return fetchWithCredentials(path, options)
}
