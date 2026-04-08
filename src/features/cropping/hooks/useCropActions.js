import { useMutation } from '@tanstack/react-query'
import { paperApi } from '@/services/paperApi'
import { examApi } from '@/services/examApi'

function normalizeTags(data) {
  const tags = data?.tags || data?.labels || data?.hashtags || []
  return Array.isArray(tags) ? tags.filter(Boolean).slice(0, 5) : []
}

function normalizeCropResponse(data = {}) {
  return {
    cropId: data.cropId || data.crop_id || data.id || null,
    imageUrl: data.imageUrl || data.image_url || data.cleanImageUrl || null,
    tags: normalizeTags(data),
    raw: data,
  }
}

function buildMockTags({ width, height, y }) {
  if (height > width * 0.7) return ['國中數學', '幾何', '圖形']
  if (y < 500) return ['國中數學', '等差數列', '基礎']
  if (y < 1100) return ['國中數學', '數列', '進階']
  return ['國中數學', '應用題', '精熟']
}

export function useCropActions() {
  const submitCropMutation = useMutation({
    mutationFn: async ({ blob, filename, paperId, x, y, width, height }) => {
      const formData = new FormData()
      formData.append('file', blob, filename)
      if (paperId) {
        formData.append('paperId', paperId)
        formData.append('paper_id', paperId)
      }
      formData.append('x', String(x))
      formData.append('y', String(y))
      formData.append('width', String(width))
      formData.append('height', String(height))

      const { data } = await paperApi.submitCrop(formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return normalizeCropResponse(data)
    },
  })

  const suggestTagsMutation = useMutation({
    mutationFn: async ({ cropId, paperId, imageUrl, width, height }) => {
      const { data } = await examApi.suggestTags({
        cropId,
        crop_id: cropId,
        paperId,
        paper_id: paperId,
        imageUrl,
        image_url: imageUrl,
        width,
        height,
      })
      return normalizeTags(data)
    },
  })

  const saveCropWithSuggestions = async ({ blob, filename, paperId, imageUrl, width, height, x, y }) => {
    try {
      const submitted = await submitCropMutation.mutateAsync({
        blob,
        filename,
        paperId,
        x,
        y,
        width,
        height,
      })

      if (submitted.tags.length > 0) {
        return { ...submitted, tags: submitted.tags, source: 'upload' }
      }

      const tags = await suggestTagsMutation.mutateAsync({
        cropId: submitted.cropId,
        paperId,
        imageUrl: submitted.imageUrl || imageUrl,
        width,
        height,
      })

      return {
        ...submitted,
        imageUrl: submitted.imageUrl || imageUrl,
        tags: tags.length > 0 ? tags : buildMockTags({ width, height, y }),
        source: tags.length > 0 ? 'suggest' : 'mock',
      }
    } catch {
      return {
        cropId: null,
        imageUrl,
        tags: buildMockTags({ width, height, y }),
        source: 'mock',
      }
    }
  }

  return {
    submitCropMutation,
    suggestTagsMutation,
    saveCropWithSuggestions,
  }
}
