const apiBaseUrl = import.meta.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? ''

const fetchWithCredentials = (path: string, options?: RequestInit) =>
  fetch(`${apiBaseUrl}${path}`, {
    credentials: 'include',
    ...options,
  })

let refreshPromise: Promise<boolean> | null = null

const refreshSession = () => {
  if (!refreshPromise) {
    refreshPromise = fetchWithCredentials('/auth/refresh', {
      method: 'POST',
    })
      .then((response) => response.ok)
      .catch(() => false)
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

  const refreshed = await refreshSession()
  if (!refreshed) {
    return response
  }

  return fetchWithCredentials(path, options)
}
