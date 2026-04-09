export function buildExamLayout(items = []) {
  return items.map((item, index) => ({
    id: item.id ?? `item-${index + 1}`,
    order: index + 1,
    title: item.title || `題目 ${index + 1}`,
    imageUrl: item.imageUrl,
    imageDataUrl: item.imageDataUrl || item.pdfImageSrc || null,
    tags: item.tags || [],
    ...item,
  }))
}

export function buildMockPdfPayload({ title, paperSize, columns, items }) {
  return {
    title,
    paperSize,
    columns,
    exportedAt: new Date().toISOString(),
    items: buildExamLayout(items).map((item) => ({
      id: item.id,
      order: item.order,
      title: item.title,
      tags: item.tags,
      width: item.width,
      height: item.height,
    })),
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('無法將圖片轉成 PDF 可用的資料網址'))
    reader.readAsDataURL(blob)
  })
}

export async function toPdfImageSource(itemOrUrl) {
  if (!itemOrUrl) return null

  const imageDataUrl = typeof itemOrUrl === 'object' ? itemOrUrl.imageDataUrl : null
  const imageUrl = typeof itemOrUrl === 'object' ? itemOrUrl.imageUrl : itemOrUrl

  if (imageDataUrl?.startsWith('data:')) {
    return imageDataUrl
  }

  if (!imageUrl) return null

  if (imageUrl.startsWith('data:')) {
    return imageUrl
  }

  const response = await fetch(imageUrl)
  const blob = await response.blob()
  return blobToDataUrl(blob)
}

export async function preparePdfItems(items = []) {
  const layoutItems = buildExamLayout(items)
  return Promise.all(
    layoutItems.map(async (item) => ({
      ...item,
      pdfImageSrc: await toPdfImageSource(item),
    })),
  )
}
