import { useMemo, useState } from 'react'
import { validateImageFile } from '@/utils/validators'
import { compressImage } from '../utils/imageCompression'
import { isPdfFile, pdfToImages } from '../utils/pdfToImages'

export function useImageUpload() {
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [compressed, setCompressed] = useState(null)
  const [isCompressing, setIsCompressing] = useState(false)
  // PDF 多頁：轉檔後的頁面清單（單頁 PDF 會直接自動選取，不會出現在這裡）
  const [pdfPages, setPdfPages] = useState([])
  const [activePdfPage, setActivePdfPage] = useState(null)

  const previewUrl = useMemo(
    () => compressed?.previewUrl || (file && !isPdfFile(file) ? URL.createObjectURL(file) : ''),
    [compressed, file],
  )

  // 把一個 PDF 頁面設成目前要處理的圖
  const selectPdfPage = (page) => {
    setActivePdfPage(page.pageNumber)
    setCompressed({
      blob: page.blob,
      previewUrl: page.previewUrl,
      width: page.width,
      height: page.height,
      mimeType: page.mimeType,
    })
  }

  const onSelectFile = async (nextFile) => {
    const validation = validateImageFile(nextFile)
    setError(validation)
    if (validation) return

    setIsCompressing(true)
    setFile(nextFile)
    setCompressed(null)
    setPdfPages([])
    setActivePdfPage(null)

    try {
      if (isPdfFile(nextFile)) {
        const { pages, truncated } = await pdfToImages(nextFile)
        if (pages.length === 0) throw new Error('PDF 沒有可轉換的頁面')
        if (truncated) setError('PDF 頁數過多，僅載入前 30 頁')
        if (pages.length === 1) {
          selectPdfPage(pages[0])
        } else {
          setPdfPages(pages)
        }
      } else {
        const nextCompressed = await compressImage(nextFile)
        setCompressed(nextCompressed)
      }
    } catch (compressError) {
      setError(compressError.message)
    } finally {
      setIsCompressing(false)
    }
  }

  // 外部可呼叫，把 compressed 換成處理後（例如旋轉）的新版本
  const replaceCompressed = (newCompressed) => {
    setCompressed(newCompressed)
    // 清空選檔（重新開始）時，PDF 頁面也一起清掉
    if (newCompressed === null) {
      setPdfPages([])
      setActivePdfPage(null)
      setFile(null)
    }
  }

  return {
    file,
    error,
    previewUrl,
    compressed,
    isCompressing,
    onSelectFile,
    replaceCompressed,
    pdfPages,
    activePdfPage,
    selectPdfPage,
  }
}
