import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/Button'
import GlassCard from '@/components/ui/GlassCard'
import NoticeBanner from '@/components/ui/NoticeBanner'
import Spinner from '@/components/ui/Spinner'
import ScanFrame from '@/features/paper-process/components/ScanFrame'
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
  const uploadProgress = usePaperStore((state) => state.uploadProgress)
  const uploadStage = usePaperStore((state) => state.uploadStage)
  const setUploadProgress = usePaperStore((state) => state.setUploadProgress)
  const setUploadStage = usePaperStore((state) => state.setUploadStage)
  const setProcessingStatus = usePaperStore((state) => state.setProcessingStatus)
  const setOriginalImage = usePaperStore((state) => state.setOriginalImage)
  const setCleanedImage = usePaperStore((state) => state.setCleanedImage)
  const setCurrentPaperId = usePaperStore((state) => state.setCurrentPaperId)
  const setCurrentJobId = usePaperStore((state) => state.setCurrentJobId)
  const currentPaperId = usePaperStore((state) => state.currentPaperId)
  const currentJobId = usePaperStore((state) => state.currentJobId)
  const processingStatus = usePaperStore((state) => state.processingStatus)
  const cleanedImage = usePaperStore((state) => state.cleanedImage)
  const pushToast = useUiStore((state) => state.pushToast)
  const { uploadMutation, cleanMutation, pollCleanJob } = usePaperProcess()

  useEffect(() => {
    if (!previewUrl) return
    setOriginalImage(previewUrl)
  }, [previewUrl, setOriginalImage])

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

      if (uploadResult.paperId) {
        setCurrentPaperId(uploadResult.paperId)
      }

      if (uploadResult.originalImageUrl) {
        setOriginalImage(uploadResult.originalImageUrl)
      }

      if (uploadResult.cleanedImageUrl) {
        setCleanedImage(uploadResult.cleanedImageUrl)
        setUploadProgress(100)
        setProcessingStatus('completed')
        setUploadStage('completed')
        pushToast({
          tone: 'success',
          title: '預處理完成',
          description: '後端已直接回傳 clean image，現在可以前往框選頁。',
        })
        setIsProcessing(false)
        return
      }

      setUploadStage('cleaning')
      setProcessingStatus('processing')
      setUploadProgress(55)

      const cleanResult = await cleanMutation.mutateAsync({
        paperId: uploadResult.paperId,
        paper_id: uploadResult.paperId,
        jobId: uploadResult.jobId,
        job_id: uploadResult.jobId,
      })

      const activeJobId = cleanResult.jobId || uploadResult.jobId
      if (activeJobId) {
        setCurrentJobId(activeJobId)
      }

      if (cleanResult.cleanedImageUrl) {
        setCleanedImage(cleanResult.cleanedImageUrl)
        setUploadProgress(100)
        setProcessingStatus('completed')
        setUploadStage('completed')
        pushToast({
          tone: 'success',
          title: '預處理完成',
          description: '後端已完成清理並回傳 clean image。',
        })
        setIsProcessing(false)
        return
      }

      if (activeJobId) {
        setUploadStage('polling')
        setUploadProgress(72)
        const jobResult = await pollCleanJob(activeJobId)
        if (jobResult.paperId) {
          setCurrentPaperId(jobResult.paperId)
        }
        if (jobResult.cleanedImageUrl) {
          setCleanedImage(jobResult.cleanedImageUrl)
        }
        setUploadProgress(100)
        setProcessingStatus('completed')
        setUploadStage('completed')
        pushToast({
          tone: 'success',
          title: '輪詢成功',
          description: 'Cloud Run / FastAPI 已完成去筆跡任務。',
        })
        setIsProcessing(false)
        return
      }

      throw new Error('後端尚未回傳 clean image 或 job id')
    } catch (caughtError) {
      pushToast({
        tone: 'warning',
        title: '後端暫時無法完成處理',
        description: caughtError.message || '先切回本地 fallback，避免整個流程卡住。',
      })
      await simulateProcessing()
    }
  }

  const statusLabel = isCompressing
    ? '正在壓縮圖片…'
    : uploadStage === 'uploading'
      ? `正在上傳圖片 (${formatPercent(uploadProgress)})`
      : uploadStage === 'cleaning'
        ? '後端正在建立去痕跡任務…'
        : uploadStage === 'polling'
          ? '正在等待 Cloud Run / FastAPI 回傳結果…'
          : `正在整理流程 (${formatPercent(uploadProgress)})`

  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
      <GlassCard title="上傳試卷" description="先在瀏覽器中壓縮圖片，再交給 FastAPI 與 OpenCV 進行去痕跡、拉平與後續分析。">
        <label className="flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-cyan-200/25 bg-slate-950/35 px-6 text-center text-slate-300 transition hover:bg-slate-950/45">
          <input type="file" accept="image/*" className="hidden" onChange={(event) => onSelectFile(event.target.files?.[0])} />
          <div className="text-lg font-medium text-white">選擇要處理的試卷照片</div>
          <div className="mt-2 text-sm text-slate-400">前端會先將最長邊限制在 2048px 並轉成 WebP，再送往 FastAPI。</div>
        </label>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

        {file && !error && (
          <div className="mt-4 space-y-2 rounded-[24px] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            <div>檔名：{file.name}</div>
            {meta.length > 0 && <div>{meta.join(' ｜ ')}</div>}
            {(isCompressing || isProcessing) && <Spinner label={statusLabel} />}
          </div>
        )}

        {!file && (
          <div className="mt-4">
            <NoticeBanner
              title="尚未選擇試卷照片"
              description="先上傳一張清楚的考卷圖片，系統才會開始壓縮與預處理。"
            />
          </div>
        )}

        {file && cleanedImage && (
          <div className="mt-4">
            <NoticeBanner
              tone="success"
              title="預處理已完成"
              description={`目前 paper id：${currentPaperId || '尚未取得'}，你可以前往框選頁開始整理題目。`}
              actions={<Button size="sm" onClick={() => navigate('/edit')}>前往框選頁</Button>}
            />
          </div>
        )}

        {file && !cleanedImage && processingStatus !== 'idle' && (
          <div className="mt-4">
            <NoticeBanner
              tone="warning"
              title="正在等待去痕跡結果"
              description={`目前階段：${uploadStage}｜job id：${currentJobId || '尚未建立'}。若等待過久，可稍後重新整理再試。`}
            />
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button disabled={!compressed || isCompressing || isProcessing} onClick={handleProcess}>
            開始處理
          </Button>
          <Button variant="secondary" disabled={!compressed}>
            查看後端 API 合約
          </Button>
        </div>
      </GlassCard>

      <ScanFrame>
        <div className="rounded-[24px] bg-slate-950/30 p-4">
          {previewUrl ? (
            <img src={previewUrl} alt="preview" className="max-h-[620px] w-full rounded-[22px] object-contain" />
          ) : (
            <div className="flex min-h-[620px] items-center justify-center rounded-[22px] border border-white/10 bg-white/5 text-sm text-slate-400">
              上傳完成後，右側會顯示原始圖片預覽，方便你確認角度、亮度與內容是否正確。
            </div>
          )}
        </div>
      </ScanFrame>
    </div>
  )
}
