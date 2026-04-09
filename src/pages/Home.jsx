import GlassCard from '@/components/ui/GlassCard'
import Button from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'
import usePaperStore from '@/store/usePaperStore'
import env from '@/config/env'
import { isFirebaseReady } from '@/services/firebase'
import AuthStatusCard from '@/features/auth/components/AuthStatusCard'

const metrics = [
  { label: '最近上傳批次', value: '18', note: '用來展示近期處理與同步進度' },
  { label: '已建立裁切題目', value: '264', note: '可做為後續題庫與組卷素材' },
  { label: '輸出格式', value: 'A4 / PDF', note: '支援預覽後匯出複習卷' },
]

export default function Home() {
  const navigate = useNavigate()
  const crops = usePaperStore((state) => state.crops)

  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-5">
        <GlassCard
          title="增強智卷控制中心"
          description="這裡是 EmpowerPaper 的前端工作台，讓我們能從試卷上傳、題目裁切、AI 標籤到複習卷輸出，一路串接到 FastAPI 與 Google Cloud 生態。"
          actions={<Button onClick={() => navigate('/upload')}>開始上傳試卷</Button>}
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

        <GlassCard
          title="系統摘要"
          description="這裡集中顯示目前前端資料流與雲端配置，方便快速確認整條流程是否接通。"
        >
          <div className="space-y-3 text-sm text-slate-300">
            <div>目前已建立裁切題目：{crops.length}</div>
            <div>圖片前處理：最長邊 2048px，前端壓縮後再送出</div>
            <div>後端規劃：FastAPI + OpenCV + Cloud Vision + LLM</div>
            <div>Firebase 狀態：{isFirebaseReady ? '已設定完成' : '尚未填入正式憑證'}</div>
            <div>API Base URL：{env.apiBaseUrl}</div>
          </div>
        </GlassCard>
      </div>

      <AuthStatusCard />
    </div>
  )
}
