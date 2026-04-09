import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

Font.register({
  family: 'NotoSansTC',
  src: '/fonts/NotoSansTC-VF.ttf',
})

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingHorizontal: 28,
    paddingBottom: 36,
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: 11,
    fontFamily: 'NotoSansTC',
  },
  header: {
    marginBottom: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
  },
  paperSize: {
    fontSize: 9,
    color: '#64748b',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 6,
    fontSize: 22,
    fontWeight: 700,
  },
  meta: {
    marginTop: 4,
    fontSize: 10,
    color: '#64748b',
  },
  item: {
    marginBottom: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#dbe4f0',
    borderRadius: 14,
    backgroundColor: '#ffffff',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: 700,
  },
  itemMeta: {
    fontSize: 9,
    color: '#94a3b8',
    marginTop: 3,
  },
  tags: {
    marginTop: 4,
    fontSize: 10,
    color: '#64748b',
  },
  imageFrame: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 8,
    backgroundColor: '#f8fafc',
  },
  image: {
    width: '100%',
    objectFit: 'contain',
    borderRadius: 8,
  },
  fallbackImage: {
    width: '100%',
    height: 120,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackImageText: {
    fontSize: 9,
    color: '#64748b',
  },
})

function getImageHeight(item) {
  const width = Number(item?.width) || 0
  const height = Number(item?.height) || 0
  if (!width || !height) return 220

  const contentWidth = 515
  const ratio = height / width
  const computed = Math.round(contentWidth * ratio)
  return Math.max(120, Math.min(360, computed))
}

function chunkItems(items = []) {
  const pages = []
  let current = []
  let usedHeight = 0

  items.forEach((item) => {
    const estimated = getImageHeight(item) + 88
    if (current.length > 0 && usedHeight + estimated > 690) {
      pages.push(current)
      current = [item]
      usedHeight = estimated
      return
    }

    current.push(item)
    usedHeight += estimated
  })

  if (current.length > 0) pages.push(current)
  return pages
}

export default function ExamPdfDocument({ title, paperSize, items }) {
  const pages = chunkItems(items)

  return (
    <Document>
      {pages.map((pageItems, pageIndex) => (
        <Page key={`page-${pageIndex + 1}`} size="A4" style={styles.page}>
          <View style={styles.header}>
            <Text style={styles.paperSize}>{paperSize}</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.meta}>共 {items.length} 題｜第 {pageIndex + 1} 頁</Text>
          </View>

          {pageItems.map((item, index) => (
            <View key={item.id || `pdf-item-${pageIndex + 1}-${index + 1}`} style={styles.item} wrap={false}>
              <View style={styles.itemHeader}>
                <View>
                  <Text style={styles.itemTitle}>{item.title || `題目 ${index + 1}`}</Text>
                  <Text style={styles.itemMeta}>尺寸：{item.width || '?'} × {item.height || '?'}</Text>
                </View>
              </View>

              <Text style={styles.tags}>
                標籤：{item.tags?.length ? item.tags.join('｜') : '尚未取得 AI 標籤'}
              </Text>

              <View style={styles.imageFrame}>
                {item.pdfImageSrc ? (
                  <Image src={item.pdfImageSrc} style={[styles.image, { height: getImageHeight(item) }]} />
                ) : (
                  <View style={styles.fallbackImage}>
                    <Text style={styles.fallbackImageText}>No Image</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </Page>
      ))}
    </Document>
  )
}
