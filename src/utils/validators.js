export function validateImageFile(file) {
  if (!file) return '請先選擇檔案'
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
  if (!file.type.startsWith('image/') && !isPdf) return '只支援圖片或 PDF 檔案'
  const limit = isPdf ? 40 : 15
  if (file.size > limit * 1024 * 1024) return `檔案需小於 ${limit}MB`
  return ''
}

export function validateExamSettings(values) {
  if (!values.title?.trim()) return '請輸入考卷標題'
  if (!values.paperSize) return '請選擇紙張尺寸'
  return ''
}
