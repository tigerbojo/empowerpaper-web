import GlassCard from '@/components/ui/GlassCard'
import Button from '@/components/ui/Button'
import usePaperStore from '@/store/usePaperStore'
import useUiStore from '@/store/useUiStore'
import { useExamBuilder } from '@/features/exam-builder/hooks/useExamBuilder'
import { buildExamLayout, downloadBlob } from '@/features/exam-builder/utils/pdfLayout'

export default function ExamSettingsForm() {
  const examSettings = usePaperStore((state) => state.examSettings)
  const setExamSettings = usePaperStore((state) => state.setExamSettings)
  const crops = usePaperStore((state) => state.crops)
  const generatedPdfUrl = usePaperStore((state) => state.generatedPdfUrl)
  const setGeneratedPdfUrl = usePaperStore((state) => state.setGeneratedPdfUrl)
  const pushToast = useUiStore((state) => state.pushToast)
  const { generateMutation, exportMutation } = useExamBuilder()

  const payload = {
    title: examSettings.title,
    paperSize: examSettings.paperSize,
    columns: examSettings.columns,
    items: buildExamLayout(crops),
  }

  const handleGeneratePreview = async () => {
    try {
      const data = await generateMutation.mutateAsync(payload)
      if (data?.previewUrl) {
        setGeneratedPdfUrl(data.previewUrl)
        pushToast({
          tone: 'success',
          title: '預覽已生成',
          description: '已取得後端預覽網址，可接著匯出 PDF。',
        })
        return
      }
    } catch {
      // fall through to mock preview
    }

    setGeneratedPdfUrl('mock://preview-ready')
    pushToast({
      tone: 'warning',
      title: '使用本地預覽模式',
      description: '目前尚未拿到後端預覽，先以 fallback 模式繼續組卷。',
    })
  }

  const handleExportPdf = async () => {
    const result = await exportMutation.mutateAsync(payload)
    downloadBlob(result.blob, result.filename)
    pushToast({
      tone: result.source === 'api' ? 'success' : 'warning',
      title: result.source === 'api' ? '匯出成功' : '已下載 fallback 檔案',
      description:
        result.source === 'api'
          ? '已由後端產生並下載 PDF。'
          : '後端尚未提供 PDF，因此改下載 mock 匯出檔。',
    })
  }

  return (
    <GlassCard
      title="組卷設定"
      description="先設定標題與紙張尺寸，再決定是否生成預覽與匯出。這一版會優先走真實 API，失敗時自動改用本地 fallback。"
      actions={(
        <>
          <Button
            variant="secondary"
            disabled={crops.length === 0 || exportMutation.isPending}
            onClick={handleGeneratePreview}
          >
            {generateMutation.isPending ? '生成中…' : '生成預覽'}
          </Button>
          <Button
            disabled={crops.length === 0 || exportMutation.isPending}
            onClick={handleExportPdf}
          >
            {exportMutation.isPending ? '匯出中…' : '匯出檔案'}
          </Button>
        </>
      )}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-300">
          <span>試卷標題</span>
          <input
            value={examSettings.title}
            onChange={(event) => setExamSettings({ title: event.target.value })}
            className="w-full rounded-2xl border border-line bg-slate-950/50 px-4 py-3 text-white outline-none"
            placeholder="例如：等差數列複習卷"
          />
        </label>
        <label className="space-y-2 text-sm text-slate-300">
          <span>紙張尺寸</span>
          <select
            value={examSettings.paperSize}
            onChange={(event) => setExamSettings({ paperSize: event.target.value })}
            className="w-full rounded-2xl border border-line bg-slate-950/50 px-4 py-3 text-white outline-none"
          >
            <option>A4 直式</option>
            <option>A4 橫式</option>
            <option>B5 直式</option>
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-3 rounded-[24px] border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300 md:grid-cols-2">
        <div>
          目前已選題數：<span className="font-medium text-white">{crops.length}</span>
        </div>
        <div>
          預覽狀態：<span className="font-medium text-white">{generatedPdfUrl ? '已生成' : '尚未生成'}</span>
        </div>
      </div>
    </GlassCard>
  )
}
