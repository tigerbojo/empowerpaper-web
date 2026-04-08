import GlassCard from '@/components/ui/GlassCard'
import Button from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'
import usePaperStore from '@/store/usePaperStore'
import env from '@/config/env'
import { isFirebaseReady } from '@/services/firebase'
import AuthStatusCard from '@/features/auth/components/AuthStatusCard'

const metrics = [
  { label: '已收錄裁切題數', value: '18', note: '可持續擴充為雲端題庫' },
  { label: '本月處理試卷頁數', value: '264', note: '前端先做壓縮再送後端' },
  { label: '目標輸出格式', value: 'A4 / PDF', note: '支援列印與雲端分享' },
]

export default function Home() {
  const navigate = useNavigate()
  const crops = usePaperStore((state) => state.crops)

  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-5">
        <GlassCard
          title="考卷新生儀表板"
          description="這個 Web 預覽版負責把上傳、去筆跡、錯題框選、標籤建議與智慧組卷整合成一條順手的流程，後端預計採用 FastAPI 串接 Google Cloud 與 AI 服務。"
          actions={<Button onClick={() => navigate('/upload')}>開始處理新考卷</Button>}
        >
          <div className="grid gap-4 md:grid-cols-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-[28px] border border-white/10 bg-slate-950/35 p-4">
                <div className="text-sm text-slate-400">{metric.label}</div>
                <div className="mt-3 text-3xl font-semibold text-white">{metric.value}</div>
                <div className="mt-2 text-sm text-slate-400">{metric.note}</div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard title="目前系統狀態" description="先把本機工作流跑順，再逐步串上 Firebase、Cloud Vision、GCS 與 PDF 匯出。">
          <div className="space-y-3 text-sm text-slate-300">
            <div>目前裁切題數：{crops.length}</div>
            <div>壓縮策略：最長邊 2048px，統一轉 WebP</div>
            <div>後端目標：FastAPI + OpenCV + Cloud Vision + LLM</div>
            <div>Firebase 狀態：{isFirebaseReady ? '已設定' : '尚未填入前端憑證'}</div>
            <div>API Base URL：{env.apiBaseUrl}</div>
          </div>
        </GlassCard>
      </div>

      <AuthStatusCard />
    </div>
  )
}
