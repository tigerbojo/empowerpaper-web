import { useMemo, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'

/**
 * 互動式擦除檢視（人機協作補品質的核心 UI）
 *
 * - 紅色實線框 = 已自動擦除的筆跡 → 點擊「還原」
 * - 琥珀色虛線框 = 疑似手寫但被保留 → 點擊「擦除」
 * - 開啟「顯示所有筆畫」後，任何墨水元件都可點擊強制擦除
 *   （專治寫在印刷文字行上、演算法抓不到的填空答案）
 *
 * 點擊只改本地狀態，按「套用變更」才送後端重算一次。
 * 座標皆為後端 cleaned image 的像素座標，用 SVG viewBox 自動縮放。
 */
export default function ComponentReviewModal({
  imageUrl,
  originalImageUrl,
  components,
  imageWidth,
  imageHeight,
  isApplying,
  onApply,
  onAiHint,
  onClose,
  hasManualEdits,
}) {
  // id -> 現在是否擦除（沒有記錄 = 維持後端回傳的 erased）
  const [overrides, setOverrides] = useState({})
  const [showInk, setShowInk] = useState(false)
  const [zoom, setZoom] = useState(100)
  // 對照原始考卷：被筆跡完全蓋住的印刷內容無法自動還原，
  // 切回原圖讓使用者判讀被遮蓋處的原始內容
  const [compareOriginal, setCompareOriginal] = useState(false)
  // 工具：click = 點選單一元件；box = 拖框批次擦除；sample = 標記筆跡樣本
  // （框內元件全是擦除狀態時改為批次還原 — 拖同一區兩次等於 undo）
  const [tool, setTool] = useState('click')
  const wrapRef = useRef(null)
  const [boxStart, setBoxStart] = useState(null)   // 影像座標
  const [boxRect, setBoxRect] = useState(null)     // {x,y,w,h} 影像座標
  // 筆跡樣本點（normalized 0~1）：點 3-5 處筆跡，套用時讓後端按樣本
  // 特徵（濃度/彩度/筆寬）舉一反三擦除全頁同類筆跡
  const [samplePoints, setSamplePoints] = useState([])

  const toImageCoords = (e) => {
    const r = wrapRef.current.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * imageWidth,
      y: ((e.clientY - r.top) / r.height) * imageHeight,
    }
  }

  const handleSampleClick = (e) => {
    if (tool !== 'sample' || !wrapRef.current) return
    const p = toImageCoords(e)
    setSamplePoints((prev) => {
      if (prev.length >= 8) return prev
      return [...prev, { x: p.x / imageWidth, y: p.y / imageHeight }]
    })
  }

  const handleBoxDown = (e) => {
    if (tool === 'sample') {
      handleSampleClick(e)
      return
    }
    if (tool !== 'box' || !wrapRef.current) return
    e.preventDefault()
    setBoxStart(toImageCoords(e))
    setBoxRect(null)
  }
  const handleBoxMove = (e) => {
    if (tool !== 'box' || !boxStart) return
    const p = toImageCoords(e)
    setBoxRect({
      x: Math.min(boxStart.x, p.x),
      y: Math.min(boxStart.y, p.y),
      w: Math.abs(p.x - boxStart.x),
      h: Math.abs(p.y - boxStart.y),
    })
  }
  const handleBoxUp = () => {
    if (tool !== 'box' || !boxStart) return
    const rect = boxRect
    setBoxStart(null)
    setBoxRect(null)
    if (!rect || rect.w < 5 || rect.h < 5) return
    const hits = effective.filter(
      (c) => c.x < rect.x + rect.w && c.x + c.w > rect.x && c.y < rect.y + rect.h && c.y + c.h > rect.y,
    )
    if (hits.length === 0) return
    // 框內全是已擦除 → 批次還原；否則把保留中的全部標記擦除
    const allErased = hits.every((c) => c.erasedNow)
    setOverrides((prev) => {
      const next = { ...prev }
      hits.forEach((c) => { next[c.id] = !allErased })
      return next
    })
  }

  const effective = useMemo(
    () =>
      (components || []).map((c) => ({
        ...c,
        erasedNow: overrides[c.id] !== undefined ? overrides[c.id] : c.erased,
        // 後端自動判定的基準（不含使用者覆寫）：
        // removed/restored = 自動會擦；forced/candidate/ink = 自動不擦
        autoErased: c.kind === 'removed' || c.kind === 'restored',
      })),
    [components, overrides],
  )

  const erasedCount = effective.filter((c) => c.erasedNow).length
  const changedCount = effective.filter((c) => c.erasedNow !== c.erased).length

  const toggle = (comp) => {
    setOverrides((prev) => {
      const next = { ...prev }
      const erasedNow = next[comp.id] !== undefined ? next[comp.id] : comp.erased
      next[comp.id] = !erasedNow
      return next
    })
  }

  const collectOverrides = () => ({
    keepIds: effective.filter((c) => c.autoErased && !c.erasedNow).map((c) => c.id),
    eraseIds: effective.filter((c) => !c.autoErased && c.erasedNow).map((c) => c.id),
  })

  const handleApply = () => {
    const { keepIds, eraseIds } = collectOverrides()
    // 清掉本地 overrides 與樣本點，套用後以後端新回傳的狀態為準
    // （樣本的效果已烘進重算結果；要加強就再標新的樣本）
    setOverrides({})
    setSamplePoints([])
    onApply(keepIds, eraseIds, samplePoints)
  }

  const handleAiHint = () => {
    const { keepIds, eraseIds } = collectOverrides()
    setOverrides({})
    setSamplePoints([])
    onAiHint(keepIds, eraseIds)
  }

  const rectStyle = (c) => {
    if (c.erasedNow) {
      return { stroke: '#f43f5e', strokeDasharray: 'none', fill: 'rgba(244, 63, 94, 0.18)' }
    }
    if (c.kind === 'candidate' || c.erased !== c.erasedNow) {
      return { stroke: '#f59e0b', strokeDasharray: '6 4', fill: 'rgba(245, 158, 11, 0.10)' }
    }
    // 一般 ink：只在 showInk 時可見/可點
    return { stroke: 'rgba(56, 189, 248, 0.5)', strokeDasharray: '2 3', fill: 'rgba(56, 189, 248, 0.04)' }
  }

  const visible = effective.filter((c) => showInk || c.kind !== 'ink' || c.erasedNow !== c.erased)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative flex max-h-[95vh] w-full max-w-6xl flex-col rounded-3xl border border-white/10 bg-slate-900 p-4 shadow-2xl">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-white">智慧擦除檢視</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              點紅框可還原誤刪的內容；點琥珀色虛線框可擦掉漏網的筆跡。
            </p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-white">×</button>
        </div>

        {/* Toolbar */}
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-xs text-slate-300">
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/70 p-0.5">
            <button
              onClick={() => setTool('click')}
              className={`rounded-md px-2 py-1 font-medium transition ${
                tool === 'click' ? 'bg-cyan-400/25 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="點選單一筆畫切換擦除/還原"
            >
              👆 點選
            </button>
            <button
              onClick={() => setTool('box')}
              className={`rounded-md px-2 py-1 font-medium transition ${
                tool === 'box' ? 'bg-amber-400/25 text-amber-200' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="拖一個方框，框內所有筆畫一次擦除（框內全是紅框時改為一次還原）"
            >
              ⬚ 框選擦除
            </button>
            <button
              onClick={() => setTool('sample')}
              className={`rounded-md px-2 py-1 font-medium transition ${
                tool === 'sample' ? 'bg-violet-400/25 text-violet-200' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="點 3-5 處筆跡當樣本，套用時系統按樣本特徵擦除全頁同類筆跡"
            >
              🖊 筆跡樣本{samplePoints.length > 0 ? `(${samplePoints.length})` : ''}
            </button>
            {samplePoints.length > 0 && (
              <button
                onClick={() => setSamplePoints([])}
                className="rounded-md px-2 py-1 text-slate-500 hover:text-slate-300"
                title="清除所有樣本點"
              >
                ✕
              </button>
            )}
          </div>
          {tool === 'sample' && (
            <span className="text-violet-300">
              在不同位置點 3-5 處筆跡（建議含最淡和最深的），按「套用變更」生效
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-rose-500 bg-rose-500/20" />
            將擦除（{erasedCount}）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-dashed border-amber-500 bg-amber-500/10" />
            疑似手寫（點擊可擦）
          </span>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={showInk}
              onChange={(e) => setShowInk(e.target.checked)}
              className="accent-cyan-400"
            />
            顯示所有筆畫（可點任何字強制擦除）
          </label>
          {originalImageUrl && (
            <label className="flex cursor-pointer items-center gap-1.5" title="被筆跡蓋住的印刷內容無法自動還原，切回原圖判讀">
              <input
                type="checkbox"
                checked={compareOriginal}
                onChange={(e) => setCompareOriginal(e.target.checked)}
                className="accent-amber-400"
              />
              <span className={compareOriginal ? 'text-amber-300' : ''}>對照原始考卷</span>
            </label>
          )}
          <div className="ml-auto flex items-center gap-1">
            {[100, 150, 220, 320].map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`rounded-md border px-2 py-1 ${
                  zoom === z
                    ? 'border-cyan-400 bg-cyan-400/20 text-cyan-200'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {z}%
              </button>
            ))}
          </div>
        </div>

        {/* Image + overlay */}
        <div className="flex-1 overflow-auto rounded-2xl border border-white/10 bg-white p-2">
          <div
            ref={wrapRef}
            className="relative"
            style={{ width: `${zoom}%`, cursor: tool === 'click' ? 'default' : 'crosshair' }}
            onMouseDown={handleBoxDown}
            onMouseMove={handleBoxMove}
            onMouseUp={handleBoxUp}
            onMouseLeave={handleBoxUp}
          >
            <img
              src={compareOriginal && originalImageUrl ? originalImageUrl : imageUrl}
              alt={compareOriginal ? 'original preview' : 'cleaned preview'}
              className="block w-full select-none"
              draggable={false}
            />
            {imageWidth > 0 && imageHeight > 0 && (
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                preserveAspectRatio="none"
                style={{ pointerEvents: tool === 'click' ? 'auto' : 'none' }}
              >
                {visible.map((c) => {
                  const s = rectStyle(c)
                  return (
                    <rect
                      key={c.id}
                      x={c.x - 2}
                      y={c.y - 2}
                      width={c.w + 4}
                      height={c.h + 4}
                      rx={3}
                      fill={s.fill}
                      stroke={s.stroke}
                      strokeWidth={2}
                      strokeDasharray={s.strokeDasharray}
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggle(c)}
                    >
                      <title>{c.erasedNow ? '點擊還原' : '點擊擦除'}</title>
                    </rect>
                  )
                })}
              </svg>
            )}

            {/* 筆跡樣本標記（紫色圓點） */}
            {samplePoints.map((p, i) => (
              <div
                key={`sample-${i}`}
                className="pointer-events-none absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-violet-500 bg-violet-400/40 text-[10px] font-bold text-white shadow"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              >
                {i + 1}
              </div>
            ))}

            {/* 框選拖曳預覽 */}
            {boxRect && imageWidth > 0 && (
              <div
                className="pointer-events-none absolute border-2 border-dashed border-amber-400 bg-amber-400/15"
                style={{
                  left: `${(boxRect.x / imageWidth) * 100}%`,
                  top: `${(boxRect.y / imageHeight) * 100}%`,
                  width: `${(boxRect.w / imageWidth) * 100}%`,
                  height: `${(boxRect.h / imageHeight) * 100}%`,
                }}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center gap-2">
          {hasManualEdits && (
            <p className="text-xs text-amber-300">
              ⚠ 套用後會重新生成圖片，先前的手動橡皮擦修改會被重置（建議先用智慧擦除、最後再手動微調）。
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            {isApplying && <Spinner label="重新生成中…" />}
            <Button
              variant="secondary"
              onClick={handleAiHint}
              disabled={isApplying}
              title="讓 Gemini 用視覺語義找出所有手寫區域加強擦除 — 專治筆跡與印刷濃度太接近的褪色考卷（約 30-90 秒）"
            >
              🤖 AI 找手寫
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={isApplying}>關閉</Button>
            <Button onClick={handleApply} disabled={isApplying || (changedCount === 0 && samplePoints.length === 0)}>
              套用變更
              {changedCount > 0 ? `（${changedCount}）` : ''}
              {samplePoints.length > 0 ? `＋${samplePoints.length} 樣本` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
