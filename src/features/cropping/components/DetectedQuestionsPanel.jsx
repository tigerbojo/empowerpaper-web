import { useEffect, useState } from 'react'
import Button from '@/components/ui/Button'

// 相鄰框用不同顏色描邊才分得開；半透明填色會疊成一片看不出邊界
const PALETTE = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#fb923c']

/**
 * 顯示 AI 偵測到的題目 bbox（normalized 0~1）
 *
 * 設計原則（2026-06-12 重做）：
 * - 預設「只有描邊、無填色」，內容看得一清二楚
 * - 題號標籤貼在自己的框左上角內側，顏色與框一致
 * - hover 才出現淡填色 + 加粗，明確知道點下去是哪一題
 * - 加入過的框變綠 ✓ 且不可再點，避免重複加入
 */
export default function DetectedQuestionsPanel({ imageUrl, boxes, provider, onAddOne, onAddAll, onClear }) {
  const [hover, setHover] = useState(null)
  const [added, setAdded] = useState(() => new Set())
  const [imgReady, setImgReady] = useState(false)

  useEffect(() => {
    setImgReady(false)
    setAdded(new Set())
  }, [imageUrl])

  if (!boxes || boxes.length === 0) return null

  const colorOf = (idx) => PALETTE[idx % PALETTE.length]

  const handleAddOne = (b, idx) => {
    if (added.has(idx)) return
    setAdded((prev) => new Set(prev).add(idx))
    onAddOne(b, idx)
  }

  const handleAddAll = () => {
    setAdded(new Set(boxes.map((_, idx) => idx)))
    onAddAll()
  }

  return (
    <div className="rounded-[24px] border border-cyan-300/30 bg-cyan-300/5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-cyan-100">
            AI 偵測到 {boxes.length} 題{added.size > 0 ? `（已加入 ${added.size}）` : ''}
          </div>
          <div className="text-[11px] text-cyan-200/70">
            模型：{provider === 'ollama' ? '本地 Gemma 4 26B' : 'Gemini 2.5 Flash'}　滑過框會亮起，點一下加入該題；框不準的題目改用下方手動框選
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onClear}>清除框</Button>
          <Button size="sm" onClick={handleAddAll} disabled={added.size === boxes.length}>
            全部加入 ({boxes.length})
          </Button>
        </div>
      </div>

      <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-white">
        <img
          src={imageUrl}
          alt="detected questions"
          className="block w-full"
          onLoad={() => setImgReady(true)}
        />
        {imgReady && (
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
          >
            {boxes.map((b, idx) => {
              const isHover = hover === idx
              const isAdded = added.has(idx)
              const color = isAdded ? '#22c55e' : colorOf(idx)
              return (
                <rect
                  key={idx}
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  rx={0.004}
                  fill={isHover && !isAdded ? `${color}26` : 'transparent'}
                  stroke={color}
                  strokeWidth={isHover ? 3 : isAdded ? 1 : 2}
                  strokeDasharray={isAdded ? '4 3' : 'none'}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: isAdded ? 'default' : 'pointer', pointerEvents: 'all' }}
                  onMouseEnter={() => setHover(idx)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => handleAddOne(b, idx)}
                >
                  <title>{added.has(idx) ? `第 ${b.q_num} 題已加入` : `點擊加入第 ${b.q_num} 題`}</title>
                </rect>
              )
            })}
          </svg>
        )}

        {/* 題號標籤：貼在自己框的左上角內側，顏色與框一致 */}
        {imgReady && (
          <div className="pointer-events-none absolute inset-0">
            {boxes.map((b, idx) => {
              const isAdded = added.has(idx)
              return (
                <div
                  key={`label-${idx}`}
                  className="absolute rounded-br-md px-1.5 py-0.5 text-[11px] font-bold leading-tight text-white shadow"
                  style={{
                    left: `${b.x * 100}%`,
                    top: `${b.y * 100}%`,
                    backgroundColor: isAdded ? '#22c55e' : colorOf(idx),
                    opacity: hover === idx ? 1 : 0.92,
                  }}
                >
                  {isAdded ? `✓ ${b.q_num}` : b.q_num}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
