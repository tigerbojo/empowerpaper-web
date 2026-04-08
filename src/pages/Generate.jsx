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
            title="尚未加入任何題目"
            description="請先到框選頁至少加入一題，這裡才會有預覽與匯出內容。"
            actions={<Button size="sm" onClick={() => navigate('/edit')}>前往框選頁</Button>}
          />
        ) : (
          <NoticeBanner
            tone={generatedPdfUrl ? 'success' : 'info'}
            title={generatedPdfUrl ? '預覽已生成' : '等待生成預覽'}
            description={
              generatedPdfUrl
                ? `目前預覽來源：${generatedPdfUrl}`
                : '請先點選「生成預覽」，之後再決定是否匯出 PDF。'
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
              : '尚未生成預覽，請先在左側設定中點選「生成預覽」。'}
          </div>
        </GlassCard>
      </div>
      <ExamPreviewCanvas />
    </div>
  )
}
