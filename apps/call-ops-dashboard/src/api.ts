const apiBaseUrl = import.meta.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? ''

export const fetchApi = (path: string, options?: RequestInit) =>
  fetch(`${apiBaseUrl}${path}`, {
    credentials: 'include',
    ...options,
  })
