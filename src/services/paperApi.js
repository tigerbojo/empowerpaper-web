import apiClient from './apiClient'

export const paperApi = {
  uploadPaper(formData, config) {
    return apiClient.post('/papers/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      ...config,
    })
  },

  requestCleaning(payload) {
    return apiClient.post('/papers/clean', payload)
  },

  fetchCleanResult(jobId) {
    return apiClient.get(`/papers/jobs/${jobId}`)
  },

  submitCrop(payload, config) {
    return apiClient.post('/crops', payload, config)
  },
}
