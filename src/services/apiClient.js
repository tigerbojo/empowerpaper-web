import axios from 'axios'
import env from '@/config/env'

const apiClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: env.apiTimeoutMs,
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.detail || error.response?.data?.message || error.message
    return Promise.reject(new Error(message))
  },
)

export default apiClient
