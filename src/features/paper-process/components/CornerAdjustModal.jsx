import { useEffect, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import apiClient from '@/services/apiClient'

/**
 * 文件透視校正 modal
 * - 載入原圖 + 自動偵測 4 個角點
 * - 使用者可拖動 4 個角點
 * - 按「套用」→ 後端 warp → 回傳新的原圖 URL
 *
 * props:
 *   paperId: string
 *   originalImageUrl: string
 *   onClose: () => void
 *   onApply: (warpedUrl: string) => void
 */
export default function CornerAdjustModal({ paperId, originalImageUrl, onClose, onApply }) {
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 }) // 原圖實際像素
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 }) // CSS 顯示尺寸
  // 4 個角點，使用原圖座標（左上、右上、右下、左下）
  const [corners, setCorners] = useState(null)
  const [dragging, setDragging] = useState(null) // 0-3 or null
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState(null)

  // 載入圖片 + 呼叫 backend 偵測角點
  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
      // 先給預設四個角（整張圖）
      setCorners([
        { x: 0, y: 0 },
        { x: img.naturalWidth, y: 0 },
        { x: img.naturalWidth, y: img.naturalHeight },
        { x: 0, y: img.naturalHeight },
      ])
      setLoading(false)
    }
    img.onerror = () => {
      if (cancelled) return
      setError('無法載入原圖')
      setLoading(false)
    }
    img.src = originalImageUrl

    // 同時呼叫後端自動偵測（失敗不影響）
    apiClient.get(`/papers/${paperId}/detect-corners`)
      .then(({ data }) => {
        if (cancelled) return
        if (data?.corners?.length === 4) {
          setCorners(data.corners)
        }
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [paperId, originalImageUrl])

  // 計算 display 尺寸（等比縮放到容器內）
  useEffect(() => {
    const update = () => {
      if (!containerRef.current || !imgSize.w) return
      const container = containerRef.current
      const maxW = container.clientWidth - 40
      const maxH = container.clientHeight - 40
      const scale = Math.min(maxW / imgSize.w, maxH / imgSize.h, 1)
      setDisplaySize({
        w: imgSize.w * scale,
        h: imgSize.h * scale,
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [imgSize])

  // 原圖 → display 座標
  const toDisplay = (pt) => {
    if (!imgSize.w) return { x: 0, y: 0 }
    return {
      x: (pt.x / imgSize.w) * displaySize.w,
      y: (pt.y / imgSize.h) * displaySize.h,
    }
  }

  // display → 原圖座標
  const toOriginal = (cssX, cssY) => {
    if (!displaySize.w) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(imgSize.w, (cssX / displaySize.w) * imgSize.w)),
      y: Math.max(0, Math.min(imgSize.h, (cssY / displaySize.h) * imgSize.h)),
    }
  }

  const handlePointerDown = (idx) => (e) => {
    e.stopPropagation()
    e.preventDefault()
    setDragging(idx)
  }

  const handlePointerMove = (e) => {
    if (dragging === null) return
    const imgEl = imgRef.current
    if (!imgEl) return
    const rect = imgEl.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const cssX = clientX - rect.left
    const cssY = clientY - rect.top
    const newPt = toOriginal(cssX, cssY)
    setCorners((prev) => prev.map((p, i) => (i === dragging ? newPt : p)))
  }

  const handlePointerUp = () => {
    setDragging(null)
  }

  const handleReset = () => {
    // 重設為自動偵測
    apiClient.get(`/papers/${paperId}/detect-corners`)
      .then(({ data }) => {
        if (data?.corners?.length === 4) setCorners(data.corners)
      })
      .catch(() => {})
  }

  const handleApply = async () => {
    if (!corners) return
    setApplying(true)
    try {
      const { data } = await apiClient.post('/papers/warp', {
        paperId,
        corners: corners.map((c) => ({ x: c.x, y: c.y })),
      })
      if (data?.warped_image_url) {
        onApply(data.warped_image_url)
      } else {
        throw new Error('後端未回傳 warped_image_url')
      }
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || '校正失敗')
    } finally {
      setApplying(false)
    }
  }

  // 繪製連接 4 個角點的 SVG 多邊形
  const polygonPoints = corners
    ? corners
        .map(toDisplay)
        .map((p) => `${p.x},${p.y}`)
        .join(' ')
    : ''

  const labels = ['左上', '右上', '右下', '左下']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      <div className="relative flex max-h-[95vh] w-full max-w-5xl flex-col rounded-3xl border border-white/10 bg-slate-900 p-4 shadow-2xl">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white">文件校正</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="mb-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-300">
          拖動 4 個角點框住文件的實際邊緣（歪斜、傾斜都可以），系統會自動校正為直立矩形。
        </div>

        {/* Canvas area */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden rounded-2xl bg-slate-950/60"
          style={{ minHeight: 300 }}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        >
          {loading && (
            <div className="flex h-full items-center justify-center text-slate-400">載入中…</div>
          )}

          {!loading && imgSize.w > 0 && (
            <div
              className="relative mx-auto"
              style={{ width: displaySize.w, height: displaySize.h, marginTop: 20 }}
            >
              <img
                ref={imgRef}
                src={originalImageUrl}
                alt="original"
                className="pointer-events-none block"
                style={{ width: displaySize.w, height: displaySize.h }}
                draggable={false}
              />

              {/* 四邊形外框 */}
              {corners && (
                <svg
                  className="pointer-events-none absolute inset-0"
                  width={displaySize.w}
                  height={displaySize.h}
                >
                  <polygon
                    points={polygonPoints}
                    fill="rgba(34, 211, 238, 0.15)"
                    stroke="#22d3ee"
                    strokeWidth="2"
                    strokeDasharray="none"
                  />
                </svg>
              )}

              {/* 4 個角點 handles */}
              {corners && corners.map((corner, idx) => {
                const d = toDisplay(corner)
                return (
                  <div
                    key={idx}
                    onMouseDown={handlePointerDown(idx)}
                    onTouchStart={handlePointerDown(idx)}
                    className="absolute flex h-8 w-8 items-center justify-center rounded-full border-4 border-white bg-cyan-400 shadow-lg cursor-grab active:cursor-grabbing select-none"
                    style={{
                      left: d.x - 16,
                      top: d.y - 16,
                      touchAction: 'none',
                    }}
                    title={labels[idx]}
                  >
                    <span className="text-[10px] font-bold text-slate-900">{idx + 1}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={handleReset} disabled={loading || applying}>重新偵測</Button>
          <Button variant="secondary" onClick={onClose} disabled={applying}>取消</Button>
          <Button onClick={handleApply} disabled={loading || applying || !corners}>
            {applying ? '校正中…' : '套用校正'}
          </Button>
        </div>
      </div>
    </div>
  )
}
