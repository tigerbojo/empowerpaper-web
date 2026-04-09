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
