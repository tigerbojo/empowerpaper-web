import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/Button'
import GlassCard from '@/components/ui/GlassCard'
import NoticeBanner from '@/components/ui/NoticeBanner'
import Spinner from '@/components/ui/Spinner'
import ScanFrame from '@/features/paper-process/components/ScanFrame'
import EraserModal from '@/features/paper-process/components/EraserModal'
import CornerAdjustModal from '@/features/paper-process/components/CornerAdjustModal'
import ComponentReviewModal from '@/features/paper-process/components/ComponentReviewModal'
import { transformCleanedImage } from '@/features/paper-process/utils/imageTransform'
import { useImageUpload } from '@/features/paper-process/hooks/useImageUpload'
import { usePaperProcess } from '@/features/paper-process/hooks/usePaperProcess'
import usePaperStore from '@/store/usePaperStore'
import useUiStore from '@/store/useUiStore'
import { formatPercent } from '@/utils/formatters'

function buildFilename(file, pageNumber = null) {
  if (!file?.name) return 'paper.webp'
  const base = file.name.replace(/\.[^.]+$/, '')
  return pageNumber ? `${base}-p${pageNumber}.webp` : `${base}.webp`
}

// 四步驟：1=選檔 2=旋轉 3=校正 4=完成
const STEPS = [
  { id: 1, label: '載入考卷' },
  { id: 2, label: '旋轉方向' },
  { id: 3, label: '梯形校正' },
  { id: 4, label: '辨識處理' },
]

export default function Upload() {
  const navigate = useNavigate()
  const {
    file, error, previewUrl, compressed, isCompressing,
    onSelectFile, replaceCompressed, pdfPages, activePdfPage, selectPdfPage,
  } = useImageUpload()
  const [isProcessing, setIsProcessing] = useState(false)
  const [step, setStep] = useState(1)
  const uploadProgress = usePaperStore((state) => state.uploadProgress)
  const uploadStage = usePaperStore((state) => state.uploadStage)
  const cleanupMode = usePaperStore((state) => state.cleanupMode)
  const darkness = usePaperStore((state) => state.darkness)
  const setDarkness = usePaperStore((state) => state.setDarkness)
  const cleanupProcessor = usePaperStore((state) => state.cleanupProcessor)
  const setUploadProgress = usePaperStore((state) => state.setUploadProgress)
  const setUploadStage = usePaperStore((state) => state.setUploadStage)
  const setProcessingStatus = usePaperStore((state) => state.setProcessingStatus)
  const setOriginalImage = usePaperStore((state) => state.setOriginalImage)
  const setCleanedImage = usePaperStore((state) => state.setCleanedImage)
  const setCleanedOcrImage = usePaperStore((state) => state.setCleanedOcrImage)
  const setSelectedEditImage = usePaperStore((state) => state.setSelectedEditImage)
  const setCleanupMode = usePaperStore((state) => state.setCleanupMode)
  const setCleanupProcessor = usePaperStore((state) => state.setCleanupProcessor)
  const setCurrentPaperId = usePaperStore((state) => state.setCurrentPaperId)
  const setCurrentJobId = usePaperStore((state) => state.setCurrentJobId)
  const currentPaperId = usePaperStore((state) => state.currentPaperId)
  const currentJobId = usePaperStore((state) => state.currentJobId)
  const processingStatus = usePaperStore((state) => state.processingStatus)
  const cleanedImage = usePaperStore((state) => state.cleanedImage)
  const cleanedOcrImage = usePaperStore((state) => state.cleanedOcrImage)
  const selectedEditImageKind = usePaperStore((state) => state.selectedEditImageKind)
  const pushToast = useUiStore((state) => state.pushToast)
  const { uploadMutation, cleanMutation, pollCleanJob } = usePaperProcess()

  useEffect(() => {
    if (!previewUrl) return
    setOriginalImage(previewUrl)
    setSelectedEditImage(previewUrl, 'original')
    // 第一次選檔後自動進入旋轉步驟
    if (step === 1) setStep(2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl])

  const meta = useMemo(() => {
    if (!compressed) return []
    return [
      `尺寸 ${compressed.width} × ${compressed.height}`,
      `格式 ${compressed.mimeType.replace('image/', '').toUpperCase()}`,
      `${Math.round((compressed.blob.size / 1024) * 10) / 10} KB`,
    ]
  }, [compressed])

  // 處理失敗訊息（誠實顯示錯誤 + 重試，不再用假進度條 fallback）
  const [processError, setProcessError] = useState(null)
  // 累積旋轉角度（純前端）
  const [rotation, setRotation] = useState(0)
  // 顯示管線的「基礎」圖片（橡皮擦編輯後會換成編輯結果）
  const baseCleanedImageRef = useRef(null)
  // 後端直出的 cleaned 圖（未旋轉、darkness=1.0，智慧擦除座標的基準）
  const serverBaseRef = useRef(null)
  // base 圖已含的黑度（後端直出 = 1.0；橡皮擦編輯後 = 編輯當下的黑度）
  const bakedDarknessRef = useRef(1.0)
  // 是否做過手動橡皮擦修改（智慧擦除套用會重置它們，UI 要警告）
  const manualEditsRef = useRef(false)
  // 互動式擦除元件清單
  const [components, setComponents] = useState(null)
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewApplying, setReviewApplying] = useState(false)
  // 大預覽區目前顯示的版本：original | cleaned（處理完成自動切到 cleaned）
  const [previewTab, setPreviewTab] = useState('original')

  // 採用一份後端 clean 結果：更新所有 refs/state，並套用目前滑桿黑度顯示
  const adoptCleanResult = async (result) => {
    serverBaseRef.current = result.cleanedImageUrl
    baseCleanedImageRef.current = result.cleanedImageUrl
    bakedDarknessRef.current = 1.0
    manualEditsRef.current = false
    setComponents(result.components || null)
    setImageDims({ width: result.imageWidth || 0, height: result.imageHeight || 0 })
    setCleanedOcrImage(result.ocrImageUrl || result.cleanedImageUrl)
    setCleanupProcessor(result.processor || 'opencv')
    setRotation(0)

    let displayUrl = result.cleanedImageUrl
    if (Math.abs(darkness - 1.0) > 0.001) {
      try {
        displayUrl = await transformCleanedImage(result.cleanedImageUrl, darkness, 1.0, 0)
      } catch {
        displayUrl = result.cleanedImageUrl
      }
    }
    setCleanedImage(displayUrl)
    setSelectedEditImage(displayUrl, 'cleaned')
    setPreviewTab('cleaned')
  }

  // PDF 選頁：每一頁都是獨立的考卷，切頁時把舊 paper 的狀態全部重置
  const handleSelectPdfPage = (page) => {
    if (page.pageNumber === activePdfPage) {
      setStep(2)
      return
    }
    setCurrentPaperId(null)
    setCleanedImage(null)
    setCleanedOcrImage(null)
    setOriginalImage(null)
    setComponents(null)
    setProcessError(null)
    baseCleanedImageRef.current = null
    serverBaseRef.current = null
    bakedDarknessRef.current = 1.0
    manualEditsRef.current = false
    setRotation(0)
    setPreviewTab('original')
    selectPdfPage(page)
    setStep(2)
  }

  const handleProcess = async () => {
    if (!compressed) return

    setIsProcessing(true)
    setProcessError(null)
    setProcessingStatus('uploading')
    setUploadStage('uploading')
    setUploadProgress(0)
    setCleanupProcessor(null)
    setCleanedImage(null)
    setCleanedOcrImage(null)
    setComponents(null)

    try {
      const uploadResult = await uploadMutation.mutateAsync({
        blob: compressed.blob,
        filename: buildFilename(file, activePdfPage),
        onUploadProgress: (event) => {
          if (!event.total) return
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 45))
          setUploadProgress(percent)
        },
      })

      if (uploadResult.paperId) setCurrentPaperId(uploadResult.paperId)
      if (uploadResult.originalImageUrl) setOriginalImage(uploadResult.originalImageUrl)

      setUploadStage('cleaning')
      setProcessingStatus('processing')
      setUploadProgress(55)

      // 後端永遠只算 darkness=1.0 的基準圖；滑桿黑度由前端即時套用
      const cleanResult = await cleanMutation.mutateAsync({
        paperId: uploadResult.paperId,
        paper_id: uploadResult.paperId,
        mode: cleanupMode,
        darkness: 1.0,
        include_components: true,
      })

      const activeJobId = cleanResult.jobId || uploadResult.jobId
      if (activeJobId) setCurrentJobId(activeJobId)

      if (cleanResult.cleanedImageUrl) {
        await adoptCleanResult(cleanResult)
        setUploadProgress(100)
        setProcessingStatus('completed')
        setUploadStage('completed')
        setStep(4)
        pushToast({ tone: 'success', title: '辨識完成', description: '可用「智慧擦除」檢查結果、拖滑桿即時調整深淺。' })
        setIsProcessing(false)
        return
      }

      if (activeJobId) {
        setUploadStage('polling')
        setUploadProgress(72)
        const jobResult = await pollCleanJob(activeJobId)
        if (jobResult.paperId) setCurrentPaperId(jobResult.paperId)
        if (jobResult.cleanedImageUrl) {
          await adoptCleanResult(jobResult)
        }
        setUploadProgress(100)
        setProcessingStatus('completed')
        setUploadStage('completed')
        setStep(4)
        pushToast({ tone: 'success', title: '辨識完成', description: `FastAPI 已完成去痕跡任務（模式：${jobResult.processor || cleanupMode}）。` })
        setIsProcessing(false)
        return
      }

      throw new Error('後端尚未回傳 clean image 或 job id')
    } catch (caughtError) {
      const message = caughtError.message || '後端暫時無法完成處理'
      setProcessError(message)
      setProcessingStatus('failed')
      setUploadStage('idle')
      setIsProcessing(false)
      pushToast({ tone: 'error', title: '處理失敗', description: message })
    }
  }

  // 橡皮擦 modal
  const [eraserOpen, setEraserOpen] = useState(false)
  const handleEraserApply = (newUrl) => {
    setCleanedImage(newUrl)
    setSelectedEditImage(newUrl, 'cleaned')
    // 編輯結果直接成為新的 base：把當下黑度「烘焙」進去、旋轉歸零
    baseCleanedImageRef.current = newUrl
    bakedDarknessRef.current = darkness
    manualEditsRef.current = true
    setRotation(0)
    setEraserOpen(false)
  }

  // 智慧擦除：套用使用者的元件級覆寫 + 筆跡樣本點，後端重算一次
  const handleReviewApply = async (keepIds, eraseIds, samplePoints = []) => {
    if (!currentPaperId) return
    setReviewApplying(true)
    try {
      const result = await cleanMutation.mutateAsync({
        paperId: currentPaperId,
        paper_id: currentPaperId,
        mode: cleanupMode,
        darkness: 1.0,
        keep_ids: keepIds,
        erase_ids: eraseIds,
        sample_points: samplePoints,
        include_components: true,
      })
      if (result.cleanedImageUrl) {
        await adoptCleanResult(result)
        // 筆跡樣本結果誠實回報：匹配了幾處、或為什麼沒生效
        const sr = result.raw?.sample_result
        if (samplePoints.length > 0 && sr) {
          if (sr.applied) {
            pushToast({
              tone: 'success',
              title: `筆跡樣本：匹配並擦除 ${sr.matched} 處`,
              description: '效果不夠可以再標新的樣本疊加。',
            })
          } else {
            pushToast({
              tone: 'warning',
              title: '筆跡樣本無法套用',
              description:
                sr.reason === 'indistinguishable'
                  ? '這張考卷的筆跡與印刷在濃度/彩度/筆寬上太接近，樣本無法安全區分（硬套會誤殺印刷）。請改用「⬚ 框選擦除」或逐一點選。'
                  : '樣本點沒有點到筆跡，請點在筆畫上再試一次。',
            })
          }
        } else {
          pushToast({ tone: 'success', title: '已套用', description: '智慧擦除結果已更新。' })
        }
      }
    } catch (err) {
      pushToast({ tone: 'error', title: '套用失敗', description: err.message || '無法套用擦除變更' })
    } finally {
      setReviewApplying(false)
    }
  }

  // 文件校正 modal
  const [cornerOpen, setCornerOpen] = useState(false)
  const [correctingUpload, setCorrectingUpload] = useState(false)

  // 開啟校正：如果還沒上傳過，先做一次 upload
  const handleOpenCornerAdjust = async () => {
    if (!compressed) return
    if (currentPaperId && currentPaperId !== 'mock-paper') {
      setCornerOpen(true)
      return
    }
    // 先上傳（不做清理）
    setCorrectingUpload(true)
    try {
      const uploadResult = await uploadMutation.mutateAsync({
        blob: compressed.blob,
        filename: buildFilename(file, activePdfPage),
        onUploadProgress: () => {},
      })
      if (uploadResult.paperId) setCurrentPaperId(uploadResult.paperId)
      if (uploadResult.originalImageUrl) setOriginalImage(uploadResult.originalImageUrl)
      setCornerOpen(true)
    } catch (err) {
      pushToast({ tone: 'warning', title: '無法開啟校正', description: err.message || '上傳失敗' })
    } finally {
      setCorrectingUpload(false)
    }
  }

  // 校正完成：更新 originalImage + 自動進入 step 4 做辨識
  const handleCornerApply = async (warpedUrl) => {
    setOriginalImage(warpedUrl)
    setCornerOpen(false)
    pushToast({
      tone: 'success',
      title: '校正完成',
      description: '自動套用去手寫處理…',
    })
    // 進入 step 4 並自動觸發辨識
    setStep(4)
    // 稍等 UI 更新再跑
    setTimeout(() => {
      handleProcessFromWarped()
    }, 100)
  }

  // step 4: 用 warped 後的 paper 做 cleanup（paper 已經存在 backend）
  const handleProcessFromWarped = async () => {
    setIsProcessing(true)
    setProcessError(null)
    setProcessingStatus('processing')
    setUploadStage('cleaning')
    try {
      const cleanResult = await cleanMutation.mutateAsync({
        paperId: currentPaperId,
        paper_id: currentPaperId,
        mode: cleanupMode,
        darkness: 1.0,
        include_components: true,
      })
      if (cleanResult.cleanedImageUrl) {
        await adoptCleanResult(cleanResult)
        setProcessingStatus('completed')
        setUploadStage('completed')
        pushToast({ tone: 'success', title: '辨識完成', description: '可用「智慧擦除」檢查結果、拖滑桿即時調整深淺。' })
      }
    } catch (err) {
      const message = err.message || '辨識失敗'
      setProcessError(message)
      setProcessingStatus('failed')
      pushToast({ tone: 'error', title: '辨識失敗', description: message })
    } finally {
      setIsProcessing(false)
    }
  }

  // Zoom + pan
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const panStartRef = useRef({ x: 0, y: 0 })

  const handleZoomIn = () => setZoom((z) => Math.min(5, z + 0.5))
  const handleZoomOut = () => setZoom((z) => Math.max(1, z - 0.5))
  const handleZoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  const handleWheel = (e) => {
    e.preventDefault()
    if (e.deltaY < 0) setZoom((z) => Math.min(5, z + 0.25))
    else setZoom((z) => Math.max(1, z - 0.25))
  }

  const handleMouseDown = (e) => {
    if (zoom <= 1) return
    isDraggingRef.current = true
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    panStartRef.current = { ...pan }
  }
  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return
    setPan({
      x: panStartRef.current.x + (e.clientX - dragStartRef.current.x),
      y: panStartRef.current.y + (e.clientY - dragStartRef.current.y),
    })
  }
  const handleMouseUp = () => { isDraggingRef.current = false }

  // 旋轉處理後的圖：只改角度，顯示由 darkness/rotation effect 統一重建
  const handleRotate = (delta) => {
    if (!baseCleanedImageRef.current) return
    setRotation((prev) => (prev + delta + 360) % 360)
  }

  // 旋轉「原圖」（未處理的壓縮版），用於拍歪的照片
  const handleRotateOriginal = async (delta) => {
    if (!compressed?.previewUrl) return
    try {
      const rotatedUrl = await transformCleanedImage(compressed.previewUrl, 1.0, 1.0, (delta + 360) % 360)
      // 把 blob URL 轉回 Blob + 尺寸，更新 compressed
      const blob = await (await fetch(rotatedUrl)).blob()
      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = rotatedUrl
      })
      replaceCompressed({
        blob,
        previewUrl: rotatedUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        mimeType: blob.type || 'image/png',
      })
      // 如果已經上傳過（有 paperId），要重新上傳，因為 backend 拿到的還是舊的
      if (currentPaperId) {
        setCurrentPaperId(null)
        setOriginalImage(null)
        setCleanedImage(null)
        baseCleanedImageRef.current = null
        setRotation(0)
        pushToast({
          tone: 'info',
          title: '原圖已旋轉',
          description: '請重新按「開始處理」或「校正文件」',
        })
      }
    } catch (err) {
      pushToast({ tone: 'warning', title: '旋轉原圖失敗', description: err.message })
    }
  }

  // 黑度 + 旋轉：純前端即時重建顯示圖（LUT + canvas，不打後端）
  // 80ms 輕量 debounce 只是避免滑桿拖動時每個 tick 都做 putImageData
  useEffect(() => {
    if (!baseCleanedImageRef.current) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const url = await transformCleanedImage(
          baseCleanedImageRef.current,
          darkness,
          bakedDarknessRef.current,
          rotation,
        )
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        setCleanedImage(url)
        setSelectedEditImage(url, 'cleaned')
      } catch (err) {
        if (!cancelled) {
          pushToast({ tone: 'warning', title: '調整失敗', description: err.message || '無法套用顯示設定' })
        }
      }
    }, 80)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [darkness, rotation])

  const statusLabel = isCompressing
    ? '正在壓縮圖片…'
    : uploadStage === 'uploading'
      ? `正在上傳圖片 (${formatPercent(uploadProgress)})`
      : uploadStage === 'cleaning'
        ? '後端正在建立去痕跡任務…'
        : uploadStage === 'polling'
          ? '正在等待 Cloud Run / FastAPI 回傳結果…'
      : `正在整理流程 (${formatPercent(uploadProgress)})`

  const previewOptions = [
    { key: 'original', label: '使用原始圖片進入框選', image: previewUrl },
    { key: 'cleaned', label: '使用處理後進入框選', image: cleanedImage },
  ].filter((option) => Boolean(option.image))

  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
      <GlassCard title="處理步驟" description="跟著四個步驟就能得到乾淨的考卷：載入 → 旋轉 → 校正 → 辨識。">
        {/* Step indicator */}
        <div className="flex items-center justify-between gap-2 rounded-[24px] border border-white/10 bg-slate-950/40 p-3">
          {STEPS.map((s, idx) => (
            <div key={s.id} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  step > s.id
                    ? 'border-cyan-400 bg-cyan-400 text-slate-900'
                    : step === s.id
                      ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300'
                      : 'border-white/20 bg-slate-900 text-slate-500'
                }`}
              >
                {step > s.id ? '✓' : s.id}
              </div>
              <div className={`text-xs ${step >= s.id ? 'text-white' : 'text-slate-500'}`}>
                {s.label}
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`h-px flex-1 ${step > s.id ? 'bg-cyan-400' : 'bg-white/10'}`} />
              )}
            </div>
          ))}
        </div>

        {/* === Step 1: 載入考卷 === */}
        {step === 1 && (
          <div className="mt-4 space-y-3">
            <label className={`flex cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-cyan-200/25 bg-slate-950/35 px-6 text-center text-slate-300 transition hover:bg-slate-950/45 ${pdfPages.length > 0 ? 'min-h-[100px] py-4' : 'min-h-[240px]'}`}>
              <input type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={(event) => onSelectFile(event.target.files?.[0])} />
              <div className="text-lg font-medium text-white">📷 選擇考卷照片或 PDF</div>
              <div className="mt-2 text-sm text-slate-400">支援 JPG / PNG / HEIC / PDF（多頁 PDF 可逐頁處理），自動轉成 2048px 圖片</div>
            </label>
            {error && <p className="text-sm text-rose-300">{error}</p>}
            {isCompressing && <Spinner label={file && file.name?.toLowerCase().endsWith('.pdf') ? '正在轉換 PDF 頁面…' : '正在壓縮圖片…'} />}

            {/* PDF 多頁：選擇要處理的頁面 */}
            {pdfPages.length > 0 && !isCompressing && (
              <div className="rounded-[20px] border border-white/10 bg-slate-950/40 p-4">
                <div className="text-sm font-medium text-white">選擇要處理的頁面（共 {pdfPages.length} 頁）</div>
                <div className="mt-1 text-xs text-slate-400">每一頁是一張獨立考卷；處理完一頁後可回到這裡選下一頁。</div>
                <div className="mt-3 grid max-h-[420px] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
                  {pdfPages.map((page) => (
                    <button
                      key={page.pageNumber}
                      onClick={() => handleSelectPdfPage(page)}
                      className={`group relative overflow-hidden rounded-xl border-2 bg-white transition ${
                        page.pageNumber === activePdfPage
                          ? 'border-cyan-400 ring-2 ring-cyan-400/40'
                          : 'border-white/10 hover:border-cyan-300/60'
                      }`}
                    >
                      <img src={page.previewUrl} alt={`第 ${page.pageNumber} 頁`} className="aspect-[3/4] w-full object-contain" />
                      <div className={`absolute inset-x-0 bottom-0 py-1 text-center text-xs font-medium ${
                        page.pageNumber === activePdfPage ? 'bg-cyan-400 text-slate-900' : 'bg-slate-900/80 text-slate-200'
                      }`}>
                        第 {page.pageNumber} 頁{page.pageNumber === activePdfPage ? '（目前）' : ''}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* === Step 2: 旋轉方向 === */}
        {step === 2 && (
          <div className="mt-4 space-y-3">
            <div className="rounded-[20px] border border-white/10 bg-slate-950/40 p-4">
              <div className="text-sm font-medium text-white">調整方向</div>
              <div className="mt-1 text-xs text-slate-400">如果照片是橫的或倒的，用下面按鈕轉正。右側預覽會即時更新。</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => handleRotateOriginal(-90)}>↺ 左轉 90°</Button>
                <Button size="sm" variant="secondary" onClick={() => handleRotateOriginal(90)}>↻ 右轉 90°</Button>
                <Button size="sm" variant="secondary" onClick={() => handleRotateOriginal(180)}>⇅ 翻轉 180°</Button>
              </div>
            </div>
            <div className="text-xs text-slate-400">檔名：{file?.name}</div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setStep(1)
                  // 多頁 PDF 回到選頁畫面就好，不清掉已轉好的頁面
                  if (pdfPages.length <= 1) replaceCompressed(null)
                }}
              >
                ← 重新選檔
              </Button>
              <Button
                className="ml-auto"
                disabled={!compressed}
                onClick={() => setStep(3)}
              >
                下一步 →
              </Button>
            </div>
          </div>
        )}

        {/* === Step 3: 梯形校正 === */}
        {step === 3 && (
          <div className="mt-4 space-y-3">
            <div className="rounded-[20px] border border-cyan-400/25 bg-cyan-400/5 p-4">
              <div className="text-sm font-medium text-white">這份考卷需要校正嗎？</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-400">
                <span className="text-slate-300">掃描檔或 PDF 通常不需要校正</span>，直接辨識即可。
                只有用手機「斜著拍」的照片，才需要打開校正工具拖動 4 個角點把文件拉正。
              </div>
              <Button className="mt-3 w-full" onClick={() => { setStep(4); handleProcess(); }}>
                ✨ 直接辨識（去除手寫）→
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2 w-full"
                disabled={correctingUpload}
                onClick={handleOpenCornerAdjust}
              >
                {correctingUpload ? '準備中…' : '📐 照片拍歪了，先校正'}
              </Button>
              {cornerOpen && (
                <div className="mt-2 text-xs text-cyan-300">請在彈出的校正視窗中拖動 4 個角點</div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setStep(2)}>← 返回旋轉</Button>
            </div>
          </div>
        )}

        {/* === Step 4: 辨識完成 === */}
        {step === 4 && (
          <div className="mt-4 space-y-3">
            {isProcessing && (
              <div className="rounded-[20px] border border-cyan-400/30 bg-cyan-400/10 p-4">
                <Spinner label={statusLabel} />
              </div>
            )}
            {processError && !isProcessing && (
              <NoticeBanner
                tone="error"
                title="處理失敗"
                description={processError}
                actions={<Button size="sm" onClick={handleProcess}>重試</Button>}
              />
            )}
            {cleanedImage && !isProcessing && (
              <NoticeBanner
                tone="success"
                title="辨識完成"
                description="右側可用「智慧擦除」修正誤判、拖滑桿即時調整深淺、旋轉、橡皮擦微調。"
                actions={<Button size="sm" onClick={() => navigate('/edit')}>前往框選頁 →</Button>}
              />
            )}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setStep(3)}>← 返回校正</Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setStep(1)
                  replaceCompressed(null)
                  setCurrentPaperId(null)
                  setCleanedImage(null)
                  setOriginalImage(null)
                  baseCleanedImageRef.current = null
                  serverBaseRef.current = null
                  bakedDarknessRef.current = 1.0
                  manualEditsRef.current = false
                  setComponents(null)
                  setProcessError(null)
                  setRotation(0)
                  setPreviewTab('original')
                }}
              >
                重新開始
              </Button>
            </div>
          </div>
        )}
      </GlassCard>

      <ScanFrame>
        <div className="rounded-[24px] bg-slate-950/30 p-4 space-y-3">
          {/* 預覽工具列：原始/處理後切換 + 縮放 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-900/70 p-1">
              <button
                onClick={() => { setPreviewTab('original'); handleZoomReset() }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  previewTab === 'original' || !cleanedImage
                    ? 'bg-cyan-400/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                📄 原始考卷
              </button>
              <button
                onClick={() => { if (cleanedImage) { setPreviewTab('cleaned'); handleZoomReset() } }}
                disabled={!cleanedImage}
                title={cleanedImage ? '' : '完成辨識後才能檢視'}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  previewTab === 'cleaned' && cleanedImage
                    ? 'bg-cyan-400/20 text-cyan-200'
                    : cleanedImage
                      ? 'text-slate-400 hover:text-slate-200'
                      : 'cursor-not-allowed text-slate-600'
                }`}
              >
                ✨ 處理後
              </button>
            </div>
            {(previewUrl || cleanedImage) && (
              <div className="flex items-center gap-2">
                <span className="hidden text-[11px] text-slate-500 sm:inline">滾輪縮放・放大後可拖曳</span>
                <div className="flex items-center gap-1">
                  <button onClick={handleZoomOut} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-300 hover:bg-white/10" title="縮小">−</button>
                  <button onClick={handleZoomReset} className="min-w-[52px] rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10" title="重設">{Math.round(zoom * 100)}%</button>
                  <button onClick={handleZoomIn} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-300 hover:bg-white/10" title="放大">+</button>
                </div>
              </div>
            )}
          </div>

          {/* 大預覽區（占滿可視高度，看得清考卷內容） */}
          {(() => {
            const showCleaned = previewTab === 'cleaned' && Boolean(cleanedImage)
            const activeImage = showCleaned ? cleanedImage : previewUrl
            if (!activeImage) {
              return (
                <div className="flex h-[55vh] min-h-[380px] flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-white/15 bg-white/5 text-slate-400">
                  <div className="text-3xl">🗂️</div>
                  <div className="text-sm">在左側選擇考卷照片或 PDF，這裡會顯示大圖預覽</div>
                </div>
              )
            }
            return (
              <div
                className="relative h-[58vh] min-h-[420px] w-full overflow-hidden rounded-[22px] border border-white/10 bg-white"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ cursor: zoom > 1 ? (isDraggingRef.current ? 'grabbing' : 'grab') : 'default' }}
              >
                <img
                  src={activeImage}
                  alt={showCleaned ? 'cleaned preview' : 'original preview'}
                  draggable={false}
                  className="h-full w-full select-none object-contain transition-transform"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                  }}
                />
                <div className={`pointer-events-none absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-medium ${
                  showCleaned ? 'bg-emerald-500/90 text-white' : 'bg-slate-900/80 text-slate-200'
                }`}>
                  {showCleaned ? '✨ 處理後（已去手寫）' : '📄 原始考卷'}
                </div>
              </div>
            )
          })()}

          {/* 原始檢視：旋轉工具列 */}
          {previewUrl && (previewTab === 'original' || !cleanedImage) && (
            <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-white/10 bg-slate-950/40 px-4 py-3">
              <span className="text-xs text-slate-400">照片歪了？</span>
              <Button size="sm" variant="secondary" onClick={() => handleRotateOriginal(-90)}>↺ 左轉</Button>
              <Button size="sm" variant="secondary" onClick={() => handleRotateOriginal(90)}>↻ 右轉</Button>
              <Button size="sm" variant="secondary" onClick={() => handleRotateOriginal(180)}>⇅ 翻轉</Button>
            </div>
          )}

          <div>
            {cleanedImage && (
              <>
                {components && components.length > 0 && (
                  <div className="mt-4 rounded-[18px] border border-cyan-400/20 bg-cyan-400/5 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-slate-200">🪄 智慧擦除</div>
                      <div className="text-xs text-slate-400">
                        已自動擦除 {components.filter((c) => c.erased).length} 處筆跡
                      </div>
                    </div>
                    <div className="mt-2 text-xs leading-relaxed text-slate-400">
                      👆 點選：誤刪的還原、漏掉的擦除<br />
                      ⬚ 框選擦除：拖方框整片清除<br />
                      🖊 筆跡樣本：鉛筆漏很多時，點 3-5 處讓系統舉一反三全頁清除
                    </div>
                    <Button size="sm" className="mt-3 w-full" onClick={() => setReviewOpen(true)}>
                      開啟智慧擦除工具
                    </Button>
                  </div>
                )}

                <div className="mt-3 rounded-[18px] border border-white/10 bg-slate-950/40 p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">印刷字加深（即時）</span>
                    <span className="text-cyan-300 font-mono text-xs">{darkness.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.05"
                    value={darkness}
                    onChange={(e) => setDarkness(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>較淡</span>
                    <span>預設</span>
                    <span>更深</span>
                  </div>
                </div>

                <div className="mt-3 rounded-[18px] border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-300">頁面旋轉</div>
                    <div className="text-xs text-slate-500">{rotation}°</div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => handleRotate(-90)}>↺ 左轉</Button>
                    <Button size="sm" variant="secondary" onClick={() => handleRotate(90)}>↻ 右轉</Button>
                    <Button size="sm" variant="secondary" onClick={() => handleRotate(180)}>⇅ 翻轉</Button>
                  </div>
                </div>

                <div className="mt-3 rounded-[18px] border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-300">手動微調瑕疵</div>
                  </div>
                  <div className="mt-2 text-xs text-slate-400">用橡皮擦或矩形清除工具，把殘留的瑕疵蓋成白色。</div>
                  <Button size="sm" className="mt-3 w-full" onClick={() => setEraserOpen(true)}>
                    🖌 開啟編輯器
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </ScanFrame>

      {eraserOpen && cleanedImage && (
        <EraserModal
          imageUrl={cleanedImage}
          onClose={() => setEraserOpen(false)}
          onApply={handleEraserApply}
        />
      )}

      {reviewOpen && serverBaseRef.current && components && (
        <ComponentReviewModal
          imageUrl={serverBaseRef.current}
          originalImageUrl={usePaperStore.getState().originalImage}
          components={components}
          imageWidth={imageDims.width}
          imageHeight={imageDims.height}
          isApplying={reviewApplying}
          onApply={handleReviewApply}
          onClose={() => setReviewOpen(false)}
          hasManualEdits={manualEditsRef.current}
        />
      )}

      {cornerOpen && currentPaperId && (
        <CornerAdjustModal
          paperId={currentPaperId}
          originalImageUrl={usePaperStore.getState().originalImage || previewUrl}
          onClose={() => setCornerOpen(false)}
          onApply={handleCornerApply}
        />
      )}
    </div>
  )
}
