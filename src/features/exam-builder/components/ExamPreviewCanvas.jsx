import GlassCard from '@/components/ui/GlassCard'
import usePaperStore from '@/store/usePaperStore'

export default function ExamPreviewCanvas() {
  const crops = usePaperStore((state) => state.crops)
  const examSettings = usePaperStore((state) => state.examSettings)

  return (
    <GlassCard title="A4 預覽畫布" description="這裡會先做前端版面預覽，之後再交給 @react-pdf/renderer 或後端服務輸出正式 PDF。">
      <div className="mx-auto aspect-[210/297] w-full max-w-[460px] overflow-hidden rounded-[32px] border border-white/10 bg-white p-6 text-slate-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{examSettings.paperSize}</div>
            <div className="mt-2 text-2xl font-semibold">{examSettings.title}</div>
          </div>
          <div className="text-right text-xs text-slate-400">
            預覽中
            <div className="mt-2 text-sm text-slate-500">共 {crops.length} 題</div>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {crops.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 p-5 text-center text-sm text-slate-400">
              目前還沒有可排版的題目，先到框選頁加入幾題後，這裡就會顯示預覽卡片。
            </div>
          ) : (
            crops.slice(0, 4).map((crop, index) => (
              <div key={crop.id} className="grid grid-cols-[84px_1fr] gap-3 rounded-[24px] border border-slate-200 p-3">
                <img src={crop.imageUrl} alt={`preview-${index + 1}`} className="h-20 w-full rounded-2xl object-cover" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">題目 {index + 1}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">標籤：{(crop.tags || []).join(' ｜ ') || '等待 AI 建議'}</div>
                  <div className="mt-3 h-6 rounded-full bg-slate-100" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </GlassCard>
  )
}
