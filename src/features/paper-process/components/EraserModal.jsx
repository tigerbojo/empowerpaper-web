import { useEffect, useRef, useState, useCallback } from 'react'
import Button from '@/components/ui/Button'

/**
 * 橡皮擦編輯器 modal
 * - 拖動橡皮擦：在 canvas 上畫白色筆畫
 * - 矩形清除：框一個區域，整塊變白
 * - Undo / Redo（snapshot stack）
 * - 套用：產出新 dataURL 回傳給 onApply
 */
export default function EraserModal({ imageUrl, onClose, onApply }) {
  const canvasRef = useRef(null)
  const baseImgRef = useRef(null)
  const [tool, setTool] = useState('brush') // 'brush' | 'rect'
  const [brushSize, setBrushSize] = useState(30)
  const [history, setHistory] = useState([]) // dataURL snapshots
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isDrawing, setIsDrawing] = useState(false)
  const [rectStart, setRectStart] = useState(null)
  const [imgLoaded, setImgLoaded] = useState(false)

  // 初始化 canvas
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      // canvas 跟原圖同尺寸
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      baseImgRef.current = img
      setImgLoaded(true)
      // 存初始 snapshot
      const snapshot = canvas.toDataURL('image/png')
      setHistory([snapshot])
      setHistoryIndex(0)
    }
    img.src = imageUrl
  }, [imageUrl])

  // 取得 canvas 內座標（從 mouse event）
  const getCanvasPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  // 存當前 snapshot
  const pushSnapshot = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const snapshot = canvas.toDataURL('image/png')
    // 切掉 redo 後的歷史
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(snapshot)
    // 限制 history 長度避免吃太多記憶體
    if (newHistory.length > 30) newHistory.shift()
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
  }, [history, historyIndex])

  // 載入指定 snapshot
  const loadSnapshot = (dataUrl) => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
    }
    img.src = dataUrl
  }

  const handleUndo = () => {
    if (historyIndex <= 0) return
    const newIndex = historyIndex - 1
    setHistoryIndex(newIndex)
    loadSnapshot(history[newIndex])
  }

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return
    const newIndex = historyIndex + 1
    setHistoryIndex(newIndex)
    loadSnapshot(history[newIndex])
  }

  // ── Brush 模式 ──
  const handleMouseDown = (e) => {
    e.preventDefault()
    const pos = getCanvasPos(e)
    if (tool === 'brush') {
      setIsDrawing(true)
      const ctx = canvasRef.current.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = brushSize
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(pos.x, pos.y)
    } else if (tool === 'rect') {
      setRectStart(pos)
    }
  }

  const handleMouseMove = (e) => {
    if (tool === 'brush' && isDrawing) {
      const pos = getCanvasPos(e)
      const ctx = canvasRef.current.getContext('2d')
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
    }
  }

  const handleMouseUp = (e) => {
    if (tool === 'brush' && isDrawing) {
      setIsDrawing(false)
      pushSnapshot()
    } else if (tool === 'rect' && rectStart) {
      const end = getCanvasPos(e)
      const x = Math.min(rectStart.x, end.x)
      const y = Math.min(rectStart.y, end.y)
      const w = Math.abs(end.x - rectStart.x)
      const h = Math.abs(end.y - rectStart.y)
      if (w > 5 && h > 5) {
        const ctx = canvasRef.current.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(x, y, w, h)
        pushSnapshot()
      }
      setRectStart(null)
    }
  }

  const handleApply = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      onApply(url)
    }, 'image/png')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative flex max-h-[95vh] w-full max-w-5xl flex-col rounded-3xl border border-white/10 bg-slate-900 p-4 shadow-2xl">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white">手動微調瑕疵</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Toolbar */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
          <Button
            size="sm"
            variant={tool === 'brush' ? 'primary' : 'secondary'}
            onClick={() => setTool('brush')}
          >
            🖌 橡皮擦
          </Button>
          <Button
            size="sm"
            variant={tool === 'rect' ? 'primary' : 'secondary'}
            onClick={() => setTool('rect')}
          >
            ⬜ 矩形清除
          </Button>

          {tool === 'brush' && (
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span>大小</span>
              <input
                type="range"
                min="5"
                max="100"
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="w-24 accent-cyan-400"
              />
              <span className="font-mono text-cyan-300 w-8">{brushSize}px</span>
            </div>
          )}

          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="secondary" disabled={historyIndex <= 0} onClick={handleUndo}>↶ Undo</Button>
            <Button size="sm" variant="secondary" disabled={historyIndex >= history.length - 1} onClick={handleRedo}>↷ Redo</Button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-auto rounded-2xl border border-white/10 bg-white p-2">
          {!imgLoaded && <div className="flex h-64 items-center justify-center text-slate-400">載入中…</div>}
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
            style={{
              maxWidth: '100%',
              height: 'auto',
              display: imgLoaded ? 'block' : 'none',
              cursor: tool === 'brush' ? 'crosshair' : 'crosshair',
              touchAction: 'none',
            }}
          />
        </div>

        {/* Footer */}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleApply}>套用編輯</Button>
        </div>
      </div>
    </div>
  )
}
