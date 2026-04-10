import { createElement } from 'react'
import { pdf } from '@react-pdf/renderer'
import { useMutation } from '@tanstack/react-query'
import ExamPdfDocument from '../components/ExamPdfDocument'
import { preparePdfItems } from '../utils/pdfLayout'

async function buildPdf(payload) {
  const items = await preparePdfItems(payload.items)
  const document = createElement(ExamPdfDocument, {
    title: payload.title || '增強智卷複習卷',
    paperSize: payload.paperSize || 'A4 直式',
    items,
  })
  const blob = await pdf(document).toBlob()

  return {
    blob,
    filename: `${payload.title || '增強智卷複習卷'}.pdf`,
    source: 'client',
  }
}

export function useExamBuilder() {
  // 預覽 = 同樣建構 PDF blob，但不下載，只回 url
  const generateMutation = useMutation({
    mutationFn: async (payload) => {
      const result = await buildPdf(payload)
      const previewUrl = URL.createObjectURL(result.blob)
      return { previewUrl, blob: result.blob }
    },
  })

  const exportMutation = useMutation({
    mutationFn: async (payload) => buildPdf(payload),
  })

  return {
    generateMutation,
    exportMutation,
  }
}
