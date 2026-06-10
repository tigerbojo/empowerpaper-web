import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Cropper from 'react-cropper'
import 'cropperjs/dist/cropper.css'
import GlassCard from '@/components/ui/GlassCard'
import Button from '@/components/ui/Button'
import usePaperStore from '@/store/usePaperStore'
import useUiStore from '@/store/useUiStore'
import { blobToDataUrl, cropCanvasToBlob, cropImageByNormalizedBbox } from '@/features/cropping/utils/canvasCrop'
import { useCropActions } from '@/features/cropping/hooks/useCropActions'
import { paperApi } from '@/services/paperApi'
import DetectedQuestionsPanel from './DetectedQuestionsPanel'

function buildFallbackTags(index) {
  const presets = [
    ['國中數學', '等差數列', '基礎'],
    ['國中數學', '數列', '進階'],
    ['國中數學', '函數', '精熟'],
  ]
  return presets[index % presets.length]
}

export default function CropWorkspace() {
  const navigate = useNavigate()
  const cropperRef = useRef(null)
  const selectedEditImage = usePaperStore((state) => state.selectedEditImage)
  const selectedEditImageKind = usePaperStore((state) => state.selectedEditImageKind)
  const currentPaperId = usePaperStore((state) => state.currentPaperId)
  const crops = usePaperStore((state) => state.crops)
  const addCrop = usePaperStore((state) => state.addCrop)
  const updateCrop = usePaperStore((state) => state.updateCrop)
  const removeCrop = usePaperStore((state) => state.removeCrop)
  const pushToast = useUiStore((state) => state.pushToast)
  const [isSaving, setIsSaving] = useState(false)
  const [autoCropMode, setAutoCropMode] = useState(false)
  const [isDetecting, setIsDetecting] = useState(false)
  const [detectedBoxes, setDetectedBoxes] = useState([])
  const [detectProvider, setDetectProvider] = useState(null)
  // 拖曳模式：crop = 拖出框選、move = 拖動畫面（縮放後平移用）
  const [dragMode, setDragMode] = useState('crop')
  const { saveCropWithSuggestions } = useCropActions()

  const switchDragMode = (mode) => {
    setDragMode(mode)
    cropperRef.current?.cropper?.setDragMode(mode)
  }
  const zoomBy = (delta) => cropperRef.current?.cropper?.zoom(delta)
  const resetView = () => {
    cropperRef.current?.cropper?.reset()
    switchDragMode('crop')
  }

  const canCrop = Boolean(selectedEditImage)
  const sourceLabel = selectedEditImageKind === 'original'
    ? '原始圖片'
    : selectedEditImageKind === 'ocr'
      ? 'OCR 版'
      : '閱讀版'
  const summary = useMemo(
    () => crops.map((crop, index) => ({ ...crop, suggestionTags: crop.tags?.length ? crop.tags : buildFallbackTags(index) })),
    [crops],
  )

  // ── AI 自動切題 ──
  const handleDetectQuestions = async () => {
    if (!currentPaperId) {
      pushToast({ tone: 'warning', title: '尚未連結後端', description: '請先回上傳頁完成預處理。' })
      return
    }
    setIsDetecting(true)
    try {
      const { data } = await paperApi.detectQuestions(currentPaperId)
      setDetectedBoxes(data.questions || [])
      setDetectProvider(data.provider || 'ollama')
      pushToast({
        tone: 'success',
        title: `AI 偵測到 ${data.questions?.length || 0} 題`,
        description: `模型：${data.provider === 'ollama' ? '本地 Gemma 4 26B' : 'Gemini 2.5 Flash'}`,
      })
    } catch (err) {
      pushToast({
        tone: 'warning',
        title: 'AI 偵測失敗',
        description: err?.response?.data?.detail || err.message || '請確認本地 Ollama 是否運作中',
      })
    } finally {
      setIsDetecting(false)
    }
  }

  // 把 AI 偵測的單一 box 轉成實際的 crop 並加入清單
  const addDetectedBox = async (box, idx) => {
    try {
      const result = await cropImageByNormalizedBbox(selectedEditImage, box)
      const localUrl = URL.createObjectURL(result.blob)
      addCrop({
        id: crypto.randomUUID(),
        imageUrl: localUrl,
        imageDataUrl: result.dataUrl,
        width: result.width,
        height: result.height,
        x: result.x,
        y: result.y,
        tags: [],
        status: 'ready',
        autoLabel: `題 ${box.q_num}`,
      })
      pushToast({
        tone: 'success',
        title: `已加入第 ${box.q_num} 題`,
        description: `${result.width} × ${result.height}`,
      })
    } catch (err) {
      pushToast({ tone: 'warning', title: '切題失敗', description: err.message })
    }
  }

  const addAllDetectedBoxes = async () => {
    let okCount = 0
    for (const box of detectedBoxes) {
      try {
        const result = await cropImageByNormalizedBbox(selectedEditImage, box)
        const localUrl = URL.createObjectURL(result.blob)
        addCrop({
          id: crypto.randomUUID(),
          imageUrl: localUrl,
          imageDataUrl: result.dataUrl,
          width: result.width,
          height: result.height,
          x: result.x,
          y: result.y,
          tags: [],
          status: 'ready',
          autoLabel: `題 ${box.q_num}`,
        })
        okCount += 1
      } catch (err) {
        console.error('addAllDetectedBoxes', err)
      }
    }
    pushToast({
      tone: 'success',
      title: `成功加入 ${okCount} / ${detectedBoxes.length} 題`,
      description: '可在右側清單檢查、刪除或繼續手動補框。',
    })
  }

  const captureCrop = async () => {
    if (!cropperRef.current?.cropper) return
    setIsSaving(true)

    try {
      const canvas = cropperRef.current.cropper.getCroppedCanvas({
        fillColor: '#ffffff',
        imageSmoothingQuality: 'high',
      })
      const blob = await cropCanvasToBlob(canvas)
      const dataUrl = await blobToDataUrl(blob)
      const localUrl = URL.createObjectURL(blob)
      const data = cropperRef.current.cropper.getData(true)
      const nextIndex = crops.length
      const localCropId = crypto.randomUUID()
      const width = Math.round(data.width)
      const height = Math.round(data.height)
      const x = Math.round(data.x)
      const y = Math.round(data.y)

      addCrop({
        id: localCropId,
        imageUrl: localUrl,
        imageDataUrl: dataUrl,
        width,
        height,
        x,
        y,
        tags: [],
        status: 'analyzing',
      })

      const result = await saveCropWithSuggestions({
        blob,
        filename: `crop-${nextIndex + 1}.png`,
        paperId: currentPaperId,
        imageUrl: localUrl,
        width,
        height,
        x,
        y,
      })

      updateCrop(localCropId, {
        remoteId: result.cropId,
        imageUrl: result.imageUrl || localUrl,
        imageDataUrl: dataUrl,
        tags: result.tags?.length ? result.tags : buildFallbackTags(nextIndex),
        status: result.source === 'mock' ? 'mocked' : 'ready',
      })

      pushToast({
        tone: result.source === 'mock' ? 'warning' : 'success',
        title: result.source === 'mock' ? '已加入本地裁切清單' : '裁切已同步',
        description:
          result.source === 'mock'
            ? '後端尚未回傳標籤，先使用本地建議。'
            : '後端已回傳裁切與標籤建議。',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <GlassCard
      title="錯題裁切工作區"
      description="拖動圖上的藍色選框框住一題，按「加入裁切」收進右側清單；或按「🤖 AI 自動切題」讓 AI 一次找出所有題目。"
      actions={
        <>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canCrop || isDetecting || !currentPaperId}
            onClick={handleDetectQuestions}
            title={!currentPaperId ? '請先回上傳頁完成預處理' : 'AI 自動偵測每題位置'}
          >
            {isDetecting ? '偵測中…' : '🤖 AI 自動切題'}
          </Button>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoCropMode}
              onChange={(e) => setAutoCropMode(e.target.checked)}
              className="accent-cyan-400"
            />
            連續框選
          </label>
          <Button variant="secondary" size="sm" disabled={crops.length === 0} onClick={() => { if (confirm('確定清空全部裁切？')) usePaperStore.getState().setCrops([]) }}>清空全部</Button>
          <Button disabled={!canCrop || isSaving} onClick={captureCrop}>{isSaving ? '儲存中…' : `加入裁切 (${crops.length})`}</Button>
        </>
      }
    >
      {detectedBoxes.length > 0 && canCrop && (
        <div className="mb-4">
          <DetectedQuestionsPanel
            imageUrl={selectedEditImage}
            boxes={detectedBoxes}
            provider={detectProvider}
            onAddOne={addDetectedBox}
            onAddAll={addAllDetectedBoxes}
            onClear={() => setDetectedBoxes([])}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/45 p-3">
          {canCrop ? (
            <>
              {/* 操作工具列：拖曳模式 + 縮放 */}
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2">
                <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950/60 p-0.5">
                  <button
                    onClick={() => switchDragMode('crop')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      dragMode === 'crop' ? 'bg-cyan-400/25 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="拖曳直接拉出新的框"
                  >
                    ⬚ 框選
                  </button>
                  <button
                    onClick={() => switchDragMode('move')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      dragMode === 'move' ? 'bg-cyan-400/25 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="拖曳移動畫面（放大後找位置用）"
                  >
                    ✋ 移動
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => zoomBy(-0.25)} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-sm text-slate-300 hover:bg-white/10" title="縮小">−</button>
                  <button onClick={resetView} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10" title="重設檢視">重設</button>
                  <button onClick={() => zoomBy(0.25)} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-sm text-slate-300 hover:bg-white/10" title="放大">+</button>
                </div>
                <span className="ml-auto hidden text-[11px] text-slate-500 md:inline">
                  滾輪縮放・雙擊圖片快速切換框選/移動・來源：{sourceLabel}
                </span>
              </div>
              <Cropper
                src={selectedEditImage}
                className="h-[620px] w-full"
                guides
                viewMode={1}
                dragMode="crop"
                background={false}
                responsive
                autoCropArea={0.4}
                wheelZoomRatio={0.2}
                checkOrientation={false}
                ref={cropperRef}
              />
            </>
          ) : (
            <div className="flex h-[620px] items-center justify-center rounded-[22px] border border-dashed border-white/10 text-sm text-slate-400">
              先回到上傳頁完成預處理，這裡才會出現可操作的乾淨圖檔。
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-white">裁切清單 ({crops.length} 題)</div>
              {crops.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => navigate('/generate')}>前往組卷</Button>
              )}
            </div>
            {autoCropMode && <div className="mt-2 text-xs text-cyan-300">連續框選模式開啟：框好後按「加入裁切」，圖片會保持在原位方便繼續框下一題</div>}
          </div>

          <div className="max-h-[680px] space-y-3 overflow-auto pr-1">
            {summary.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-slate-400">
                <div className="font-medium text-slate-300">清單還是空的</div>
                <div className="mt-1">
                  ① 拖動左側圖上的選框，框住一整題（含題號和選項）<br />
                  ② 按右上角「加入裁切」<br />
                  懶得一題一題框？按「🤖 AI 自動切題」讓 AI 找出每一題。
                </div>
              </div>
            ) : (
              summary.map((crop, index) => (
                <div key={crop.id} className="rounded-[24px] border border-white/10 bg-white/6 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">題目 #{index + 1}</div>
                      <div className="mt-1 text-xs text-slate-400">{crop.width} × {crop.height} ｜ x {crop.x} / y {crop.y}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeCrop(crop.id)}>刪除</Button>
                  </div>
                  <img src={crop.imageUrl} alt={`crop-${index + 1}`} className="mt-3 max-h-40 w-full rounded-2xl object-contain bg-slate-50" />
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                    <span>狀態：</span>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-slate-200">
                      {crop.status === 'analyzing' ? '分析中' : crop.status === 'mocked' ? '本地建議' : '已同步'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {crop.suggestionTags.map((tag) => (
                      <span key={tag} className="rounded-full border border-cyan-200/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  )
}

