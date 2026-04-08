export function buildExamLayout(items = []) {
  return items.map((item, index) => ({
    id: item.id ?? `item-${index + 1}`,
    order: index + 1,
    title: item.title || `題目 ${index + 1}`,
    imageUrl: item.imageUrl,
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
