import apiClient from './apiClient'

export const examApi = {
  suggestTags(payload) {
    return apiClient.post('/tags/suggest', payload)
  },
  generateExam(payload) {
    return apiClient.post('/exam-builder/generate', payload)
  },
  exportPdf(payload, config) {
    return apiClient.post('/exam-builder/export', payload, {
      responseType: 'blob',
      ...config,
    })
  },
}
