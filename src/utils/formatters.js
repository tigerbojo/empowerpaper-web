export function formatDateTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatPercent(value = 0) {
  return `${Math.round(value)}%`
}

export function truncate(text, max = 36) {
  if (!text) return ''
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
