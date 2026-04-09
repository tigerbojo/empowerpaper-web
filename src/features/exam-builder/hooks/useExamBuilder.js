import { createElement } from 'react'
import { pdf } from '@react-pdf/renderer'
import { useMutation } from '@tanstack/react-query'
import { examApi } from '../api'
import ExamPdfDocument from '../components/ExamPdfDocument'
import { buildMockPdfPayload, preparePdfItems } from '../utils/pdfLayout'

function normalizeGenerateResponse(data = {}) {
  return {
    previewUrl: data.previewUrl || data.preview_url || data.url || null,
    pdfUrl: data.pdfUrl || data.pdf_url || null,
    raw: data,
  }
}

async function buildFallbackPdf(payload) {
  const items = await preparePdfItems(payload.items)
  const document = createElement(ExamPdfDocument, {
    title: payload.title || '考卷新生複習卷',
    paperSize: payload.paperSize || 'A4 直式',
    items,
  })
  const blob = await pdf(document).toBlob()

  return {
    blob,
    filename: `${payload.title || '考卷新生複習卷'}-fallback.pdf`,
    source: 'fallback-pdf',
    debug: buildMockPdfPayload(payload),
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
        return buildFallbackPdf(payload)
      }
    },
  })

  return {
    generateMutation,
    exportMutation,
  }
}
