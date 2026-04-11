import { useMemo, useState } from 'react'
import { validateImageFile } from '@/utils/validators'
import { compressImage } from '../utils/imageCompression'

export function useImageUpload() {
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [compressed, setCompressed] = useState(null)
  const [isCompressing, setIsCompressing] = useState(false)

  const previewUrl = useMemo(
    () => compressed?.previewUrl || (file ? URL.createObjectURL(file) : ''),
    [compressed, file],
  )

  const onSelectFile = async (nextFile) => {
    const validation = validateImageFile(nextFile)
    setError(validation)
    if (validation) return

    setIsCompressing(true)
    setFile(nextFile)

    try {
      const nextCompressed = await compressImage(nextFile)
      setCompressed(nextCompressed)
    } catch (compressError) {
      setError(compressError.message)
    } finally {
      setIsCompressing(false)
    }
  }

  // 外部可呼叫，把 compressed 換成處理後（例如旋轉）的新版本
  const replaceCompressed = (newCompressed) => {
    setCompressed(newCompressed)
  }

  return {
    file,
    error,
    previewUrl,
    compressed,
    isCompressing,
    onSelectFile,
    replaceCompressed,
  }
}
