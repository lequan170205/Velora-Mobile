import axios from 'axios'

export const apiClient = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL || '',
  withCredentials: true,
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      originalRequest.url !== '/auth/refresh' &&
      originalRequest.url !== '/auth/logout'
    ) {
      originalRequest._retry = true

      try {
        await apiClient.post('/auth/refresh')
        return apiClient(originalRequest)
      } catch (refreshError) {
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)
