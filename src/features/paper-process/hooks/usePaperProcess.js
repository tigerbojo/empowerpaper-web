import { useMutation } from '@tanstack/react-query'
import { paperApi } from '../api'

function normalizeUploadResponse(data = {}) {
  return {
    paperId: data.paperId || data.paper_id || data.id || null,
    jobId: data.jobId || data.job_id || null,
    originalImageUrl:
      data.originalImageUrl ||
      data.original_image_url ||
      data.imageUrl ||
      data.image_url ||
      null,
    cleanedImageUrl:
      data.cleanedImageUrl ||
      data.cleaned_image_url ||
      data.cleanImageUrl ||
      data.clean_image_url ||
      null,
    ocrImageUrl:
      data.ocrImageUrl ||
      data.ocr_image_url ||
      data.ocrPreviewUrl ||
      data.ocr_preview_url ||
      null,
    processor: data.processor || null,
    requestedMode: data.requestedMode || data.requested_mode || null,
    status: data.status || 'uploaded',
    components: data.components || null,
    imageWidth: data.imageWidth || data.image_width || null,
    imageHeight: data.imageHeight || data.image_height || null,
    raw: data,
  }
}

function normalizeJobResponse(data = {}) {
  const result = data.result || {}
  return {
    status: data.status || result.status || 'processing',
    cleanedImageUrl:
      data.cleanedImageUrl ||
      data.cleaned_image_url ||
      data.cleanImageUrl ||
      data.clean_image_url ||
      result.cleanedImageUrl ||
      result.cleaned_image_url ||
      result.cleanImageUrl ||
      result.clean_image_url ||
      null,
    ocrImageUrl:
      data.ocrImageUrl ||
      data.ocr_image_url ||
      result.ocrImageUrl ||
      result.ocr_image_url ||
      null,
    paperId: data.paperId || data.paper_id || result.paperId || result.paper_id || null,
    jobId: data.jobId || data.job_id || result.jobId || result.job_id || null,
    processor: data.processor || result.processor || null,
    requestedMode: data.requestedMode || data.requested_mode || result.requestedMode || result.requested_mode || null,
    raw: data,
  }
}

export function usePaperProcess() {
  const uploadMutation = useMutation({
    mutationFn: async ({ blob, filename, onUploadProgress }) => {
      const formData = new FormData()
      formData.append('file', blob, filename)
      const { data } = await paperApi.uploadPaper(formData, { onUploadProgress })
      return normalizeUploadResponse(data)
    },
  })

  const cleanMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await paperApi.requestCleaning(payload)
      return normalizeUploadResponse(data)
    },
  })

  // 複雜考卷在 Cloud Run cold start 下可能超過 30 秒，放寬到 2 分鐘
  const pollCleanJob = async (jobId, { intervalMs = 1500, maxAttempts = 80 } = {}) => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { data } = await paperApi.fetchCleanResult(jobId)
      const normalized = normalizeJobResponse(data)
      if (normalized.status === 'completed' || normalized.cleanedImageUrl) {
        return normalized
      }
      if (normalized.status === 'failed' || normalized.status === 'error') {
        throw new Error(data?.error || '後端清理任務失敗')
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    throw new Error('等待清理結果逾時，請稍後再試')
  }

  return {
    uploadMutation,
    cleanMutation,
    pollCleanJob,
  }
}
