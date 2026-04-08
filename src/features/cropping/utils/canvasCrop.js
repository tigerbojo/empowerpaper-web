export function cropCanvasToBlob(canvas, type = 'image/webp', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('無法產生裁切影像'))
        return
      }
      resolve(blob)
    }, type, quality)
  })
}
