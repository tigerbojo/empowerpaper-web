import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

Font.register({
  family: 'NotoSansTC',
  src: '/fonts/NotoSansTC-VF.ttf',
})

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 30,
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: 10,
    fontFamily: 'NotoSansTC',
  },
  header: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: '#1e293b',
  },
  paperSize: {
    fontSize: 8,
    color: '#64748b',
    letterSpacing: 1,
  },
  title: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: 700,
  },
  meta: {
    marginTop: 3,
    fontSize: 9,
    color: '#64748b',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  item: {
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  itemTitle: {
    fontSize: 11,
    fontWeight: 700,
  },
  itemMeta: {
    fontSize: 8,
    color: '#94a3b8',
  },
  tags: {
    fontSize: 8,
    color: '#94a3b8',
    marginBottom: 4,
  },
  imageFrame: {
    width: '100%',
  },
  image: {
    width: '100%',
    objectFit: 'contain',
  },
  fallbackImage: {
    width: '100%',
    height: 80,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackImageText: {
    fontSize: 8,
    color: '#94a3b8',
  },
  footer: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 8,
    color: '#94a3b8',
  },
})

function getImageHeight(item) {
  const width = Number(item?.width) || 0
  const height = Number(item?.height) || 0
  if (!width || !height) return 160

  const contentWidth = 545
  const ratio = height / width
  const computed = Math.round(contentWidth * ratio)
  return Math.max(80, Math.min(280, computed))
}

function chunkItems(items = []) {
  const pages = []
  let current = []
  let usedHeight = 0
  const pageHeight = 750

  items.forEach((item) => {
    const estimated = getImageHeight(item) + 40
    if (current.length > 0 && usedHeight + estimated > pageHeight) {
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
  let globalIndex = 0

  return (
    <Document>
      {pages.map((pageItems, pageIndex) => {
        return (
          <Page key={`page-${pageIndex + 1}`} size="A4" style={styles.page}>
            {pageIndex === 0 && (
              <View style={styles.header}>
                <Text style={styles.title}>{title}</Text>
                <View style={styles.meta}>
                  <Text>共 {items.length} 題</Text>
                  <Text>姓名：＿＿＿＿＿  座號：＿＿  得分：＿＿</Text>
                </View>
              </View>
            )}

            {pageItems.map((item) => {
              globalIndex += 1
              return (
                <View key={item.id || `pdf-item-${globalIndex}`} style={styles.item} wrap={false}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemTitle}>{globalIndex}.</Text>
                  </View>

                  <View style={styles.imageFrame}>
                    {item.pdfImageSrc ? (
                      <Image src={item.pdfImageSrc} style={[styles.image, { height: getImageHeight(item) }]} />
                    ) : (
                      <View style={styles.fallbackImage}>
                        <Text style={styles.fallbackImageText}>圖片載入失敗</Text>
                      </View>
                    )}
                  </View>
                </View>
              )
            })}

            <Text style={styles.footer}>第 {pageIndex + 1} / {pages.length} 頁</Text>
          </Page>
        )
      })}
    </Document>
  )
}
