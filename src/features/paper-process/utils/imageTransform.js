/**
 * 前端即時影像轉換：黑度（darkness）LUT + 旋轉
 *
 * 黑度公式對齊後端 image_cleanup._smart_enhance：
 *   scale = 1.0 + (darkness - 1.0) * 2.4
 *   newDarkAmount = (255 - v) * scale
 * 後端永遠只產 darkness=1.0 的基準圖，滑桿調整在前端用相對倍率
 * 即時套用（0 網路延遲），不再為每個滑桿值打一次後端。
 */

export function darknessFactor(darkness) {
  return 1.0 + (darkness - 1.0) * 2.4
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('讀取圖片失敗'))
    img.src = url
  })
}

/**
 * 從 base 圖產出顯示用圖：先旋轉、再套相對黑度。
 *
 * @param {string} baseUrl 基準圖 URL
 * @param {number} darkness 目標黑度（0.5 ~ 2.0）
 * @param {number} bakedDarkness base 圖已含的黑度（後端直出 = 1.0；
 *   橡皮擦編輯後的圖以編輯當下的黑度為基準）
 * @param {number} rotation 0 / 90 / 180 / 270
 * @returns {Promise<string>} object URL
 */
export async function transformCleanedImage(baseUrl, darkness = 1.0, bakedDarkness = 1.0, rotation = 0) {
  const img = await loadImage(baseUrl)

  const swap = rotation % 180 !== 0
  const canvas = document.createElement('canvas')
  canvas.width = swap ? img.height : img.width
  canvas.height = swap ? img.width : img.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.drawImage(img, -img.width / 2, -img.height / 2)
  ctx.restore()

  const ratio = darknessFactor(darkness) / darknessFactor(bakedDarkness)
  if (Math.abs(ratio - 1) > 0.001) {
    const lut = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v += 1) {
      lut[v] = 255 - (255 - v) * ratio
    }
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const px = imageData.data
    for (let i = 0; i < px.length; i += 4) {
      px[i] = lut[px[i]]
      px[i + 1] = lut[px[i + 1]]
      px[i + 2] = lut[px[i + 2]]
    }
    ctx.putImageData(imageData, 0, 0)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('canvas.toBlob 失敗'))
        return
      }
      resolve(URL.createObjectURL(blob))
    }, 'image/png')
  })
}
