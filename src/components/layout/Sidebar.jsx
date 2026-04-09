import { NavLink } from 'react-router-dom'
import clsx from 'clsx'

const items = [
  { to: '/', label: '儀表板', hint: '查看整體進度與系統狀態' },
  { to: '/upload', label: '上傳試卷', hint: '壓縮圖片並送往後端' },
  { to: '/edit', label: '框選錯題', hint: '人工微調與 AI 標籤建議' },
  { to: '/generate', label: '產出複習卷', hint: 'A4 預覽與 PDF 匯出' },
]

export default function Sidebar() {
  return (
    <aside className="glass-panel hidden w-[300px] flex-col justify-between p-5 lg:flex">
      <div>
        <div className="mb-8 rounded-3xl border border-white/10 bg-white/8 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">EmpowerPaper</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">增強智卷</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            採用 Apple 風格的 Web 工作台，前端聚焦在流暢互動，未來可與 Flutter App 共用同一套 API。
          </p>
        </div>
        <nav className="space-y-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => clsx(
                'block rounded-3xl border px-4 py-4 transition',
                isActive
                  ? 'border-cyan-300/30 bg-cyan-300/12 text-white shadow-glow'
                  : 'border-line bg-white/6 text-slate-200 hover:bg-white/10',
              )}
            >
              <div className="font-medium">{item.label}</div>
              <div className="mt-1 text-sm text-slate-400">{item.hint}</div>
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="rounded-3xl border border-line bg-white/6 p-4 text-sm leading-6 text-slate-300">
        架構預設採用 FastAPI、Google Cloud Vision、Google Cloud Storage 與 Firebase Auth，方便之後直接部署到 Cloud Run。
      </div>
    </aside>
  )
}
