import { useEffect, useRef, useState } from 'react'
import Button from '@/components/ui/Button'

/**
 * 顯示 AI 偵測到的題目 bbox（normalized 0~1）
 * 用 SVG 疊在縮圖上，每個框可點擊
 *
 * props:
 *   imageUrl: string                                    - 整張考卷圖
 *   boxes: [{ q_num, x, y, w, h, confidence }]         - normalized
 *   provider: 'ollama' | 'gemini'
 *   onAddOne: (box) => void
 *   onAddAll: () => void
 *   onClear: () => void
 */
export default function DetectedQuestionsPanel({ imageUrl, boxes, provider, onAddOne, onAddAll, onClear }) {
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const [hover, setHover] = useState(null)
  const [imgReady, setImgReady] = useState(false)

  useEffect(() => {
    setImgReady(false)
  }, [imageUrl])

  if (!boxes || boxes.length === 0) return null

  return (
    <div className="rounded-[24px] border border-cyan-300/30 bg-cyan-300/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-cyan-100">
            AI 偵測到 {boxes.length} 題
          </div>
          <div className="text-[11px] text-cyan-200/70">
            模型：{provider === 'ollama' ? '本地 Gemma 4 26B' : 'Gemini 2.5 Flash'}　點任一框 → 加入單題　或一鍵全部加入
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onClear}>清除框</Button>
          <Button size="sm" onClick={onAddAll}>全部加入 ({boxes.length})</Button>
        </div>
      </div>

      <div ref={containerRef} className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50">
        <img
          ref={imgRef}
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
              return (
                <g
                  key={idx}
                  onMouseEnter={() => setHover(idx)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onAddOne(b, idx)}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    fill={isHover ? 'rgba(34, 211, 238, 0.30)' : 'rgba(34, 211, 238, 0.12)'}
                    stroke="#22d3ee"
                    strokeWidth="0.003"
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* 題號標籤背景 */}
                  <rect
                    x={b.x}
                    y={Math.max(0, b.y - 0.025)}
                    width={Math.min(0.06, b.w)}
                    height="0.025"
                    fill="#22d3ee"
                  />
                </g>
              )
            })}
          </svg>
        )}

        {/* 題號文字 — 用絕對定位的 div（SVG text 在百分比 viewBox 下不好讀） */}
        {imgReady && containerRef.current && (
          <div className="pointer-events-none absolute inset-0">
            {boxes.map((b, idx) => (
              <div
                key={`label-${idx}`}
                className="absolute rounded bg-cyan-400 px-1 text-[10px] font-bold text-slate-900"
                style={{
                  left: `${b.x * 100}%`,
                  top: `${Math.max(0, b.y * 100 - 2.2)}%`,
                  transform: 'translateY(0)',
                }}
              >
                {b.q_num}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
