import CropWorkspace from '@/features/cropping/components/CropWorkspace'
import GlassCard from '@/components/ui/GlassCard'
import NoticeBanner from '@/components/ui/NoticeBanner'
import Button from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'
import usePaperStore from '@/store/usePaperStore'

export default function Edit() {
  const navigate = useNavigate()
  const selectedEditImage = usePaperStore((state) => state.selectedEditImage)
  const selectedEditImageKind = usePaperStore((state) => state.selectedEditImageKind)
  const currentPaperId = usePaperStore((state) => state.currentPaperId)
  const crops = usePaperStore((state) => state.crops)
  const sourceLabel = selectedEditImageKind === 'original'
    ? '原始圖片'
    : selectedEditImageKind === 'ocr'
      ? 'OCR 版'
      : '閱讀版'

  return (
    <div className="space-y-5">
      <GlassCard
        title="框選錯題 — 做一份只有錯題的複習卷"
        description="把學生答錯（或想再練一次）的題目一題一題裁下來，下一步就能組成乾淨的 A4 複習卷 PDF。"
      >
        {/* 使用流程：一眼看懂這頁怎麼用 */}
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          {[
            { n: '1', title: '框住一題', desc: '拖動左側圖上的選框，框住一整題（按 🤖 可讓 AI 自動找題）' },
            { n: '2', title: '加入裁切', desc: '按右上角「加入裁切」，題目會收進右側清單' },
            { n: '3', title: '前往組卷', desc: '全部裁完後按「前往組卷」，輸出複習卷 PDF' },
          ].map((s) => (
            <div key={s.n} className="flex gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-cyan-400/20 text-sm font-bold text-cyan-300">{s.n}</div>
              <div>
                <div className="font-medium text-white">{s.title}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-slate-400">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {!selectedEditImage && (
        <NoticeBanner
          tone="warning"
          title="還沒有可以框選的考卷"
          description="請先到「上傳試卷」完成去手寫處理，乾淨的考卷會自動帶到這裡。"
          actions={<Button size="sm" onClick={() => navigate('/upload')}>前往上傳頁</Button>}
        />
      )}

      {selectedEditImage && (
        <NoticeBanner
          tone={currentPaperId ? 'success' : 'info'}
          title={`框選來源：${sourceLabel}（去手寫後的乾淨版）`}
          description={
            currentPaperId
              ? '加入裁切時會自動請 AI 建議分類標籤。如果想改用原始圖片框選，回上傳頁切換即可。'
              : `已建立 ${crops.length} 題裁切（本地模式，標籤用預設建議）。`
          }
          actions={crops.length > 0 ? <Button size="sm" onClick={() => navigate('/generate')}>前往組卷頁 →</Button> : null}
        />
      )}

      <CropWorkspace />
    </div>
  )
}
