import { useMutation } from '@tanstack/react-query'
import { examApi } from '../api'
import { buildMockPdfPayload } from '../utils/pdfLayout'

function normalizeGenerateResponse(data = {}) {
  return {
    previewUrl: data.previewUrl || data.preview_url || data.url || null,
    pdfUrl: data.pdfUrl || data.pdf_url || null,
    raw: data,
  }
}

export function useExamBuilder() {
  const generateMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await examApi.generateExam(payload)
      return normalizeGenerateResponse(data)
    },
  })

  const exportMutation = useMutation({
    mutationFn: async (payload) => {
      try {
        const response = await examApi.exportPdf(payload)
        return {
          blob: response.data,
          filename: `${payload.title || 'paper-rebirth'}.pdf`,
          source: 'api',
        }
      } catch {
        const mockPayload = buildMockPdfPayload(payload)
        const blob = new Blob([JSON.stringify(mockPayload, null, 2)], { type: 'application/json' })
        return {
          blob,
          filename: `${payload.title || 'paper-rebirth'}-mock.json`,
          source: 'mock',
        }
      }
    },
  })

  return {
    generateMutation,
    exportMutation,
  }
}
