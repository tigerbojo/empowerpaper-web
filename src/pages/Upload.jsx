import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/Button'
import GlassCard from '@/components/ui/GlassCard'
import NoticeBanner from '@/components/ui/NoticeBanner'
import Spinner from '@/components/ui/Spinner'
import ScanFrame from '@/features/paper-process/components/ScanFrame'
import EraserModal from '@/features/paper-process/components/EraserModal'
import { useImageUpload } from '@/features/paper-process/hooks/useImageUpload'
import { usePaperProcess } from '@/features/paper-process/hooks/usePaperProcess'
import usePaperStore from '@/store/usePaperStore'
import useUiStore from '@/store/useUiStore'
import { formatPercent } from '@/utils/formatters'

function buildFilename(file) {
  if (!file?.name) return 'paper.webp'
  const base = file.name.replace(/\.[^.]+$/, '')
  return `${base}.webp`
}

export default function Upload() {
  const navigate = useNavigate()
  const { file, error, previewUrl, compressed, isCompressing, onSelectFile } = useImageUpload()
  const [isProcessing, setIsProcessing] = useState(false)
  const [isAdjusting, setIsAdjusting] = useState(false)
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
  }, [previewUrl, setOriginalImage, setSelectedEditImage])

  const meta = useMemo(() => {
    if (!compressed) return []
    return [
      `尺寸 ${compressed.width} × ${compressed.height}`,
      `格式 ${compressed.mimeType.replace('image/', '').toUpperCase()}`,
      `${Math.round((compressed.blob.size / 1024) * 10) / 10} KB`,
    ]
  }, [compressed])

  const simulateProcessing = async () => {
    if (!compressed) return
    setIsProcessing(true)
    setUploadStage('mock-processing')
    setProcessingStatus('processing')
    setUploadProgress(0)
    const checkpoints = [16, 35, 58, 77, 100]
    for (const checkpoint of checkpoints) {
      await new Promise((resolve) => setTimeout(resolve, 320))
      setUploadProgress(checkpoint)
    }
    setCleanedImage(previewUrl)
    setCleanedOcrImage(previewUrl)
    setSelectedEditImage(previewUrl, 'original')
    setCleanupProcessor('opencv')
    setProcessingStatus('completed')
    setUploadStage('completed')
    setCurrentPaperId('mock-paper')
    setCurrentJobId('mock-job')
    setIsProcessing(false)
  }

  const handleProcess = async () => {
    if (!compressed) return

    setIsProcessing(true)
    setProcessingStatus('uploading')
    setUploadStage('uploading')
    setUploadProgress(0)
    setCleanupProcessor(null)
    setCleanedImage(null)
    setCleanedOcrImage(null)

    try {
      const uploadResult = await uploadMutation.mutateAsync({
        blob: compressed.blob,
        filename: buildFilename(file),
        onUploadProgress: (event) => {
          if (!event.total) return
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 45))
          setUploadProgress(percent)
        },
      })

      if (uploadResult.paperId) setCurrentPaperId(uploadResult.paperId)
      if (uploadResult.originalImageUrl) setOriginalImage(uploadResult.originalImageUrl)

      if (uploadResult.cleanedImageUrl) {
        setCleanedImage(uploadResult.cleanedImageUrl)
        setCleanedOcrImage(uploadResult.ocrImageUrl || uploadResult.cleanedImageUrl)
        setSelectedEditImage(uploadResult.cleanedImageUrl, 'cleaned')
        setCleanupProcessor(uploadResult.processor || 'opencv')
        setUploadProgress(100)
        setProcessingStatus('completed')
        setUploadStage('completed')
        pushToast({ tone: 'success', title: '預處理完成', description: `後端已直接回傳雙預覽（模式：${uploadResult.processor || cleanupMode}）。` })
        setIsProcessing(false)
        return
      }

      setUploadStage('cleaning')
      setProcessingStatus('processing')
      setUploadProgress(55)

      const cleanResult = await cleanMutation.mutateAsync({
        paperId: uploadResult.paperId,
        paper_id: uploadResult.paperId,
        mode: cleanupMode,
        darkness,
      })

      const activeJobId = cleanResult.jobId || uploadResult.jobId
      if (activeJobId) setCurrentJobId(activeJobId)

      if (cleanResult.cleanedImageUrl) {
        setCleanedImage(cleanResult.cleanedImageUrl)
        setCleanedOcrImage(cleanResult.ocrImageUrl || cleanResult.cleanedImageUrl)
        setSelectedEditImage(cleanResult.cleanedImageUrl, 'cleaned')
        setCleanupProcessor(cleanResult.processor || 'opencv')
        setUploadProgress(100)
        setProcessingStatus('completed')
        setUploadStage('completed')
        lastProcessedDarkness.current = darkness
        baseCleanedImageRef.current = cleanResult.cleanedImageUrl
        setRotation(0)
        pushToast({ tone: 'success', title: '預處理完成', description: '可以拖動下方滑桿微調印刷字深淺。' })
        setIsProcessing(false)
        return
      }

      if (activeJobId) {
        setUploadStage('polling')
        setUploadProgress(72)
        const jobResult = await pollCleanJob(activeJobId)
        if (jobResult.paperId) setCurrentPaperId(jobResult.paperId)
        if (jobResult.cleanedImageUrl) setCleanedImage(jobResult.cleanedImageUrl)
        if (jobResult.ocrImageUrl || jobResult.cleanedImageUrl) setCleanedOcrImage(jobResult.ocrImageUrl || jobResult.cleanedImageUrl)
        if (jobResult.cleanedImageUrl) setSelectedEditImage(jobResult.cleanedImageUrl, 'cleaned')
        setCleanupProcessor(jobResult.processor || 'opencv')
        setUploadProgress(100)
        setProcessingStatus('completed')
        setUploadStage('completed')
        pushToast({ tone: 'success', title: '輪詢成功', description: `FastAPI 已完成去痕跡任務（模式：${jobResult.processor || cleanupMode}）。` })
        setIsProcessing(false)
        return
      }

      throw new Error('後端尚未回傳 clean image 或 job id')
    } catch (caughtError) {
      pushToast({ tone: 'warning', title: '後端暫時無法完成處理', description: caughtError.message || '先切回本地 fallback，避免整個流程卡住。' })
      await simulateProcessing()
    }
  }

  // 用 ref 追蹤上次處理過的 darkness，避免初次處理完成觸發 reprocess
  const lastProcessedDarkness = useRef(null)
  // 累積旋轉角度（純前端）
  const [rotation, setRotation] = useState(0)
  // 旋轉前的「基礎」圖片（每次重新處理或載入時更新）
  const baseCleanedImageRef = useRef(null)
  // 橡皮擦 modal
  const [eraserOpen, setEraserOpen] = useState(false)
  const handleEraserApply = (newUrl) => {
    setCleanedImage(newUrl)
    setSelectedEditImage(newUrl, 'cleaned')
    baseCleanedImageRef.current = newUrl // 後續滑桿/旋轉以這張為基準
    setEraserOpen(false)
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

  // 旋轉圖片：用 canvas 讀原圖 → 旋轉 → toDataURL
  const rotateImage = async (imageUrl, angleDeg) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const radians = (angleDeg * Math.PI) / 180
        // 90/270 度時 width/height 互換
        if (angleDeg % 180 === 0) {
          canvas.width = img.width
          canvas.height = img.height
        } else {
          canvas.width = img.height
          canvas.height = img.width
        }
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate(radians)
        ctx.drawImage(img, -img.width / 2, -img.height / 2)
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('canvas.toBlob 失敗'))
          resolve(URL.createObjectURL(blob))
        }, 'image/png')
      }
      img.onerror = () => reject(new Error('讀取圖片失敗'))
      img.src = imageUrl
    })
  }

  const handleRotate = async (delta) => {
    if (!baseCleanedImageRef.current) return
    const newAngle = (rotation + delta + 360) % 360
    setRotation(newAngle)
    try {
      const rotatedUrl = await rotateImage(baseCleanedImageRef.current, newAngle)
      setCleanedImage(rotatedUrl)
      setSelectedEditImage(rotatedUrl, 'cleaned')
    } catch (err) {
      pushToast({ tone: 'warning', title: '旋轉失敗', description: err.message })
    }
  }

  // 滑桿 debounce：停止拖動 600ms 後才送請求
  useEffect(() => {
    if (!cleanedImage || !currentPaperId || currentPaperId === 'mock-paper') return
    // 跟上次 reprocess 一樣 → 跳過
    if (lastProcessedDarkness.current === darkness) return

    console.log('[darkness effect triggered]', { darkness, paperId: currentPaperId, last: lastProcessedDarkness.current })

    const timer = setTimeout(async () => {
      console.log('[reprocess start]', darkness)
      lastProcessedDarkness.current = darkness
      setIsAdjusting(true)
      try {
        const cleanResult = await cleanMutation.mutateAsync({
          paperId: currentPaperId,
          paper_id: currentPaperId,
          mode: cleanupMode,
          darkness,
        })
        console.log('[reprocess result]', cleanResult)

        if (cleanResult.cleanedImageUrl) {
          baseCleanedImageRef.current = cleanResult.cleanedImageUrl
          // 如果有旋轉，套用旋轉後再 setCleanedImage
          if (rotation !== 0) {
            try {
              const rotatedUrl = await rotateImage(cleanResult.cleanedImageUrl, rotation)
              setCleanedImage(rotatedUrl)
              setSelectedEditImage(rotatedUrl, 'cleaned')
            } catch {
              setCleanedImage(cleanResult.cleanedImageUrl)
              setSelectedEditImage(cleanResult.cleanedImageUrl, 'cleaned')
            }
          } else {
            setCleanedImage(cleanResult.cleanedImageUrl)
            setSelectedEditImage(cleanResult.cleanedImageUrl, 'cleaned')
          }
        }
      } catch (err) {
        console.error('[reprocess error]', err)
        pushToast({ tone: 'warning', title: '調整失敗', description: err.message || '無法套用新的黑度設定' })
      } finally {
        setIsAdjusting(false)
      }
    }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [darkness])

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
      <GlassCard title="上傳試卷" description="上傳考卷照片，系統會自動去除手寫痕跡、加強印刷字、產出乾淨的複習卷。">
        <label className="flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-cyan-200/25 bg-slate-950/35 px-6 text-center text-slate-300 transition hover:bg-slate-950/45">
          <input type="file" accept="image/*" className="hidden" onChange={(event) => onSelectFile(event.target.files?.[0])} />
          <div className="text-lg font-medium text-white">選擇要處理的試卷照片</div>
          <div className="mt-2 text-sm text-slate-400">前端會先將最長邊限制在 2048px 並轉成 WebP，再送往 FastAPI。</div>
        </label>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

        {file && !error && (
          <div className="mt-4 space-y-3 rounded-[24px] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            <div>檔名：{file.name}</div>
            {meta.length > 0 && <div>{meta.join(' ｜ ')}</div>}
            {(isCompressing || isProcessing) && <Spinner label={statusLabel} />}
          </div>
        )}

        {!file && (
          <div className="mt-4">
            <NoticeBanner title="尚未選擇試卷照片" description="先上傳一張清楚的考卷圖片，系統才會開始壓縮與預處理。" />
          </div>
        )}

        {file && cleanedImage && (
          <div className="mt-4">
            <NoticeBanner tone="success" title="預處理已完成" description="可以前往框選頁挑選錯題。" actions={<Button size="sm" onClick={() => navigate('/edit')}>前往框選頁</Button>} />
          </div>
        )}

        {previewOptions.length > 0 && (
          <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-medium text-white">框選頁影像來源</div>
            <div className="mt-2 text-sm text-slate-400">先選定你要帶進框選頁的版本。原圖通常最穩，閱讀版適合人眼，OCR 版則偏向辨識用途。</div>
            <div className="mt-4 flex flex-wrap gap-3">
              {previewOptions.map((option) => (
                <Button
                  key={option.key}
                  size="sm"
                  variant={selectedEditImageKind === option.key ? 'primary' : 'secondary'}
                  onClick={() => setSelectedEditImage(option.image, option.key)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {file && !cleanedImage && processingStatus !== 'idle' && (
          <div className="mt-4">
            <NoticeBanner tone="warning" title="正在處理中…" description={`目前階段：${uploadStage}`} />
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button disabled={!compressed || isCompressing || isProcessing} onClick={handleProcess}>開始處理</Button>
        </div>
      </GlassCard>

      <ScanFrame>
        <div className="rounded-[24px] bg-slate-950/30 p-4 space-y-4">
          <div>
            <div className="mb-2 text-sm font-medium text-slate-300">原始圖片</div>
            {previewUrl ? (
              <img src={previewUrl} alt="original preview" className="max-h-[300px] w-full rounded-[22px] object-contain" />
            ) : (
              <div className="flex min-h-[220px] items-center justify-center rounded-[22px] border border-white/10 bg-white/5 text-sm text-slate-400">上傳完成後，這裡會顯示原始圖片預覽。</div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-300">處理後預覽</div>
              <div className="flex items-center gap-2">
                {isAdjusting && <div className="text-xs text-cyan-300">套用新黑度中…</div>}
                {cleanedImage && (
                  <div className="flex items-center gap-1">
                    <button onClick={handleZoomOut} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10" title="縮小">−</button>
                    <button onClick={handleZoomReset} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10 min-w-[44px]" title="重設">{Math.round(zoom * 100)}%</button>
                    <button onClick={handleZoomIn} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10" title="放大">+</button>
                  </div>
                )}
              </div>
            </div>
            {cleanedImage ? (
              <div
                className="relative h-[300px] sm:h-[400px] lg:h-[500px] w-full overflow-hidden rounded-[22px] border border-white/10 bg-white"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ cursor: zoom > 1 ? (isDraggingRef.current ? 'grabbing' : 'grab') : 'default' }}
              >
                <img
                  src={cleanedImage}
                  alt="cleaned preview"
                  draggable={false}
                  className="h-full w-full object-contain select-none transition-transform"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                  }}
                />
              </div>
            ) : (
              <div className="flex min-h-[300px] items-center justify-center rounded-[22px] border border-white/10 bg-white/5 text-sm text-slate-400">完成處理後，這裡會顯示去除手寫、加深印刷字的乾淨版本。</div>
            )}

            {cleanedImage && (
              <>
                <div className="mt-4 rounded-[18px] border border-white/10 bg-slate-950/40 p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">印刷字加深</span>
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
    </div>
  )
}
