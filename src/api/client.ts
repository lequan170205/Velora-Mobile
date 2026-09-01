import axios from 'axios'

export const apiClient = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL || '',
  timeout: 10_000,
  withCredentials: true,
})

let refreshPromise: Promise<void> | null = null
let isLogoutInProgress = false

export const beginLogout = async () => {
  isLogoutInProgress = true

  try {
    await refreshPromise
  } catch {
    // A failed refresh cannot restore the session and must not block logout.
  }
}

export const endLogout = () => {
  isLogoutInProgress = false
}

const refreshAccessToken = () => {
  if (!refreshPromise) {
    refreshPromise = apiClient
      .post('/auth/refresh')
      .then(() => undefined)
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isLogoutInProgress &&
      originalRequest.url !== '/auth/refresh' &&
      originalRequest.url !== '/auth/logout'
    ) {
      originalRequest._retry = true

      try {
        await refreshAccessToken()
        return apiClient(originalRequest)
      } catch (refreshError) {
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)
