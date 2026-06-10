/**
 * PDF 考卷 → 圖片（前端轉檔，後端維持只吃圖片）
 *
 * 用 pdfjs-dist 把每一頁 render 成 canvas → webp blob，
 * 尺寸對齊 imageCompression 的 2048px 上限，轉完直接走既有清理管線。
 * pdfjs（~1MB）用 dynamic import，只有真的選了 PDF 才載入。
 */

const MAX_DIMENSION = 2048
const MAX_PAGES = 30

let pdfjsPromise = null

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()
      return pdfjs
    })
  }
  return pdfjsPromise
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PDF 頁面轉圖失敗'))
        return
      }
      resolve(blob)
    }, 'image/webp', 0.9)
  })
}

export function isPdfFile(file) {
  if (!file) return false
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
}

/**
 * @param {File} file PDF 檔
 * @returns {Promise<Array<{pageNumber:number, blob:Blob, previewUrl:string, width:number, height:number, mimeType:string}>>}
 */
export async function pdfToImages(file) {
  const pdfjs = await loadPdfjs()
  const data = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data })
  const doc = await loadingTask.promise

  const totalPages = doc.numPages
  const pageCount = Math.min(totalPages, MAX_PAGES)
  const pages = []

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    // PDF 的 viewport 是 72dpi 點數，A4 約 595x842 — 放大到 2048px 等級
    // 才有足夠解析度給手寫擦除管線
    const scale = MAX_DIMENSION / Math.max(base.width, base.height)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvasContext: ctx, viewport }).promise

    const blob = await canvasToBlob(canvas)
    pages.push({
      pageNumber,
      blob,
      previewUrl: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
      mimeType: 'image/webp',
    })
    page.cleanup()
  }

  await loadingTask.destroy()
  return { pages, totalPages, truncated: totalPages > MAX_PAGES }
}
