export function cropCanvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('無法將裁切畫布轉成圖片 Blob'))
        return
      }
      resolve(blob)
    }, type, quality)
  })
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('無法將圖片 Blob 轉成 Data URL'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 從一張圖片的 normalized bbox（0~1）切出區域 → Blob + dataURL
 * 用於 AI 自動切題：vision LLM 回傳 normalized 座標，前端拿來實際切圖
 */
export function cropImageByNormalizedBbox(imageUrl, bbox) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const W = img.naturalWidth
      const H = img.naturalHeight
      const x = Math.round(bbox.x * W)
      const y = Math.round(bbox.y * H)
      const w = Math.round(bbox.w * W)
      const h = Math.round(bbox.h * H)
      if (w <= 0 || h <= 0) {
        reject(new Error('bbox 尺寸無效'))
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('cropImageByNormalizedBbox toBlob 失敗'))
          return
        }
        const dataUrl = await blobToDataUrl(blob)
        resolve({
          blob,
          dataUrl,
          width: w,
          height: h,
          x,
          y,
        })
      }, 'image/png')
    }
    img.onerror = () => reject(new Error('cropImageByNormalizedBbox 載入圖片失敗'))
    img.src = imageUrl
  })
}
