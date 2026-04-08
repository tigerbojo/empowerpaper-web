export function validateImageFile(file) {
  if (!file) return '請先選擇檔案'
  if (!file.type.startsWith('image/')) return '只支援圖片檔案'
  if (file.size > 15 * 1024 * 1024) return '檔案需小於 15MB'
  return ''
}

export function validateExamSettings(values) {
  if (!values.title?.trim()) return '請輸入考卷標題'
  if (!values.paperSize) return '請選擇紙張尺寸'
  return ''
}
