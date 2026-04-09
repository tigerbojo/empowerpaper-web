import ExamSettingsForm from '@/features/exam-builder/components/ExamSettingsForm'
import ExamPreviewCanvas from '@/features/exam-builder/components/ExamPreviewCanvas'
import GlassCard from '@/components/ui/GlassCard'
import NoticeBanner from '@/components/ui/NoticeBanner'
import Button from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'
import usePaperStore from '@/store/usePaperStore'

export default function Generate() {
  const navigate = useNavigate()
  const generatedPdfUrl = usePaperStore((state) => state.generatedPdfUrl)
  const crops = usePaperStore((state) => state.crops)

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.95fr]">
      <div className="space-y-5">
        <ExamSettingsForm />

        {crops.length === 0 ? (
          <NoticeBanner
            tone="warning"
            title="目前還沒有可組卷的題目"
            description="先回到框選頁加入幾題，這裡才會顯示 A4 預覽與匯出功能。"
            actions={<Button size="sm" onClick={() => navigate('/edit')}>前往框選頁</Button>}
          />
        ) : (
          <NoticeBanner
            tone={generatedPdfUrl ? 'success' : 'info'}
            title={generatedPdfUrl ? '預覽已生成' : '等待建立預覽'}
            description={
              generatedPdfUrl
                ? `目前預覽來源：${generatedPdfUrl}`
                : '先按下「生成預覽」，確認版面與題目內容，再決定是否匯出 PDF。'
            }
            actions={!generatedPdfUrl ? <Button size="sm" variant="secondary" onClick={() => navigate('/edit')}>返回調整題目</Button> : null}
          />
        )}

        <GlassCard
          title="匯出狀態"
          description="這裡會顯示目前使用的是後端預覽還是本地 fallback，方便你確認整條流程是否已經接上 FastAPI。"
        >
          <div className="text-sm text-slate-300">
            {generatedPdfUrl
              ? `目前預覽來源：${generatedPdfUrl}`
              : '尚未建立預覽，匯出時會優先嘗試後端 PDF，不成功才會改用 fallback。'}
          </div>
        </GlassCard>
      </div>
      <ExamPreviewCanvas />
    </div>
  )
}
