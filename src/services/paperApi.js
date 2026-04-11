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

  detectQuestions(paperId) {
    // 用 vision LLM 偵測考卷上每一題的位置；回傳 normalized bbox
    // 本地 Gemma 4 26B 處理一張考卷約 60-180 秒，必須拉高 timeout
    return apiClient.post(`/papers/${paperId}/detect-questions`, undefined, {
      timeout: 300000,
    })
  },
}
