function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('無法讀取圖片'))
    }
    image.src = url
  })
}

function canvasToBlob(canvas, type = 'image/webp', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('圖片壓縮失敗'))
        return
      }
      resolve(blob)
    }, type, quality)
  })
}

export async function compressImage(file, options = {}) {
  const {
    maxDimension = 2048,
    type = 'image/webp',
    quality = 0.9,
  } = options

  const image = await loadImage(file)
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, width, height)

  const blob = await canvasToBlob(canvas, type, quality)
  const previewUrl = URL.createObjectURL(blob)

  return {
    blob,
    previewUrl,
    width,
    height,
    mimeType: type,
  }
}
