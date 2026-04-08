import { useLocation } from 'react-router-dom'
import useAuthStore from '@/store/useAuthStore'
import env from '@/config/env'

const titles = {
  '/': {
    title: '考卷新生儀表板',
    subtitle: '掌握目前上傳、裁切、標籤與組卷進度，作為 Google 生態版前端的控制中心。',
  },
  '/upload': {
    title: '上傳與預處理',
    subtitle: '先在前端做圖片壓縮，再交給 FastAPI 與 OpenCV 進行去筆跡、拉平與後續分析。',
  },
  '/edit': {
    title: '錯題框選與標籤',
    subtitle: '用 react-cropper 進行人工微調，後續會串接 OCR 與 AI 標籤建議。',
  },
  '/generate': {
    title: '智慧組卷與匯出',
    subtitle: '整理已挑選的題目，產生 A4 預覽與 PDF，之後可接 Cloud Storage 與分享流程。',
  },
}

export default function Header() {
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const current = titles[location.pathname] ?? titles['/']

  return (
    <header className="glass-panel flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
      <div>
        <p className="mb-2 text-xs uppercase tracking-[0.24em] text-cyan-200/80">{env.appName}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-white">{current.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{current.subtitle}</p>
      </div>
      <div className="rounded-full border border-line bg-white/10 px-4 py-3 text-sm text-slate-200">
        {user ? `歡迎回來，${user.name}` : '尚未登入，將以訪客模式操作'}
      </div>
    </header>
  )
}
